import { Router } from "express";
import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
function createAdminSettingsRouter() {
  const router = Router();
  (async () => {
    try {
      await db.execute(sql`DROP TABLE IF EXISTS ve_sip_gateways CASCADE;`);
      console.log("[VE Admin] Deleted old ve_sip_gateways table");
    } catch (err) {
      console.error("[VE Admin] Failed to drop ve_sip_gateways table:", err.message);
    }
  })();
  router.get("/", async (_req, res) => {
    try {
      const result = await db.execute(
        sql`SELECT * FROM ve_freeswitch_nodes ORDER BY created_at ASC`
      );
      res.json({
        success: true,
        data: {
          nodes: result.rows,
          totalNodes: result.rows.length,
          onlineNodes: result.rows.filter((n) => n.status === "online").length
        }
      });
    } catch (err) {
      console.error("[VE Admin] Error fetching settings:", err.message);
      res.status(500).json({ success: false, error: "Failed to fetch settings" });
    }
  });
  router.get("/nodes", async (_req, res) => {
    try {
      const result = await db.execute(
        sql`SELECT * FROM ve_freeswitch_nodes ORDER BY created_at ASC`
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/nodes", async (req, res) => {
    try {
      const { name, eslHost, eslPort, eslPassword, sipHost, sipPort, wsPort, maxCalls, status } = req.body;
      if (!name || !eslHost || !eslPort || !sipHost || !sipPort || !wsPort) {
        return res.status(400).json({ success: false, error: "Missing required fields" });
      }
      const result = await db.execute(sql`
        INSERT INTO ve_freeswitch_nodes (name, esl_host, esl_port, esl_password, sip_host, sip_port, ws_port, max_calls, status)
        VALUES (${name}, ${eslHost}, ${eslPort}, ${eslPassword || "ClueCon"}, ${sipHost}, ${sipPort}, ${wsPort}, ${maxCalls || 100}, ${status || "offline"})
        RETURNING *
      `);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.put("/nodes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, eslHost, eslPort, eslPassword, sipHost, sipPort, wsPort, maxCalls, status } = req.body;
      const result = await db.execute(sql`
        UPDATE ve_freeswitch_nodes SET
          name = COALESCE(${name !== void 0 ? name : null}, name),
          esl_host = COALESCE(${eslHost !== void 0 ? eslHost : null}, esl_host),
          esl_port = COALESCE(${eslPort !== void 0 ? eslPort : null}, esl_port),
          esl_password = COALESCE(${eslPassword !== void 0 ? eslPassword : null}, esl_password),
          sip_host = COALESCE(${sipHost !== void 0 ? sipHost : null}, sip_host),
          sip_port = COALESCE(${sipPort !== void 0 ? sipPort : null}, sip_port),
          ws_port = COALESCE(${wsPort !== void 0 ? wsPort : null}, ws_port),
          max_calls = COALESCE(${maxCalls !== void 0 ? maxCalls : null}, max_calls),
          status = COALESCE(${status !== void 0 ? status : null}, status),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Node not found" });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.delete("/nodes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`DELETE FROM ve_freeswitch_nodes WHERE id = ${id}`);
      res.json({ success: true, message: "Node deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/ensure-twilio-gateway", async (req, res) => {
    try {
      const adminId = req.userId;
      const {
        userId = adminId,
        name = "twilio",
        proxy = process.env.TWILIO_SIP_PROXY || "",
        username = process.env.TWILIO_SIP_USERNAME || "calliqouser",
        password = process.env.TWILIO_SIP_PASSWORD || ""
      } = req.body;
      if (!proxy) {
        return res.status(400).json({
          success: false,
          error: 'proxy is required. Pass it in the request body or set TWILIO_SIP_PROXY env var (from twilio.xml <param name="proxy" value="..."/>).'
        });
      }
      const tableCheck = await db.execute(sql`
        SELECT to_regclass('public.user_sip_gateways') AS t
      `);
      const tableExists = tableCheck.rows[0]?.t !== null;
      if (!tableExists) {
        return res.status(503).json({
          success: false,
          error: "user_sip_gateways table does not exist. Please run the Custom Voice Engine migrations first."
        });
      }
      const existing = await db.execute(sql`
        SELECT id FROM user_sip_gateways WHERE user_id = ${userId} AND name = ${name} LIMIT 1
      `);
      let gateway;
      if (existing.rows.length > 0) {
        const result = await db.execute(sql`
          UPDATE user_sip_gateways
          SET proxy = ${proxy},
              username = ${username},
              password = ${password},
              is_active = true,
              updated_at = NOW()
          WHERE user_id = ${userId} AND name = ${name}
          RETURNING *
        `);
        gateway = result.rows[0];
        console.log(`[VE Admin] Updated Twilio SIP gateway for user ${userId}: ${proxy}`);
      } else {
        const result = await db.execute(sql`
          INSERT INTO user_sip_gateways (user_id, name, proxy, username, password, is_active)
          VALUES (${userId}, ${name}, ${proxy}, ${username}, ${password}, true)
          RETURNING *
        `);
        gateway = result.rows[0];
        console.log(`[VE Admin] Registered Twilio SIP gateway for user ${userId}: ${proxy}`);
      }
      res.json({
        success: true,
        message: `Twilio SIP gateway '${name}' registered successfully.`,
        data: gateway
      });
    } catch (err) {
      console.error("[VE Admin] ensure-twilio-gateway error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/gateways", async (req, res) => {
    try {
      const userId = req.userId;
      const targetUserId = req.query.userId || userId;
      const result = await db.execute(sql`
        SELECT id, user_id, name, proxy, username, is_active, created_at, updated_at
        FROM user_sip_gateways WHERE user_id = ${targetUserId} ORDER BY created_at ASC
      `);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.delete("/gateways/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`DELETE FROM user_sip_gateways WHERE id = ${id}`);
      res.json({ success: true, message: "Gateway deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  return router;
}
export {
  createAdminSettingsRouter
};
