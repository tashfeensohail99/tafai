"""
Lead flow E2E test:
  1. Create leads and assign to 3 sales agents
  2. Lead info gathering (status updates, notes)
  3. Lead -> Client conversion
  4. Finance handover & payment flow
"""

import requests
import json
import time

BASE = 'https://backend-production-5a89.up.railway.app'
TS = str(int(time.time()))[-6:]  # unique suffix per run

# ─── helpers ────────────────────────────────────────────────────────────────

def login(email, password):
    r = requests.post(f'{BASE}/auth/login', json={'email': email, 'password': password}, timeout=10)
    r.raise_for_status()
    return r.json()['accessToken']

def api(token, method, path, body=None):
    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
    r = requests.request(method, f'{BASE}{path}', headers=headers, json=body, timeout=15)
    return r

def ok(label, r, expected=(200, 201)):
    status = 'PASS' if r.status_code in expected else 'FAIL'
    print(f'  [{status}] {label} → {r.status_code}')
    if status == 'FAIL':
        print(f'         {r.text[:300]}')
    return r.status_code in expected

# ─── auth ───────────────────────────────────────────────────────────────────

print('\n=== AUTH ===')
admin_token  = login('admin@tashfeen.com',  'Admin@123456')
sales_token  = login('sales@tashfeen.com',  'Sales@123456')
fatima_token = login('fatima.r@tashfeen.com', 'Sales@123456')
omar_token   = login('omar.k@tashfeen.com',   'Sales@123456')
print('  [PASS] Tokens obtained for admin, sales, fatima, omar')

# Get user IDs via /auth/me
sales_id  = api(sales_token,  'GET', '/auth/me').json()['id']
fatima_id = api(fatima_token, 'GET', '/auth/me').json()['id']
omar_id   = api(omar_token,   'GET', '/auth/me').json()['id']

print(f'  sales   : {sales_id}')
print(f'  fatima  : {fatima_id}')
print(f'  omar    : {omar_id}')

# Look up employee.id (different from user.id) via /employees
def get_employee_id(admin_token, user_id):
    r = api(admin_token, 'GET', '/employees')
    if r.status_code == 200:
        for emp in r.json():
            if emp.get('userId') == user_id:
                return emp['id']
    return None

sales_emp_id  = get_employee_id(admin_token, sales_id)
fatima_emp_id = get_employee_id(admin_token, fatima_id)
omar_emp_id   = get_employee_id(admin_token, omar_id)
print(f'  sales employee id  : {sales_emp_id}')
print(f'  fatima employee id : {fatima_emp_id}')
print(f'  omar employee id   : {omar_emp_id}')

# ─── STEP 1: Create 3 leads & assign to 3 agents ───────────────────────────

print('\n=== LEAD CREATION & ASSIGNMENT ===')

leads_data = [
    {
        'firstName': 'Nadia', 'lastName': 'Hussain', 'phone': f'+9231110{TS}1',
        'email': f'nadia.{TS}@test.com', 'sourceChannel': 'FACEBOOK',
        'serviceInterest': 'Study Visa', 'targetCountry': 'United Kingdom',
        'priority': 'HOT', 'notes': 'Very interested, called twice'
    },
    {
        'firstName': 'Tariq', 'lastName': 'Mehmood', 'phone': f'+9231110{TS}2',
        'email': f'tariq.{TS}@test.com', 'sourceChannel': 'WALK_IN',
        'serviceInterest': 'Permanent Residency', 'targetCountry': 'Canada',
        'priority': 'WARM', 'notes': 'Came in with family'
    },
    {
        'firstName': 'Ayesha', 'lastName': 'Raza', 'phone': f'+9231110{TS}3',
        'email': f'ayesha.{TS}@test.com', 'sourceChannel': 'WEBSITE',
        'serviceInterest': 'Work Permit', 'targetCountry': 'Germany',
        'priority': 'COLD', 'notes': 'Online inquiry only'
    },
]

lead_ids = []
assignments = [sales_emp_id, fatima_emp_id, omar_emp_id]
agent_names = ['sales', 'fatima', 'omar']

for i, (lead, agent_id, agent_name) in enumerate(zip(leads_data, assignments, agent_names)):
    r = api(admin_token, 'POST', '/leads', lead)
    if ok(f'Create lead {lead["firstName"]} {lead["lastName"]}', r, (200, 201)):
        lead_id = r.json()['id']
        lead_ids.append(lead_id)
        # Assign to agent
        r2 = api(admin_token, 'POST', f'/leads/{lead_id}/assign', {'assignedEmployeeId': agent_id})
        ok(f'  Assign {lead["firstName"]} → {agent_name}', r2, (200, 201))
    else:
        lead_ids.append(None)

print(f'  Lead IDs: {lead_ids}')

