import { Router } from "express";
import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
function createMemoryRouter() {
  const router = Router();
  router.get("/", async (req, res) => {
    try {
      const userId = req.userId;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const offset = ((parseInt(req.query.page) || 1) - 1) * limit;
      const result = await db.execute(
        sql`SELECT * FROM ve_customer_memory WHERE user_id = ${userId} ORDER BY last_interaction_at DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.get("/:id", async (req, res) => {
    try {
      const userId = req.userId;
      const memResult = await db.execute(
        sql`SELECT * FROM ve_customer_memory WHERE id = ${req.params.id} AND user_id = ${userId} LIMIT 1`
      );
      if (memResult.rows.length === 0) return res.status(404).json({ success: false, error: "Not found" });
      const facts = await db.execute(sql`SELECT * FROM ve_customer_facts WHERE memory_id = ${req.params.id} ORDER BY extracted_at DESC LIMIT 50`);
      const history = await db.execute(sql`SELECT * FROM ve_conversation_memory WHERE memory_id = ${req.params.id} ORDER BY call_date DESC LIMIT 20`);
      res.json({ success: true, data: { ...memResult.rows[0], facts: facts.rows, callHistory: history.rows } });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  router.put("/:id", async (req, res) => {
    try {
      const userId = req.userId;
      const { customerName, customerEmail, customerCompany, language, timezone } = req.body;
      await db.execute(sql`UPDATE ve_customer_memory SET customer_name = COALESCE(${customerName}, customer_name), customer_email = COALESCE(${customerEmail}, customer_email), customer_company = COALESCE(${customerCompany}, customer_company), language = COALESCE(${language}, language), timezone = COALESCE(${timezone}, timezone), updated_at = NOW() WHERE id = ${req.params.id} AND user_id = ${userId}`);
      res.json({ success: true, message: "Updated" });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
  return router;
}
export {
  createMemoryRouter
};
