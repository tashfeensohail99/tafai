import requests, base64, json

BASE = 'https://backend-production-5a89.up.railway.app'

def tok(email, pw):
    r = requests.post(BASE+'/auth/login', json={'email':email,'password':pw}, timeout=15)
    return r.json()['accessToken']

sales_t  = tok('sales@tashfeen.com', 'Sales@123456')
admin_t  = tok('admin@tashfeen.com', 'Admin@123456')

print('=' * 60)
print('FULL FINANCE FLOW TEST')
print('=' * 60)

# ── STEP 1: Sales submits a new handover ──────────────────────────────
print('STEP 1: Sales creates handover...')
body = {
    'leadId': 'f4ce3f8f-69a5-4a56-909f-18d879d6cdb8',
    'submittedAmount': '75000',
    'currency': 'PKR',
    'paymentMethod': 'BANK',
    'transactionRef': 'HBL-20260513-9988',
    'notes': 'Canada study visa full fee - Hamza Khan - HBL slip attached',
    'receiptFileName': 'hbl-slip-hamza.jpg',
    'receiptMimeType': 'image/jpeg',
    'receiptContentBase64': base64.b64encode(b'MOCK-RECEIPT-BYTES').decode()
}
r1 = requests.post(BASE+'/finance/handovers', json=body,
                   headers={'Authorization': 'Bearer ' + sales_t}, timeout=30)
if r1.status_code not in (200, 201):
    print('FAILED:', r1.status_code, r1.text[:300])
    exit(1)
h = r1.json()
hid = h['id']
print('  Created handover:')
print('    ID     :', hid)
print('    Status :', h['status'])
print('    Amount :', h['submittedAmount'], h['currency'])
print('    Ref    :', h['transactionRef'])

# ── STEP 2: Finance marks IN_REVIEW ───────────────────────────────────
print()
print('STEP 2: Finance marks IN_REVIEW...')
r2 = requests.post(BASE+'/finance/handovers/'+hid+'/review',
    json={'action': 'MARK_IN_REVIEW', 'financeNotes': 'Receipt verified - HBL slip matches amount'},
    headers={'Authorization': 'Bearer ' + admin_t}, timeout=15)
h2 = r2.json()
print('  HTTP', r2.status_code, '| Status:', h2.get('status'))

# ── STEP 3: Finance records payment ───────────────────────────────────
print()
print('STEP 3: Finance records payment (RECORD_PAYMENT)...')
r3 = requests.post(BASE+'/finance/handovers/'+hid+'/review',
    json={'action': 'RECORD_PAYMENT', 'financeNotes': 'Payment confirmed - PKR 75,000 received in account'},
    headers={'Authorization': 'Bearer ' + admin_t}, timeout=15)
h3 = r3.json()
print('  HTTP', r3.status_code, '| Status:', h3.get('status'))

# ── STEP 4: Send to Processing ────────────────────────────────────────
print()
print('STEP 4: Send to Processing (SENT_TO_PROCESSING)...')
r4 = requests.post(BASE+'/finance/handovers/'+hid+'/review',
    json={'action': 'SEND_TO_PROCESSING', 'financeNotes': 'Verified and sending to processing team'},
    headers={'Authorization': 'Bearer ' + admin_t}, timeout=15)
h4 = r4.json()
print('  HTTP', r4.status_code, '| Response:', json.dumps(h4)[:300])

# ── Summary: list all handovers ────────────────────────────────────────
print()
print('All handovers:')
rl = requests.get(BASE+'/finance/handovers',
                  headers={'Authorization': 'Bearer ' + admin_t}, timeout=15).json()
for hv in rl:
    print('  ', hv['id'][:8], '| status:', hv['status'],
          '| amount:', hv['submittedAmount'], hv['currency'],
          '| ref:', hv.get('transactionRef','—'))
