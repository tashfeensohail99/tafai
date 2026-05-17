import urllib.request, json

tok = '33fa0d2e-6979-4f79-b999-a6851d35f78b'
project_id = '43e86cbf-c8ce-4359-9c07-be426ea6daea'

def gql(query, variables=None):
    payload = {'query': query}
    if variables:
        payload['variables'] = variables
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        'https://backboard.railway.app/graphql/v2',
        data=body,
        headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}
    )
    return json.loads(urllib.request.urlopen(req).read().decode())

# Get services and environments
result = gql('''
{
  project(id: "43e86cbf-c8ce-4359-9c07-be426ea6daea") {
    services { edges { node { id name } } }
    environments { edges { node { id name } } }
  }
}
''')
print(json.dumps(result['data'], indent=2))
