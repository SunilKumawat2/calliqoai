import { Router } from "express";
import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
function createAnalyticsRouter() {
  const router = Router();
  router.get("/dashboard", async (req, res) => {
    try {
      const userId = req.userId;
      const days = parseInt(req.query.days) || 30;
      const [calls, usage, active] = await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int as total, COALESCE(AVG(duration_seconds), 0)::int as avg_duration, COALESCE(SUM(duration_seconds), 0)::int as total_duration, COUNT(CASE WHEN direction = 'inbound' THEN 1 END)::int as inbound, COUNT(CASE WHEN direction = 'outbound' THEN 1 END)::int as outbound FROM ve_sessions WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '1 day' * ${days}`),
        db.execute(sql`SELECT COALESCE(SUM(total_cost), 0) as total_cost, COALESCE(SUM(stt_cost), 0) as stt_cost, COALESCE(SUM(llm_cost), 0) as llm_cost, COALESCE(SUM(tts_cost), 0) as tts_cost, COALESCE(SUM(llm_prompt_tokens + llm_completion_tokens), 0)::int as total_tokens FROM ve_usage_tracking WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '1 day' * ${days}`),
        db.execute(sql`SELECT COUNT(*)::int as count FROM ve_sessions WHERE user_id = ${userId} AND status = 'active'`)
      ]);
      res.json({
        success: true,
        data: {
          calls: calls.rows[0],
          usage: usage.rows[0],
          activeCalls: active.rows[0]?.count || 0
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/calls-per-day", async (req, res) => {
    try {
      const userId = req.userId;
      const days = parseInt(req.query.days) || 30;
      const result = await db.execute(sql`SELECT DATE(created_at) as date, COUNT(*)::int as calls, COALESCE(AVG(duration_seconds), 0)::int as avg_duration FROM ve_sessions WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '1 day' * ${days} GROUP BY DATE(created_at) ORDER BY date ASC`);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/provider-latency", async (req, res) => {
    try {
      const userId = req.userId;
      const result = await db.execute(sql`SELECT stt_provider, llm_provider, tts_provider, COUNT(*)::int as calls, COALESCE(AVG(stt_duration_ms), 0)::int as avg_stt_ms, COALESCE(AVG(tts_duration_ms), 0)::int as avg_tts_ms FROM ve_sessions WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '7 days' GROUP BY stt_provider, llm_provider, tts_provider`);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  return router;
}
export {
  createAnalyticsRouter
};
