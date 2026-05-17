import requests

BASE = 'https://backend-production-5a89.up.railway.app'
token = requests.post(BASE+'/auth/login', json={'email':'omar.k@tashfeen.com','password':'Sales@123456'}, timeout=10).json()['accessToken']
hdrs = {'Authorization': 'Bearer '+token}
thread = '7cf398ff-a2be-42f4-8ba7-e9ded31dcc0b'

r = requests.get(f'{BASE}/whatsapp/threads/{thread}/messages', headers=hdrs, timeout=10)
data = r.json()
msgs = data if isinstance(data, list) else data.get('messages', [])
images = [m for m in msgs if m.get('type') == 'IMAGE']
print(f'Total messages: {len(msgs)}, IMAGE messages: {len(images)}')

if images:
    latest = images[-1]
    mid = latest['id']
    print(f'Latest image msg id: {mid}')
    r2 = requests.get(f'{BASE}/whatsapp/threads/{thread}/messages/{mid}/media', headers=hdrs, timeout=15)
    print(f'Media status: {r2.status_code}, Content-Type: {r2.headers.get("content-type")}, Size: {len(r2.content)} bytes')
