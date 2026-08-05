import { Router } from "express";
import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
function createAdminSettingsRouter() {
  const router = Router();
  (async () => {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ve_sip_gateways (
            id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
            name TEXT NOT NULL,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            proxy TEXT NOT NULL,
            register BOOLEAN NOT NULL DEFAULT false,
            caller_id_in_from BOOLEAN NOT NULL DEFAULT true,
            is_active BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
    } catch (err) {
      console.error("[VE Admin] Failed to ensure ve_sip_gateways table exists:", err.message);
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
      const { name, eslHost, eslPort, eslPassword, sipHost, sipPort, wsPort, maxCalls } = req.body;
      if (!name || !sipHost) {
        return res.status(400).json({ success: false, error: "name and sipHost are required" });
      }
      const result = await db.execute(sql`
        INSERT INTO ve_freeswitch_nodes (name, esl_host, esl_port, esl_password, sip_host, sip_port, ws_port, max_calls)
        VALUES (${name}, ${eslHost || "127.0.0.1"}, ${eslPort || 8021}, ${eslPassword || "ClueCon"}, ${sipHost}, ${sipPort || 5060}, ${wsPort || 8089}, ${maxCalls || 100})
        RETURNING *
      `);
      res.json({ success: true, data: result.rows[0] });
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
          name = COALESCE(${name}, name),
          esl_host = COALESCE(${eslHost}, esl_host),
          esl_port = COALESCE(${eslPort}, esl_port),
          esl_password = COALESCE(${eslPassword}, esl_password),
          sip_host = COALESCE(${sipHost}, sip_host),
          sip_port = COALESCE(${sipPort}, sip_port),
          ws_port = COALESCE(${wsPort}, ws_port),
          max_calls = COALESCE(${maxCalls}, max_calls),
          status = COALESCE(${status}, status),
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
  router.get("/sip-gateways", async (_req, res) => {
    try {
      const result = await db.execute(
        sql`SELECT * FROM ve_sip_gateways ORDER BY created_at ASC`
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/sip-gateways", async (req, res) => {
    try {
      const { name, username, password, proxy, register, callerIdInFrom } = req.body;
      if (!name || !username || !password || !proxy) {
        return res.status(400).json({ success: false, error: "name, username, password, and proxy are required" });
      }
      const result = await db.execute(sql`
        INSERT INTO ve_sip_gateways (name, username, password, proxy, register, caller_id_in_from)
        VALUES (${name}, ${username}, ${password}, ${proxy}, ${register ?? false}, ${callerIdInFrom ?? true})
        RETURNING *
      `);
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.put("/sip-gateways/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, username, password, proxy, register, callerIdInFrom, isActive } = req.body;
      const result = await db.execute(sql`
        UPDATE ve_sip_gateways SET
          name = COALESCE(${name !== void 0 ? name : null}, name),
          username = COALESCE(${username !== void 0 ? username : null}, username),
          password = COALESCE(${password !== void 0 ? password : null}, password),
          proxy = COALESCE(${proxy !== void 0 ? proxy : null}, proxy),
          register = COALESCE(${register !== void 0 ? register : null}, register),
          caller_id_in_from = COALESCE(${callerIdInFrom !== void 0 ? callerIdInFrom : null}, caller_id_in_from),
          is_active = COALESCE(${isActive !== void 0 ? isActive : null}, is_active),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "SIP Gateway not found" });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.delete("/sip-gateways/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`DELETE FROM ve_sip_gateways WHERE id = ${id}`);
      res.json({ success: true, message: "SIP Gateway deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.post("/sip-gateways/:id/activate", async (req, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`UPDATE ve_sip_gateways SET is_active = false`);
      const result = await db.execute(sql`
        UPDATE ve_sip_gateways SET is_active = true WHERE id = ${id} RETURNING *
      `);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "SIP Gateway not found" });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  return router;
}
export {
  createAdminSettingsRouter
};
