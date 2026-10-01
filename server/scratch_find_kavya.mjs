import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  try {
    const res = await pool.query("SELECT id, name, user_id FROM flows ORDER BY created_at DESC");
    console.log("All flows:", res.rows);

    const agents = await pool.query("SELECT id, name, flow_id FROM openai_voice_agents WHERE name ILIKE '%kavya%' OR name ILIKE '%tricity%'");
    console.log("Agents matching Kavya:", agents.rows);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await pool.end();
  }
}

main();
