import subprocess
import json

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
    return res.stdout.strip()

def main():
    raw = run_psql("SELECT nodes FROM flows WHERE id = '-J9Y2QDoqCXkAg1leOwRA';")
    nodes = json.loads(raw)

    for n in nodes:
        nid = n.get('id')
        data = n.get('data', {})
        config = data.get('config', {})

        if nid == 'node-kavya-intro':
            config['message'] = "नमस्ते! मैं काव्या बात कर रही हूँ ट्राई सिटी होम्स से। आपकी प्रॉपर्टी इन्क्वायरी आई थी — आप हिंदी या पंजाबी, किस भाषा में बात करना पसंद करेंगे?"
            data['message'] = config['message']
        elif nid == 'node-1788003669669':
            # Remove "Acha to, "
            config['message'] = "Aapko kaise convenient rahega — main aapko kuch minutes mein wapas call kar loon, ya aap khud reach out kar lenge jab aapko pictures pasand aa jaayein?"
            data['message'] = config['message']
        elif nid == 'node-1788002866881':
            # Clean up "ok perfect to"
            config['message'] = "Aapki requirement ke basis par hamare paas best options hain."
            data['message'] = config['message']
        elif nid == 'node-1788003768301':
            config['message'] = "Main aapko sabhi property ki pictures WhatsApp par share kar deti hoon, fir aapki choice ke according hum site visit arrange kar sakte hain."
            data['message'] = config['message']

    nodes_json = json.dumps(nodes, ensure_ascii=False).replace("'", "''")
    run_psql(f"UPDATE flows SET nodes = '{nodes_json}' WHERE id = '-J9Y2QDoqCXkAg1leOwRA';")
    print("Updated all nodes cleanly!")

if __name__ == '__main__':
    main()
