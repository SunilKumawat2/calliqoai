import subprocess
import json
import re

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
    print("=== INSPECTING AND FIXING ALL FLOWS ===")
    flows_raw = run_psql("SELECT id, name, nodes FROM flows;")
    if not flows_raw:
        print("No flows returned.")
        return

    # Split lines
    raw_json = run_psql("SELECT json_agg(json_build_object('id', id, 'name', name, 'nodes', nodes)) FROM flows;")
    if not raw_json:
        print("Could not retrieve JSON flows.")
        return

    flows = json.loads(raw_json)
    for flow in flows:
        flow_id = flow['id']
        name = flow['name']
        print(f"\nFlow: {name} ({flow_id})")
        
        nodes = flow['nodes']
        if isinstance(nodes, str):
            nodes = json.loads(nodes)

        changed = False
        for node in nodes:
            data = node.get('data', {})
            config = data.get('config', {})
            label = data.get('label', '')
            msg = config.get('message', '') or data.get('content', '') or data.get('message', '')
            
            print(f"  [Node {node.get('id')}] Label: '{label}', Msg: '{msg}'")

            # Check if message contains 'noted' or 'samajh' in any form (case-insensitive)
            if msg:
                clean_msg = msg
                # Regex replacements for fillers
                patterns = [
                    r'Achha[,\s]+noted[\.\,\s]*',
                    r'Achha noted[\.\,\s]*',
                    r'Noted[\.\,\s]*',
                    r'noted[\.\,\s]*',
                    r'Main note kar rahi hoon[\.\,\s]*',
                    r'Main note kar lendi aan[\.\,\s]*',
                    r'Main samajh gayi[^\.\,\?\!]*[\.\,\s]*',
                    r'Main samajh rahi hoon[^\.\,\?\!]*[\.\,\s]*',
                    r'Theek hai noted[\.\,\s]*'
                ]
                for p in patterns:
                    clean_msg = re.sub(p, '', clean_msg, flags=re.IGNORECASE).strip()

                if clean_msg != msg:
                    print(f"    👉 CLEANED: '{msg}' --> '{clean_msg}'")
                    if 'config' in data and 'message' in config:
                        config['message'] = clean_msg
                    if 'content' in data:
                        data['content'] = clean_msg
                    if 'message' in data:
                        data['message'] = clean_msg
                    changed = True

        if changed:
            nodes_json = json.dumps(nodes, ensure_ascii=False).replace("'", "''")
            run_psql(f"UPDATE flows SET nodes = '{nodes_json}' WHERE id = '{flow_id}';")
            print(f"  ✅ Flow {flow_id} updated with cleaned node messages!")
        else:
            print("  ℹ️ No fillers found to clean in this flow.")

    # Also make sure the Agent's system prompt has an absolute prohibition
    print("\n=== AGENTS CHECK ===")
    agents_raw = run_psql("SELECT json_agg(json_build_object('id', id, 'name', name)) FROM agents WHERE name ILIKE '%kavya%' OR name ILIKE '%tricity%';")
    if agents_raw:
        agents = json.loads(agents_raw)
        super_prompt = """# 1. IDENTITY & DUAL LANGUAGE (HINDI & PUNJABI)
- Name: Kavya
- Role: Senior Female Real Estate Consultant, Tri City Homes (Chandigarh, Mohali, Panchkula, Zirakpur, New Chandigarh).
- Tone: Polite, direct, natural, crisp, and 100% FEMALE.
- Languages: Natural Hindi/Hinglish AND 100% Pure Punjabi.

# 2. ZERO-FILLER & ZERO REPETITION (HIGHEST PRIORITY - STRICT ENFORCEMENT)
- BANNED WORDS/PHRASES (KABHI NA BOLEIN):
  ❌ "Noted" / "Achha noted" / "Theek hai noted" / "Noted sir" / "Noted ma'am"
  ❌ "Main note kar rahi hoon" / "Maine note kar liya" / "Main note kar lendi aan"
  ❌ "Main samajh gayi" / "Main samajh rahi hoon" / "Samajh gayi aan"
  ❌ "Achha ji" / "Theek hai ji" (baat-baat par mat bolein)
- NO ECHOING: User ki baat ko repeat mat karein (e.g. agar user kahe "3 BHK in Mohali", toh "Aapko 3 BHK chahiye Mohali mein" KABHI MAT BOLEIN. Seedha next question puchein).
- Seedha point-to-point agla sawal ya jaankari dein. Call duration ko bilkul short aur clear rakhein.

# 3. STRICT FLOW BUILDER PUNJABI TRANSLATION RULE (MANDATORY)
- Jab user Punjabi me bole ya Punjabi choose kare:
  - Flow Builder nodes ke Hindi content ko 100% Sweet & Natural Punjabi me translate karke bolein:
    * "Aap kis area me property dekh rahe hain?" 👉 "Tussi kehde area vich property dekh rahe ho ji?"
    * "Budget range kya soch rahe hain?" 👉 "Te thoda budget kinna tak da hai ji?"
    * "Main aapko details share kar deti hoon" 👉 "Main thonu saari photos te details WhatsApp te share kar dindi aan."
    * "Aapko visit ke liye kab convenient rahega?" 👉 "Thonu site visit layi kehda din ya time sahi rahega ji?"

# 4. FEMALE GRAMMAR ONLY
- Use 100% Female verbs:
  - Hindi: "Main bata rahi hoon", "Main bhejti hoon", "Main help kar sakti hoon".
  - Punjabi: "Main das rahi aan", "Main bhej dindi aan", "Main help kar sakdi aan".

# 5. TRICITY LOCATIONS (CONTINUOUS FLOW)
- Chandigarh, Mohali (Airport Road, Sector 82, Sector 66, Kharar), Zirakpur (PR7, VIP Road), Panchkula, New Chandigarh.
- Bina pause ya gap ke ek natural rhythm me bolein."""

        escaped_prompt = super_prompt.replace("'", "''")
        for ag in agents:
            ag_id = ag['id']
            run_psql(f"UPDATE agents SET system_prompt = '{escaped_prompt}' WHERE id = '{ag_id}';")
            print(f"✅ Updated Agent {ag['name']} ({ag_id}) with zero-filler prompt!")

if __name__ == '__main__':
    main()
