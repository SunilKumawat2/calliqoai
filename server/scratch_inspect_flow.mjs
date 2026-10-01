import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  try {
    const res = await pool.query("SELECT id, name, nodes, edges FROM flows WHERE name ILIKE '%realestate%' OR name ILIKE '%kavya%'");
    console.log("Found flows:", res.rows.length);
    for (const r of res.rows) {
      console.log("Flow ID:", r.id, "Name:", r.name);
      console.log("Nodes count:", Array.isArray(r.nodes) ? r.nodes.length : typeof r.nodes);
    }
    if (res.rows.length > 0) {
      console.log("Nodes structure:", JSON.stringify(res.rows[0].nodes, null, 2));
      console.log("Edges structure:", JSON.stringify(res.rows[0].edges, null, 2));
    }
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    await pool.end();
  }
}

main();
