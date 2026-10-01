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
        "-c", "SELECT nodes FROM flows WHERE id = '-J9Y2QDoqCXkAg1leOwRA';"
    ]
    env = {"PGPASSWORD": "calliqoaiuser1password"}
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    nodes = json.loads(res.stdout.strip())
    print(f"Total Nodes: {len(nodes)}")
    for i, n in enumerate(nodes):
        nid = n.get('id')
        data = n.get('data', {})
        label = data.get('label')
        config = data.get('config', {})
        msg = config.get('message') or data.get('message') or data.get('content')
        print(f"[{i}] ID: {nid} | Label: {label} | Message: {msg}")

if __name__ == '__main__':
    main()
