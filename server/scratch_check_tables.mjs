import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    console.log("Tables:", res.rows.map(r => r.table_name));

    const agents = await pool.query("SELECT id, name, voice_id FROM agents");
    console.log("Agents:", agents.rows);

    const flows = await pool.query("SELECT id, name, nodes FROM flows");
    console.log("Flows count:", flows.rows.length);
    for (const f of flows.rows) {
      console.log("- Flow:", f.id, f.name);
    }
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await pool.end();
  }
}

main();
