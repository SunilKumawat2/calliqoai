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
        "-c", "SELECT id, name, flow_id, system_prompt, first_message FROM agents WHERE name ILIKE '%pm%' OR name ILIKE '%panjab%' OR name ILIKE '%feedback%';"
    ]
    env = {"PGPASSWORD": "calliqoaiuser1password"}
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    print("Agents matching feedback/PM/panjab:")
    print(res.stdout)

if __name__ == '__main__':
    main()
