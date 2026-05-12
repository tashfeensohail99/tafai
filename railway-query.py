import urllib.request, json

tok = "33fa0d2e-6979-4f79-b999-a6851d35f78b"
project_id = "43e86cbf-c8ce-4359-9c07-be426ea6daea"

query = """
{
  project(id: "%s") {
    id
    name
    services {
      edges {
        node {
          id
          name
        }
      }
    }
    environments {
      edges {
        node {
          id
          name
        }
      }
    }
  }
}
""" % project_id

body = json.dumps({"query": query}).encode()
req = urllib.request.Request(
    "https://backboard.railway.app/graphql/v2",
    data=body,
    headers={
        "Authorization": "Bearer " + tok,
        "Content-Type": "application/json"
    }
)
resp = urllib.request.urlopen(req)
data = json.loads(resp.read().decode())
print(json.dumps(data, indent=2))
