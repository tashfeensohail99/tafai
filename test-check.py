"""Fix tests - correct field names and check client user"""
import urllib.request, json, urllib.error

BASE = "https://backend-production-5a89.up.railway.app"

def req(method, path, payload=None, token=None):
    body = json.dumps(payload).encode() if payload else None
    headers = {"Content-Type": "application/json", "User-Agent": "tashfeen-test/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=20)
        return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except:
            return e.code, raw[:400]

# Admin token
s, b = req("POST", "/auth/login", {"email":"admin@tashfeen.com","password":"Admin@123456"})
tok = b.get("accessToken") or (b.get("tokens") or {}).get("accessToken")
print(f"Admin login: {s}  token={'ok' if tok else 'MISSING'}")

# Check users
s, b = req("GET", "/users", token=tok)
print(f"\nGET /users: {s}")
if isinstance(b, list):
    for u in b:
        print(f"  - {u.get('email')}  id={u.get('id')}")
elif isinstance(b, dict):
    data = b.get("data", b.get("users", []))
    for u in (data if isinstance(data, list) else [b]):
        print(f"  - {u.get('email')}  id={u.get('id')}")

# Try correct lead fields
print("\n--- Testing lead creation with correct fields ---")
s, b = req("POST", "/leads", {
    "firstName": "Ahmed",
    "lastName": "Siddiqui",
    "phone": "+923001234501",
    "email": "ahmed.test001@example.com",
    "sourceChannel": "WALK_IN",
    "targetCountry": "Canada",
    "notes": "Test lead"
}, tok)
print(f"Lead create: {s}")
if s in (200,201):
    print(f"  id={b.get('id')}  name={b.get('firstName')}")
else:
    print(f"  Error: {b}")

# Check audit logs route
for route in ["/audit-logs", "/audit", "/admin/audit-logs"]:
    s, b = req("GET", route, token=tok)
    print(f"Audit route {route}: {s}")
    if s == 200:
        print(f"  Found! data={str(b)[:80]}")
        break

# Check WhatsApp routing settings
for route in ["/whatsapp/settings", "/whatsapp/routing/settings", "/whatsapp/config"]:
    s, b = req("GET", route, token=tok)
    print(f"WA settings {route}: {s}")
    if s == 200:
        print(f"  Found!")
        break
