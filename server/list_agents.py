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
        "-c", "SELECT id, name, flow_id, first_message FROM agents;"
    ]
    env = {"PGPASSWORD": "calliqoaiuser1password"}
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    for line in res.stdout.strip().split('\n'):
        if line.strip():
            parts = line.split('|')
            print(f"ID: {parts[0]} | Name: {parts[1]} | FlowID: {parts[2] if len(parts)>2 else ''} | FirstMsg: {parts[3][:60] if len(parts)>3 else ''}")

if __name__ == '__main__':
    main()
