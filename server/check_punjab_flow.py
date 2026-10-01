import subprocess
import json

def main():
    cmd = [
        "psql",
        "-U", "calliqoaiuser1",
        "-d", "calliqoaidb",
        "-h", "localhost",
        "-t",
        "-A",
        "-c", "SELECT json_build_object('id', id, 'name', name, 'nodes', nodes, 'edges', edges) FROM flows WHERE name ILIKE '%panjab%' OR name ILIKE '%feedback%';"
    ]
    env = {"PGPASSWORD": "calliqoaiuser1password"}
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    for line in res.stdout.strip().split('\n'):
        if not line.strip():
            continue
        flow = json.loads(line)
        print(f"\nFlow Name: {flow.get('name')} (ID: {flow.get('id')})")
        nodes = flow.get('nodes', [])
        if isinstance(nodes, str):
            nodes = json.loads(nodes)
        for i, n in enumerate(nodes):
            nid = n.get('id')
            data = n.get('data', {})
            label = data.get('label')
            config = data.get('config', {})
            msg = config.get('message') or data.get('message') or data.get('content') or config.get('question')
            print(f"  [{i+1}] ID: {nid} | Label: {label} | Question/Message: {msg}")

if __name__ == '__main__':
    main()
