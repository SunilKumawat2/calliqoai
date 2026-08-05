import { Router } from "express";
import { TeamAuthService } from "../services/team-auth.service.js";
import { TeamService } from "../services/team.service.js";
import { db } from "../../../server/db.js";
import { users } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";
const router = Router();
router.post("/login", async (req, res) => {
  try {
    const { email, password, teamId } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const result = await TeamAuthService.login({
      email,
      password,
      teamId
    });
    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }
    let teamDisplayName = result.team.name;
    const [parentUser] = await db.select({ company: users.company }).from(users).where(eq(users.id, String(result.team.userId)));
    if (parentUser?.company && (teamDisplayName === "My Team" || !teamDisplayName)) {
      teamDisplayName = parentUser.company;
    }
    res.json({
      token: result.token,
      expiresAt: result.expiresAt,
      member: {
        id: result.member.id,
        email: result.member.email,
        firstName: result.member.firstName,
        lastName: result.member.lastName,
        role: result.member.role
      },
      team: {
        id: result.team.id,
        name: teamDisplayName,
        type: "user",
        parentUserId: result.team.userId
      }
    });
  } catch (error) {
    console.error("[Team Auth] Login error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
});
router.post("/logout", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.substring(7);
    await TeamAuthService.logout(token);
    res.json({ success: true });
  } catch (error) {
    console.error("[Team Auth] Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
});
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.substring(7);
    const context = await TeamAuthService.validateSession(token);
    if (!context) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    const member = await TeamService.getMemberWithRole(context.memberId);
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }
    const team = await TeamService.getTeamById(context.teamId);
    const permMap = {};
    for (const perm of context.permissions) {
      if (!permMap[perm.section]) {
        permMap[perm.section] = {};
      }
      permMap[perm.section][perm.subsection] = {
        canCreate: perm.canCreate,
        canRead: perm.canRead,
        canUpdate: perm.canUpdate,
        canDelete: perm.canDelete
      };
    }
    let teamDisplayName = team?.name || "My Team";
    if (team) {
      const [parentUser] = await db.select({ company: users.company }).from(users).where(eq(users.id, String(team.userId)));
      if (parentUser?.company && (teamDisplayName === "My Team" || !teamDisplayName)) {
        teamDisplayName = parentUser.company;
      }
    }
    res.json({
      member: {
        id: member.id,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
        status: member.status
      },
      team: team ? {
        id: team.id,
        name: teamDisplayName,
        type: "user",
        parentUserId: team.userId
      } : null,
      permissions: permMap,
      parentUserId: team?.userId
    });
  } catch (error) {
    console.error("[Team Auth] Get me error:", error);
    res.status(500).json({ error: "Failed to get member info" });
  }
});
router.post("/refresh", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.substring(7);
    const newToken = await TeamAuthService.refreshSession(token);
    if (!newToken) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    res.json({
      token: newToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1e3)
    });
  } catch (error) {
    console.error("[Team Auth] Refresh error:", error);
    res.status(500).json({ error: "Failed to refresh session" });
  }
});
router.get("/sessions", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.substring(7);
    const context = await TeamAuthService.validateSession(token);
    if (!context) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    const sessions = await TeamAuthService.getActiveSessions(context.memberId);
    res.json(sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent,
      isCurrent: s.token === token
    })));
  } catch (error) {
    console.error("[Team Auth] Get sessions error:", error);
    res.status(500).json({ error: "Failed to get sessions" });
  }
});
var team_auth_routes_default = router;
export {
  team_auth_routes_default as default
};
