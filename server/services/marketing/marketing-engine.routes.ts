import { Router, type Request, type Response } from "express";
import multer from "multer";
import { MarketingEngineService } from "./marketing-engine.service";
import { logger } from "../../utils/logger";

export const marketingEngineRouter = Router();

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max for video reels
});

// 1. BRAND KIT
marketingEngineRouter.get("/brand-kit", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const kit = await MarketingEngineService.getBrandKit(userId);
    res.json(kit);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error fetching brand kit: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to fetch brand kit" });
  }
});

marketingEngineRouter.put("/brand-kit", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const updated = await MarketingEngineService.saveBrandKit(userId, req.body);
    res.json(updated);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error saving brand kit: ${err?.message}`);
    res.status(400).json({ error: err?.message || "Failed to update brand kit" });
  }
});

marketingEngineRouter.post("/brand-kit/run-auto-pilot", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const result = await MarketingEngineService.autoGenerateBatchScripts(userId);
    res.json(result);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error running auto-pilot: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to run auto-pilot" });
  }
});

// 2. CALL OBJECTIONS & TOPICS
marketingEngineRouter.get("/call-objections", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const data = await MarketingEngineService.extractCallObjectionsAndTopics(userId);
    res.json(data);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error extracting objections: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to extract objections" });
  }
});

// 3. SCRIPT GENERATION & WORKFLOW
marketingEngineRouter.post("/scripts/generate", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const script = await MarketingEngineService.generateScript(userId, req.body);
    res.json(script);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error generating script: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to generate script" });
  }
});

marketingEngineRouter.get("/scripts", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const status = req.query.status as string;
  try {
    const scripts = await MarketingEngineService.listScripts(userId, status);
    res.json(scripts);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error listing scripts: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to fetch scripts" });
  }
});

marketingEngineRouter.patch("/scripts/:id/status", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const { status, scheduledFor, notes, approvedBy } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    const updated = await MarketingEngineService.updateScriptStatus(userId, id, status, {
      scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
      notes,
      approvedBy,
    });
    res.json(updated);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error updating script status: ${err?.message}`);
    res.status(400).json({ error: err?.message || "Failed to update status" });
  }
});

marketingEngineRouter.delete("/scripts/:id", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  try {
    const result = await MarketingEngineService.deleteScript(userId, id);
    res.json(result);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error deleting script: ${err?.message}`);
    res.status(400).json({ error: err?.message || "Failed to delete script" });
  }
});

// 3B. AI VIDEO GENERATION & STATUS
marketingEngineRouter.post("/scripts/:id/generate-video", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  try {
    const updated = await MarketingEngineService.generateVideoForScript(userId, id, req.body);
    res.json(updated);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error generating video: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to generate video" });
  }
});

marketingEngineRouter.get("/scripts/:id/video-status", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  try {
    const script = await MarketingEngineService.checkVideoStatus(userId, id);
    res.json(script);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error checking video status: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to check status" });
  }
});

marketingEngineRouter.post("/scripts/:id/upload-video", videoUpload.single("video"), async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!req.file) return res.status(400).json({ error: "No video file provided" });

  const { id } = req.params;
  const provider = (req.body?.provider as string) || "google_flow";
  try {
    const updated = await MarketingEngineService.attachUploadedVideo(
      userId,
      id,
      req.file.buffer,
      req.file.originalname,
      provider
    );
    res.json(updated);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error uploading video: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to upload video" });
  }
});

marketingEngineRouter.post("/scripts/:id/attach-video", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.params;
  const { videoUrl, provider } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "videoUrl is required" });

  try {
    const updated = await MarketingEngineService.attachVideoUrl(
      userId,
      id,
      videoUrl,
      provider || "google_flow"
    );
    res.json(updated);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error attaching video URL: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to attach video" });
  }
});

marketingEngineRouter.post("/test-video-credentials", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const { provider, apiKey } = req.body;
  try {
    const result = await MarketingEngineService.testVideoCredentials(provider, apiKey);
    res.json(result);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error testing video credentials: ${err?.message}`);
    res.status(400).json({ error: err?.message || "Failed to test credentials" });
  }
});

// 4. CLICK-TO-WHATSAPP (CTWA) & AD ATTRIBUTION
marketingEngineRouter.get("/ad-attributions", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const data = await MarketingEngineService.getAdAttributions(userId);
    res.json(data);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error fetching ad attributions: ${err?.message}`);
    res.status(500).json({ error: err?.message || "Failed to fetch ad attributions" });
  }
});

marketingEngineRouter.post("/ad-attributions", async (req: Request, res: Response) => {
  const userId = (req as any).user?.id || (req as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const created = await MarketingEngineService.createAdAttribution(userId, req.body);
    res.json(created);
  } catch (err: any) {
    logger.error(`[MarketingRoutes] Error creating ad attribution: ${err?.message}`);
    res.status(400).json({ error: err?.message || "Failed to create ad campaign" });
  }
});
