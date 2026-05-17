import requests, json, sys

TOKEN = 'rw_Fe26.2**b6e50784b488e4ada42d7d558bdb8dfd8c7b9a9d1de767327c844e8c97118d8e*jkjbpJ3p_VyNbhymYMw9VA*1mO4yxFlSHzKIbqgcpqQecRZKCv3q2EHchY3FrFmZZ7NKV3Uj7uKKcJ3o-RQLv5kpGSZMTycBAoT3o5a3Kmq8g*1781294159683*c1e48f174219a40f11a6f0d29d2152a2b46f94037a59f7fd6699ad629b605908*vPzAXLHnaC9svmJCStwK_GFC5Ui2gdTNZ0DtHXLGo4k'
PROJECT_ID = '43e86cbf-c8ce-4359-9c07-be426ea6daea'
ENV_ID     = '72b43bf0-ef3d-478d-82f5-378b43297c8d'
SERVICE_ID = 'e24b48dd-0d49-44ca-86e9-fbee22bdfab8'

HEADERS = {
    'Authorization': 'Bearer ' + TOKEN,
    'Content-Type': 'application/json',
}
GQL = 'https://backboard.railway.app/graphql/v2'

def gql(query, variables=None):
    r = requests.post(GQL, headers=HEADERS, json={'query': query, 'variables': variables or {}}, timeout=15)
    r.raise_for_status()
    data = r.json()
    if 'errors' in data:
        print('GQL errors:', data['errors'])
        sys.exit(1)
    return data['data']

# ── 1. List services ────────────────────────────────────────────────────────
LIST_SERVICES = """
query ListServices($projectId: String!) {
  project(id: $projectId) {
    services { edges { node { id name } } }
  }
}
"""
data = gql(LIST_SERVICES, {'projectId': PROJECT_ID})
services = data['project']['services']['edges']
print('Services in project:')
for s in services:
    print('  ', s['node']['id'], '-', s['node']['name'])

# Pick backend service
backend = next((s['node'] for s in services if 'backend' in s['node']['name'].lower()), None)
if not backend:
    print('ERROR: No backend service found!')
    sys.exit(1)

SERVICE_ID = backend['id']
print(f'\nUsing backend service: {SERVICE_ID} ({backend["name"]})')

# ── 2. Upsert SMTP variables (non-sensitive ones) ───────────────────────────
UPSERT = """
mutation UpsertVariables($input: VariableCollectionUpsertInput!) {
  variableCollectionUpsert(input: $input)
}
"""

smtp_vars = {
    'SMTP_HOST':      'smtp.hostinger.com',
    'SMTP_PORT':      '465',
    'SMTP_SECURE':    'true',
    'SMTP_USER':      'admin@tashfeengroup.com',
    'SMTP_FROM_NAME': 'Tashfeen Immigration',
    'IMAP_HOST':      'imap.hostinger.com',
    'IMAP_PORT':      '993',
    'IMAP_SECURE':    'true',
}

# Add SMTP_PASS if passed as arg
if len(sys.argv) > 1:
    smtp_vars['SMTP_PASS'] = sys.argv[1]
    smtp_vars['IMAP_PASS'] = sys.argv[1]  # same password for IMAP

result = gql(UPSERT, {
    'input': {
        'projectId': PROJECT_ID,
        'environmentId': ENV_ID,
        'serviceId': SERVICE_ID,
        'variables': smtp_vars,
    }
})
print('\nVariables set:')
for k, v in smtp_vars.items():
    if 'PASS' in k:
        print(f'  {k} = ***')
    else:
        print(f'  {k} = {v}')
print('\nDone. Railway will redeploy the backend automatically.')
