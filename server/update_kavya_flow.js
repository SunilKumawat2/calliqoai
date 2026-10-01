const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://calliqoaiuser1:calliqoaiuser1password@localhost:5432/calliqoaidb'
});

async function main() {
  try {
    // 1. Find all flows with name 'Realestate' or similar
    const res = await pool.query("SELECT id, name, nodes, edges, user_id FROM flows WHERE name ILIKE '%realestate%' OR name ILIKE '%kavya%'");
    console.log("Found flows count:", res.rows.length);

    for (const flow of res.rows) {
      console.log("Processing flow ID:", flow.id, "Name:", flow.name);
      let nodes = typeof flow.nodes === 'string' ? JSON.parse(flow.nodes) : flow.nodes;
      let edges = typeof flow.edges === 'string' ? JSON.parse(flow.edges) : flow.edges;

      if (!Array.isArray(nodes)) nodes = [];
      if (!Array.isArray(edges)) edges = [];

      console.log("Current nodes count:", nodes.length);
      console.log("Current edges count:", edges.length);

      // Check if introduction node already exists
      const existingIntro = nodes.find(n => n.id === 'node-kavya-intro' || (n.data && n.data.config && n.data.config.message && n.data.config.message.includes('काव्या बात कर रही')));
      
      if (!existingIntro) {
        // Find Welcome Greeting node
        const welcomeNode = nodes.find(n => n.id === 'node-welcome' || (n.data && n.data.label && n.data.label.toLowerCase().includes('welcome')) || n.id === 'node-1' || n.type === 'start' || (n.data && n.data.type === 'start'));
        
        console.log("Welcome node found:", welcomeNode ? welcomeNode.id : "none (using first node)");
        const sourceNodeId = welcomeNode ? welcomeNode.id : (nodes[0] ? nodes[0].id : 'node-1');

        // Create new Introduction message node
        const newIntroNode = {
          id: 'node-kavya-intro',
          type: 'message',
          position: {
            x: (welcomeNode && welcomeNode.position ? welcomeNode.position.x : 300),
            y: (welcomeNode && welcomeNode.position ? welcomeNode.position.y + 120 : 150)
          },
          data: {
            type: 'message',
            label: 'Kavya Introduction & Language Choice',
            config: {
              type: 'message',
              message: 'नमस्ते! मैं काव्या बात कर रही हूँ ट्राई सिटी होम्स से। आपकी प्रॉपर्टी इन्क्वायरी आई थी — आप हिंदी या पंजाबी, किस भाषा में बात करना पसंद करेंगे?',
              waitForResponse: true
            }
          }
        };

        // Find existing edge from welcomeNode to next node (e.g. condition node)
        const oldEdgeIndex = edges.findIndex(e => e.source === sourceNodeId);
        let targetNodeId = 'node-condition';

        if (oldEdgeIndex !== -1) {
          targetNodeId = edges[oldEdgeIndex].target;
          console.log("Rerouting edge from", sourceNodeId, "->", targetNodeId, "to go through node-kavya-intro");
          // Remove old direct edge
          edges.splice(oldEdgeIndex, 1);
        } else {
          // Find condition node
          const condNode = nodes.find(n => n.type === 'condition' || (n.data && n.data.type === 'condition'));
          if (condNode) targetNodeId = condNode.id;
        }

        // Insert new node
        nodes.splice(1, 0, newIntroNode);

        // Adjust Y positions of subsequent nodes downwards so graph stays clean
        for (let i = 2; i < nodes.length; i++) {
          if (nodes[i].position && nodes[i].position.y) {
            nodes[i].position.y += 130;
          }
        }

        // Add 2 new edges:
        // 1) welcomeNode -> node-kavya-intro
        edges.push({
          id: `e-${sourceNodeId}-kavya-intro`,
          source: sourceNodeId,
          target: 'node-kavya-intro'
        });

        // 2) node-kavya-intro -> targetNodeId
        edges.push({
          id: `e-kavya-intro-${targetNodeId}`,
          source: 'node-kavya-intro',
          target: targetNodeId
        });

        console.log("Updated nodes count:", nodes.length);
        console.log("Updated edges count:", edges.length);

        // Save back to DB
        await pool.query("UPDATE flows SET nodes = $1, edges = $2 WHERE id = $3", [
          JSON.stringify(nodes),
          JSON.stringify(edges),
          flow.id
        ]);
        console.log("Successfully updated flow in database!");
      } else {
        console.log("Introduction node already present in flow:", flow.id);
      }
    }
  } catch (err) {
    console.error("Error updating flow:", err);
  } finally {
    await pool.end();
  }
}

main();
