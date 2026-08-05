import { Router } from "express";
import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
function createRecordingsRouter() {
  const router = Router();
  router.get("/", async (req, res) => {
    try {
      const userId = req.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = (page - 1) * limit;
      const result = await db.execute(sql`
        SELECT r.*, s.from_number, s.to_number, s.direction, s.ai_summary
        FROM ve_call_recordings r
        LEFT JOIN ve_sessions s ON r.session_id = s.id
        WHERE r.user_id = ${userId} AND r.status = 'available'
        ORDER BY r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/:id", async (req, res) => {
    try {
      const userId = req.userId;
      const result = await db.execute(
        sql`SELECT * FROM ve_call_recordings WHERE id = ${req.params.id} AND user_id = ${userId} LIMIT 1`
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Recording not found" });
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.delete("/:id", async (req, res) => {
    try {
      const userId = req.userId;
      await db.execute(
        sql`UPDATE ve_call_recordings SET status = 'deleted' WHERE id = ${req.params.id} AND user_id = ${userId}`
      );
      res.json({ success: true, message: "Recording deleted" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  return router;
}
export {
  createRecordingsRouter
};
