import psycopg2
import requests
import base64
import json
import uuid
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DB = "postgresql://postgres.fpnoyngotalmtxnhjldh:Tafsheenmain@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres"
ENC_KEY = bytes.fromhex("179a10fa904f236432718787c85dc4a29fcefac807723bbe46254d0ee562d752")
IMG_PATH = r"D:\tafsheen\color.jpeg"
GRAPH = "v21.0"


def decrypt(ciphertext):
    iv_b64, data_b64, tag_b64 = ciphertext.split(":")
    iv = base64.b64decode(iv_b64)
    data = base64.b64decode(data_b64)
    tag = base64.b64decode(tag_b64)
    aesgcm = AESGCM(ENC_KEY)
    return aesgcm.decrypt(iv, data + tag, None).decode()


conn = psycopg2.connect(DB)
cur = conn.cursor()

# Get channel
cur.execute('SELECT id, "phoneNumberId", "accessTokenEnc" FROM whatsapp.channels LIMIT 1')
row = cur.fetchone()
if not row:
    print("No WhatsApp channel configured!")
    exit(1)

channel_id, phone_number_id, token_enc = row
print(f"Channel: {channel_id[:8]}... phone={phone_number_id}")

access_token = decrypt(token_enc)
print(f"Token decrypted OK ({len(access_token)} chars)")

# Upload image to Meta Media API
with open(IMG_PATH, "rb") as f:
    img = f.read()

r = requests.post(
    f"https://graph.facebook.com/{GRAPH}/{phone_number_id}/media",
    headers={"Authorization": f"Bearer {access_token}"},
    data={"messaging_product": "whatsapp", "type": "image/jpeg"},
    files={"file": ("color.jpeg", img, "image/jpeg")},
    timeout=30,
)
print(f"Upload: {r.status_code} {r.text[:300]}")
if not r.ok:
    exit(1)

media_id = r.json()["id"]
print(f"Meta media_id: {media_id}")

# Find open threads, prefer Omar's
cur.execute("""
    SELECT t.id, t."waContactId", e."firstName"
    FROM whatsapp.threads t
    LEFT JOIN crm.leads l ON l.id = t."leadId"
    LEFT JOIN core.employees e ON e.id = l."assignedEmployeeId"
    WHERE t.status = 'OPEN'
    ORDER BY t."lastMessageAt" DESC NULLS LAST
    LIMIT 10
""")
threads = cur.fetchall()
print("\nOpen threads:")
for t in threads:
    print(f"  {t[0][:8]}... contact={t[1]} agent={t[2]}")

if not threads:
    print("No open threads! Looking for any thread...")
    cur.execute('SELECT id, "waContactId", NULL FROM whatsapp.threads ORDER BY "lastMessageAt" DESC NULLS LAST LIMIT 5')
    threads = cur.fetchall()
    if not threads:
        print("No threads at all!")
        exit(1)

# Prefer Omar's thread, else first
thread = next((t for t in threads if t[2] and "omar" in (t[2] or "").lower()), threads[0])
thread_id = thread[0]
print(f"\nUsing thread: {thread_id[:8]}... (agent={thread[2]})")

# Insert fake inbound IMAGE message
msg_id = str(uuid.uuid4())
now = datetime.now(timezone.utc)
payload = json.dumps({
    "image": {
        "id": media_id,
        "mime_type": "image/jpeg",
        "caption": "Test image preview"
    }
})

cur.execute("""
    INSERT INTO whatsapp.messages
      (id, "threadId", "channelId", direction, type, status, body, payload,
       "mediaMimeType", "waMessageId", "createdAt", "updatedAt")
    VALUES (%s, %s, %s, 'INBOUND', 'IMAGE', 'RECEIVED',
            'Test image preview', %s::jsonb, 'image/jpeg', %s, %s, %s)
""", (msg_id, thread_id, channel_id, payload,
      f"wamid.test.{msg_id[:8]}", now, now))

# Bump thread preview
cur.execute(
    'UPDATE whatsapp.threads SET "lastMessageAt"=%s, "lastMessagePreview"=\'[Image]\' WHERE id=%s',
    (now, thread_id)
)

conn.commit()
conn.close()

print(f"\nDone! IMAGE message inserted: {msg_id[:8]}...")
print(f"Thread ID: {thread_id}")
print("Open the sales inbox and click this thread to see the image preview.")
