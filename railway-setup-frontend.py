import urllib.request
import json

TOKEN = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
PROJECT_ID = "43e86cbf-c8ce-4359-9c07-be426ea6daea"
BACKEND_URL = "https://backend-production-5a89.up.railway.app"

def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        "https://backboard.railway.app/graphql/v2",
        data=body,
        headers={
            "Authorization": "Bearer " + TOKEN,
            "Content-Type": "application/json",
        }
    )
    try:
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read().decode())
        return data
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {"error": str(e), "body": body}

# Step 1: Get environments
print("=== Step 1: Get project environments ===")
r = gql("""
query {
  project(id: "%s") {
    environments { edges { node { id name } } }
    services { edges { node { id name } } }
  }
}
""" % PROJECT_ID)
print(json.dumps(r, indent=2))

envs = r.get("data", {}).get("project", {}).get("environments", {}).get("edges", [])
svcs = r.get("data", {}).get("project", {}).get("services", {}).get("edges", [])
env_id = envs[0]["node"]["id"] if envs else None
print(f"\nEnvironment ID: {env_id}")
print(f"Existing services: {[s['node']['name'] for s in svcs]}")

# Step 2: Create frontend service
print("\n=== Step 2: Create frontend service ===")
r2 = gql("""
mutation {
  serviceCreate(input: { projectId: "%s", name: "frontend" }) {
    id
    name
  }
}
""" % PROJECT_ID)
print(json.dumps(r2, indent=2))

svc_id = r2.get("data", {}).get("serviceCreate", {}).get("id")
print(f"\nFrontend service ID: {svc_id}")

if not svc_id:
    print("ERROR: Could not create service. Stopping.")
    exit(1)

# Step 3: Connect GitHub repo
print("\n=== Step 3: Connect GitHub repo ===")
r3 = gql("""
mutation {
  serviceConnect(
    id: "%s"
    input: {
      repo: "tashfeensohail99/tafai"
      branch: "main"
    }
  ) {
    id
    name
  }
}
""" % svc_id)
print(json.dumps(r3, indent=2))

# Step 4: Set service source to use Dockerfile.frontend
print("\n=== Step 4: Set Dockerfile path ===")
r4 = gql("""
mutation {
  serviceUpdate(
    id: "%s"
    input: {
      source: {
        repo: "tashfeensohail99/tafai"
        branch: "main"
      }
      buildConfig: {
        dockerfilePath: "Dockerfile.frontend"
        buildArgs: "NEXT_PUBLIC_API_URL=%s"
      }
    }
  ) {
    id
    name
  }
}
""" % (svc_id, BACKEND_URL))
print(json.dumps(r4, indent=2))

# Step 5: Set environment variables
print("\n=== Step 5: Set NEXT_PUBLIC_API_URL variable ===")
if env_id:
    r5 = gql("""
    mutation {
      variableUpsert(input: {
        projectId: "%s"
        environmentId: "%s"
        serviceId: "%s"
        name: "NEXT_PUBLIC_API_URL"
        value: "%s"
      })
    }
    """ % (PROJECT_ID, env_id, svc_id, BACKEND_URL))
    print(json.dumps(r5, indent=2))

# Step 6: Generate domain
print("\n=== Step 6: Create domain ===")
if env_id:
    r6 = gql("""
    mutation {
      serviceDomainCreate(input: {
        serviceId: "%s"
        environmentId: "%s"
      }) {
        domain
      }
    }
    """ % (svc_id, env_id))
    print(json.dumps(r6, indent=2))

print("\n=== Done ===")
print(f"Service ID: {svc_id}")
print("Check Railway dashboard to trigger first deployment.")
