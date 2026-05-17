import urllib.request, json

token = "rw_Fe26.2**e803d7918e3d5e3c64bc0f8c8cfa468dcb9faf5fc18fe4b4c8bdd5b999333343*vnb4ECT2BPk_wQnO7mmxnQ*_0A2iY_JS5pduL9uta4CNVa58b_-Whe5TApIbsNKxLIVd8y2A61WPtFmfBIDIZ3-lFPhH2lXLr7l0qlzGPBUpQ*1781160087168*12bbed4576b9aac3c9841e718840b5d95f5e006b68bf623e405ab968cfc996fd*YukYRWszQ766Or-_s6xHryOKv8EMaDZfP61DHGQ3BDc"
service_id     = "e24b48dd-0d49-44ca-86e9-fbee22bdfab8"
environment_id = "72b43bf0-ef3d-478d-82f5-378b43297c8d"
project_id     = "43e86cbf-c8ce-4359-9c07-be426ea6daea"

query = """
query GetVars($projectId: String!, $serviceId: String!, $environmentId: String!) {
  variables(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId)
}
"""

body = json.dumps({
    "query": query,
    "variables": {"projectId": project_id, "serviceId": service_id, "environmentId": environment_id}
}).encode()
req = urllib.request.Request(
    "https://backboard.railway.app/graphql/v2",
    data=body,
    headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "User-Agent": "railway-cli/3.11.4"
    }
)
try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read().decode())
    with open(r"d:\tafsheen\railway-vars-dump.json", "w") as f:
        json.dump(data, f, indent=2)
    vars_ = data.get("data", {}).get("variables", {})
    if isinstance(vars_, dict):
        print("=== DB / SUPABASE VARS ===")
        for k, v in vars_.items():
            if any(x in k.upper() for x in ["DATABASE", "SUPABASE", "DB_", "DIRECT", "POSTGRES"]):
                print(f"  {k} = {v}")
        print("\n=== ALL KEYS ===")
        for k in sorted(vars_.keys()):
            print(f"  {k}")
    else:
        print(json.dumps(data, indent=2))
except urllib.error.HTTPError as e:
    body_err = e.read().decode()
    print(f"HTTP {e.code}: {e.reason}")
    print(body_err)
    with open(r"d:\tafsheen\railway-vars-dump.json", "w") as f:
        f.write(body_err)
