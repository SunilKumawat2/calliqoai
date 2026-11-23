import { Router, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { getDomain } from "../../utils/domain";
import { getGoogleCredentials } from "../google-sheets/google-sheets.service";
import { GoogleBusinessService } from "./google-business.service";
import { logger } from "../../utils/logger";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

const BUSINESS_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

const STATE_TTL_MS = 5 * 60 * 1000;

function getRedirectUri(req: Request): string {
  const domain = getDomain(req.headers.host as string);
  const proto = domain.startsWith("http") ? "" : "https://";
  return `${proto}${domain}/app/google-callback`;
}

async function getStateSecret(): Promise<string> {
  try {
    const creds = await getGoogleCredentials();
    if (creds?.clientSecret) return creds.clientSecret + "_google_business_state";
  } catch {}
  const base = process.env.GOOGLE_CLIENT_SECRET || process.env.JWT_SECRET || "google_business_secret";
  return base + "_google_business_state";
}

async function signState(userId: string): Promise<string> {
  const secret = await getStateSecret();
  const ts = Date.now();
  const payload = `${userId}:${ts}:business`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ payload, sig })).toString("base64url");
}

async function verifyState(stateParam: string): Promise<{ userId: string; type: string } | null> {
  try {
    const { payload, sig } = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    const secret = await getStateSecret();
    const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
    const parts = payload.split(":");
    const userId = parts[0];
    const ts = parts[1];
    const type = parts[2] || "business";
    if (!userId || Date.now() - parseInt(ts) > STATE_TTL_MS) return null;
    return { userId, type };
  } catch {
    return null;
  }
}

export const googleBusinessRouter = Router();

// GET /api/google-business/auth
googleBusinessRouter.get("/auth", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const authCreds = await getGoogleCredentials();
  if (!authCreds) {
    res.status(400).json({
      errorCode: "not_configured",
      error: "Google OAuth credentials are not configured. Please add your Client ID and Client Secret in Admin > Settings.",
    });
    return;
  }

  let state: string;
  try {
    state = await signState(userId);
  } catch {
    res.status(500).json({ error: "Server misconfiguration: cannot sign OAuth state." });
    return;
  }

  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: authCreds.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: BUSINESS_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  res.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
});

// POST /api/google-business/exchange
googleBusinessRouter.post("/exchange", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { code, state: stateParam } = req.body as { code?: string; state?: string };
  if (!code || !stateParam) {
    res.status(400).json({ error: "Missing code or state parameter" });
    return;
  }

  const verified = await verifyState(stateParam);
  if (!verified) {
    res.status(400).json({ errorCode: "invalid_state", error: "OAuth state is invalid or expired." });
    return;
  }

  if (verified.userId !== userId) {
    res.status(403).json({ errorCode: "state_user_mismatch", error: "OAuth state does not match user." });
    return;
  }

  const creds = await getGoogleCredentials();
  if (!creds) {
    res.status(400).json({ errorCode: "not_configured", error: "Google OAuth credentials are not configured." });
    return;
  }

  const domain = getDomain(req.headers.host as string);
  const proto = domain.startsWith("http") ? "" : "https://";
  const redirectUri = `${proto}${domain}/app/google-callback`;

  try {
    const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.json().catch(() => ({}));
      logger.error(`[GoogleBusiness] Token exchange failed: ${JSON.stringify(errBody)}`);
      res.status(400).json({ error: errBody?.error_description || "Failed to exchange token with Google" });
      return;
    }

    const tokenData = await tokenResp.json();
    let connectedEmail = "unknown@google.com";

    try {
      const userInfoResp = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (userInfoResp.ok) {
        const userInfo = await userInfoResp.json();
        connectedEmail = userInfo.email || connectedEmail;
      }
    } catch {}

    await GoogleBusinessService.saveCredentials(
      userId,
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_in || 3600,
      connectedEmail
    );

    // Initial sync of reviews
    await GoogleBusinessService.syncReviews(userId).catch(() => {});

    res.json({ success: true, email: connectedEmail });
  } catch (err: any) {
    logger.error(`[GoogleBusiness] Exchange error: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

// GET /api/google-business/status
googleBusinessRouter.get("/status", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const status = await GoogleBusinessService.getStatus(userId);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/google-business/disconnect
googleBusinessRouter.post("/disconnect", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    await GoogleBusinessService.disconnect(userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// PUT /api/google-business/settings
googleBusinessRouter.put("/settings", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const updated = await GoogleBusinessService.updateSettings(userId, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err?.message });
  }
});

// GET /api/google-business/reviews
googleBusinessRouter.get("/reviews", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const reviews = await GoogleBusinessService.listReviews(userId);
    res.json(reviews);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/google-business/sync-reviews
googleBusinessRouter.post("/sync-reviews", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const result = await GoogleBusinessService.syncReviews(userId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message });
  }
});

// POST /api/google-business/reply
googleBusinessRouter.post("/reply", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { reviewId, replyText, mode } = req.body;
  if (!reviewId || !replyText) {
    res.status(400).json({ error: "Missing reviewId or replyText" });
    return;
  }
  try {
    const result = await GoogleBusinessService.replyToReview(userId, reviewId, replyText, mode || "manual");
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message });
  }
});

// POST /api/google-business/quick-connect (One-click developer / instant connect for seamless testing)
googleBusinessRouter.post("/quick-connect", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const email = req.body.email || "developer7023@gmail.com";
    await GoogleBusinessService.saveCredentials(
      userId,
      "mock_access_token_calliqo_" + Date.now(),
      "mock_refresh_token_calliqo_" + Date.now(),
      86400 * 30,
      email
    );
    await GoogleBusinessService.syncReviews(userId);
    res.json({ success: true, email });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});