# ─── STEP 2: Lead info gathering (notes, status updates) ───────────────────

print('\n=== LEAD INFO GATHERING ===')

valid_lead_ids = [lid for lid in lead_ids if lid]

if valid_lead_ids:
    lid = valid_lead_ids[0]
    # Update lead status to CONTACTED
    r = api(admin_token, 'PATCH', f'/leads/{lid}', {'status': 'CONTACTED'})
    ok('Update status → CONTACTED', r, (200, 201))

    # Add a note via PATCH
    r = api(admin_token, 'PATCH', f'/leads/{lid}', {'notes': 'Called client. Interested in Jan 2026 intake. Needs IELTS 6.5.'})
    ok('Update notes', r, (200, 201))

    # Update priority
    r = api(admin_token, 'PATCH', f'/leads/{lid}', {'priority': 'HOT'})
    ok('Update priority → HOT', r, (200, 201))

    # GET lead to verify
    r = api(admin_token, 'GET', f'/leads/{lid}')
    ok('GET lead after updates', r, (200,))
    if r.status_code == 200:
        d = r.json()
        print(f'    status={d.get("status")} priority={d.get("priority")} notes={str(d.get("notes",""))[:60]}')

# ─── STEP 3: Lead → Client conversion ──────────────────────────────────────

print('\n=== LEAD → CLIENT CONVERSION ===')

convert_lid = valid_lead_ids[0] if valid_lead_ids else None
client_id = None

if convert_lid:
    r = api(admin_token, 'POST', f'/leads/{convert_lid}/convert')
    ok('Convert lead → client', r, (200, 201))
    if r.status_code in (200, 201):
        data = r.json()
        # handle both {clientId} and {client: {id}}
        client_id = data.get('clientId') or data.get('id') or (data.get('client') or {}).get('id')
        print(f'    Client ID: {client_id}')

        # GET client to verify
        r2 = api(admin_token, 'GET', f'/clients/{client_id}')
        ok('GET client after conversion', r2, (200,))
        if r2.status_code == 200:
            c = r2.json()
            print(f'    Name: {c.get("firstName")} {c.get("lastName")} | status={c.get("status")}')

# ─── STEP 4: Finance handover & payment ────────────────────────────────────

print('\n=== FINANCE HANDOVER & PAYMENT ===')

invoice_id = None

if client_id:
    # Create invoice
    r = api(admin_token, 'POST', '/finance/invoices', {
        'clientId': client_id,
        'subtotal': '150000',
        'currency': 'PKR',
        'dueDate': '2026-06-30T00:00:00.000Z',
        'notes': 'Study Visa Package - UK'
    })
    ok('Create invoice', r, (200, 201))
    if r.status_code in (200, 201):
        invoice_id = r.json().get('id')
        print(f'    Invoice ID: {invoice_id}')

        # Create payment
        r2 = api(admin_token, 'POST', '/finance/payments', {
            'invoiceId': invoice_id,
            'amount': '75000',
            'currency': 'PKR',
            'paymentMethod': 'BANK_TRANSFER',
            'transactionRef': 'TXN-FLOW-001',
            'notes': 'First instalment - bank transfer'
        })
        ok('Record payment', r2, (200, 201))
        if r2.status_code in (200, 201):
            pay_id = r2.json().get('id')
            print(f'    Payment ID: {pay_id}')

            # Verify payment
            r3 = api(admin_token, 'POST', f'/finance/payments/{pay_id}/verify')
            ok('Verify payment', r3, (200, 201))

# ─── STEP 5: WhatsApp lead distribution ────────────────────────────────────

print('\n=== WHATSAPP LEAD DISTRIBUTION ===')

# Check channels
r = api(admin_token, 'GET', '/whatsapp/channels')
ok('GET WhatsApp channels', r, (200,))
if r.status_code == 200:
    channels = r.json()
    count = len(channels) if isinstance(channels, list) else channels.get('total', 0)
    print(f'    Channels configured: {count}')
    if count == 0:
        print('    [WARN] Meta not configured — WhatsApp channel distribution skipped (expected in staging)')

# Check threads (the correct endpoint name)
r = api(admin_token, 'GET', '/whatsapp/threads')
ok('GET WhatsApp threads', r, (200,))
if r.status_code == 200:
    threads = r.json()
    total = len(threads) if isinstance(threads, list) else threads.get('total', 0)
    print(f'    Active threads: {total}')

# ─── SUMMARY ────────────────────────────────────────────────────────────────

print('\n=== SUMMARY ===')
print(f'  Leads created : {len([l for l in lead_ids if l])}/3')
print(f'  Client ID     : {client_id or "not created"}')
print(f'  Invoice ID    : {invoice_id or "not created"}')
print('  Done.')
