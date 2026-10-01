import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  try {
    const agents = await pool.query("SELECT id, name FROM agents");
    console.log("Agents in DB:", agents.rows);

    const flows = await pool.query("SELECT id, name, user_id FROM flows");
    console.log("Flows in DB:", flows.rows);
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await pool.end();
  }
}

main();
