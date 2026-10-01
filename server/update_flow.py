import subprocess
import json
import sys

# Get flows
def run_psql(query):
    cmd = [
        "psql",
        "-U", "calliqoaiuser1",
        "-d", "calliqoaidb",
        "-h", "localhost",
        "-t",
        "-A",
        "-c", query
    ]
    env = {"PGPASSWORD": "calliqoaiuser1password"}
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if res.returncode != 0:
        print("Error running query:", res.stderr)
        return None
    return res.stdout.strip()

def main():
    # 1. Fetch flows
    print("Fetching flows...")
    raw = run_psql("SELECT json_build_object('id', id, 'name', name, 'nodes', nodes, 'edges', edges) FROM flows WHERE name ILIKE '%realestate%' OR name ILIKE '%kavya%';")
    if not raw:
        print("No matching flows found or error.")
        return

    lines = [line.strip() for line in raw.split('\n') if line.strip()]
    for line in lines:
        try:
            flow = json.loads(line)
        except Exception as e:
            print("Failed to parse flow JSON:", e)
            continue

        flow_id = flow['id']
        name = flow['name']
        print(f"Processing Flow ID: {flow_id}, Name: {name}")

        nodes = flow.get('nodes', [])
        edges = flow.get('edges', [])
        if isinstance(nodes, str):
            nodes = json.loads(nodes)
        if isinstance(edges, str):
            edges = json.loads(edges)

        print(f"Nodes count: {len(nodes)}, Edges count: {len(edges)}")

        # Check if Intro node already exists
        intro_node = next((n for n in nodes if n.get('id') == 'node-kavya-intro' or 'काव्या बात कर रही' in str(n)), None)
        if intro_node:
            print(f"Intro node already present in flow {flow_id}. Updating message just in case...")
            if 'data' in intro_node and 'config' in intro_node['data']:
                intro_node['data']['config']['message'] = "नमस्ते! मैं काव्या बात कर रही हूँ ट्राई सिटी होम्स से। आपकी प्रॉपर्टी इन्क्वायरी आई थी — आप हिंदी या पंजाबी, किस भाषा में बात करना पसंद करेंगे?"
                intro_node['data']['config']['waitForResponse'] = True
        else:
            print("Creating node-kavya-intro...")
            # Find Welcome Greeting node
            welcome_node = next((n for n in nodes if n.get('id') == 'node-welcome' or 'welcome' in str(n.get('data', {}).get('label', '')).lower() or n.get('id') == 'node-1' or n.get('type') == 'start'), None)
            source_id = welcome_node['id'] if welcome_node else (nodes[0]['id'] if nodes else 'node-1')
            
            welcome_x = welcome_node.get('position', {}).get('x', 300) if welcome_node else 300
            welcome_y = welcome_node.get('position', {}).get('y', 50) if welcome_node else 50

            new_node = {
                "id": "node-kavya-intro",
                "type": "message",
                "position": {
                    "x": welcome_x,
                    "y": welcome_y + 130
                },
                "data": {
                    "type": "message",
                    "label": "Kavya Introduction & Language Choice",
                    "config": {
                        "type": "message",
                        "message": "नमस्ते! मैं काव्या बात कर रही हूँ ट्राई सिटी होम्स से। आपकी प्रॉपर्टी इन्क्वायरी आई थी — आप हिंदी या पंजाबी, किस भाषा में बात करना पसंद करेंगे?",
                        "waitForResponse": True
                    }
                }
            }

            # Find old edge from source_id
            old_edge_idx = -1
            target_id = "node-condition"
            for idx, e in enumerate(edges):
                if e.get('source') == source_id:
                    old_edge_idx = idx
                    target_id = e.get('target', target_id)
                    break
            
            if old_edge_idx != -1:
                print(f"Removing old edge {source_id} -> {target_id}")
                edges.pop(old_edge_idx)
            else:
                cond_node = next((n for n in nodes if n.get('type') == 'condition' or n.get('data', {}).get('type') == 'condition'), None)
                if cond_node:
                    target_id = cond_node['id']

            # Insert node after welcome node
            nodes.insert(1, new_node)

            # Shift down positions of subsequent nodes
            for i in range(2, len(nodes)):
                if 'position' in nodes[i] and 'y' in nodes[i]['position']:
                    nodes[i]['position']['y'] += 130

            # Add two new edges
            edges.append({
                "id": f"e-{source_id}-kavya-intro",
                "source": source_id,
                "target": "node-kavya-intro"
            })
            edges.append({
                "id": f"e-kavya-intro-{target_id}",
                "source": "node-kavya-intro",
                "target": target_id
            })

        # Save to DB
        nodes_json = json.dumps(nodes, ensure_ascii=False).replace("'", "''")
        edges_json = json.dumps(edges, ensure_ascii=False).replace("'", "''")

        update_query = f"UPDATE flows SET nodes = '{nodes_json}', edges = '{edges_json}' WHERE id = '{flow_id}';"
        res = run_psql(update_query)
        print(f"Update result for flow {flow_id}: SUCCESS")

if __name__ == '__main__':
    main()
