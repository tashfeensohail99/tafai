"""
Tashfeen Platform — Comprehensive Test Runner v2
Run: python test-runner.py
"""
import urllib.request
import urllib.error
import json
import sys
import time

RUN_ID = str(int(time.time()))[-5:]  # 5-digit suffix for uniqueness

BASE = "https://backend-production-5a89.up.railway.app"
FRONTEND = "https://frontend-production-08d4.up.railway.app"

PASS = "\u2705"
FAIL = "\u274c"
WARN = "\u26a0\ufe0f"
INFO = "\u2139\ufe0f"

results = []

def req(method, path, payload=None, token=None, base=None):
    url = (base or BASE) + path
    body = json.dumps(payload).encode() if payload else None
    headers = {"Content-Type": "application/json", "User-Agent": "tashfeen-test/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=20)
        return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw[:400]
    except Exception as e:
        return 0, str(e)

def log(icon, label, detail=""):
    line = f"  {icon} {label}"
    if detail:
        line += f" - {detail}"
    print(line)
    results.append((icon, label, detail))

def section(title):
    print(f"\n{'='*62}")
    print(f"  {title}")
    print(f"{'='*62}")

# ============================================================
# 1. SMOKE TEST
# ============================================================
section("1. SMOKE TEST - Backend & Frontend Health")

s, b = req("GET", "/health")
if s == 200 and isinstance(b, dict) and b.get("status") == "ok":
    log(PASS, "Backend /health", f"service={b.get('service')}  ts={b.get('timestamp','')[:19]}")
else:
    log(FAIL, "Backend /health", f"HTTP {s}  {str(b)[:100]}")

try:
    r2 = urllib.request.Request(FRONTEND, headers={"User-Agent": "tashfeen-test/1.0"})
    resp = urllib.request.urlopen(r2, timeout=20)
    log(PASS, "Frontend reachable", f"HTTP {resp.status}")
except Exception as e:
    log(FAIL, "Frontend reachable", str(e)[:120])

# ============================================================
# 2. AUTH
# ============================================================
section("2. AUTH - Login, Token, Protection")

s, b = req("POST", "/auth/login", {"email": "admin@tashfeen.com", "password": "Admin@123456"})
admin_token = None
if s in (200, 201):
    admin_token = b.get("accessToken") or (b.get("tokens") or {}).get("accessToken")
    log(PASS, "Super admin login", f"HTTP {s}")
else:
    log(FAIL, "Super admin login", f"HTTP {s}  {str(b)[:200]}")

s, b = req("POST", "/auth/login", {"email": "sales@tashfeen.com", "password": "Sales@123456"})
sales_token = None
if s in (200, 201):
    sales_token = b.get("accessToken") or (b.get("tokens") or {}).get("accessToken")
    log(PASS, "Sales agent login", f"HTTP {s}")
else:
    log(FAIL, "Sales agent login", f"HTTP {s}  {str(b)[:200]}")

s, b = req("POST", "/auth/login", {"email": "admin@tashfeen.com", "password": "WrongPass999"})
log(PASS if s in (401, 403, 400) else FAIL, "Wrong password blocked", f"HTTP {s}")

s, b = req("GET", "/leads")
log(PASS if s in (401, 403) else FAIL, "Unauthenticated request blocked", f"HTTP {s}")

if admin_token:
    s, b = req("GET", "/auth/me", token=admin_token)
    if s == 200 and isinstance(b, dict):
        log(PASS, "Admin /auth/me", f"email={b.get('email')}")
    else:
        log(FAIL, "Admin /auth/me", f"HTTP {s}  {str(b)[:150]}")

# ============================================================
# 3. RBAC
# ============================================================
section("3. RBAC - Permission Enforcement")

if sales_token:
    s, b = req("GET", "/audit-log", token=sales_token)
    log(PASS if s in (401, 403) else WARN, "Sales blocked from audit-log", f"HTTP {s}")

    s, b = req("GET", "/users", token=sales_token)
    log(PASS if s in (401, 403) else FAIL, "Sales blocked from /users", f"HTTP {s}")

if admin_token:
    s, b = req("GET", "/users", token=admin_token)
    if s == 200:
        users = b if isinstance(b, list) else b.get("data", [])
        log(PASS, "Admin can list users", f"{len(users) if isinstance(users, list) else '?'} users")
    else:
        log(WARN, "Admin /users", f"HTTP {s}")

    s, b = req("GET", "/audit-log", token=admin_token)
    if s == 200:
        entries = b if isinstance(b, list) else b.get("data", [])
        log(PASS, "Admin can view audit log", f"{len(entries) if isinstance(entries,list) else '?'} entries")
    else:
        log(WARN, "Admin /audit-log", f"HTTP {s}  {str(b)[:100]}")

# ============================================================
# 4. DB SEED VERIFICATION
# ============================================================
section("4. DATABASE - Roles, Employees, Services")

if admin_token:
    s, b = req("GET", "/roles", token=admin_token)
    if s == 200:
        roles = b if isinstance(b, list) else b.get("data", b.get("roles", []))
        role_names = [r.get("name") for r in roles if isinstance(r, dict)]
        expected = {"super_admin", "admin", "sales", "finance", "processing", "documentation"}
        missing = expected - set(role_names)
        log(PASS if not missing else WARN, "Core roles seeded",
            f"{len(roles)} total - missing={missing or 'none'}")
    else:
        log(WARN, "GET /roles", f"HTTP {s}")

    s, b = req("GET", "/employees", token=admin_token)
    if s == 200:
        emps = b if isinstance(b, list) else b.get("data", b.get("employees", []))
        log(PASS if emps else WARN, "Employees in DB",
            f"{len(emps) if isinstance(emps,list) else '?'} employees")
    else:
        log(WARN, "GET /employees", f"HTTP {s}")

    s, b = req("GET", "/services", token=admin_token)
    if s == 200:
        svcs = b if isinstance(b, list) else b.get("data", [])
        svc_names = [sv.get("name") for sv in svcs if isinstance(sv, dict)]
        log(PASS, "Services seeded", str(svc_names))
    else:
        log(WARN, "GET /services", f"HTTP {s}")

# ============================================================
# 5. CREATE AGENTS FOR DISTRIBUTION TEST
# ============================================================
section("5. SETUP - 3 Sales Agents for Distribution Test")

agents = []

# Get existing employees
s, b = req("GET", "/employees", token=admin_token)
emps = (b if isinstance(b, list) else b.get("data", [])) if s == 200 else []

for emp in emps:
    user = emp.get("user") or emp.get("userAccount") or {}
    if user.get("email") == "sales@tashfeen.com":
        agents.append({
            "email": "sales@tashfeen.com",
            "employee_id": emp.get("id"),
            "token": sales_token,
        })
        log(PASS, "Agent 1 found", f"sales@tashfeen.com  emp_id={emp.get('id')}")
        break

# Get dept/branch for new employees
s, b = req("GET", "/departments", token=admin_token)
departments = (b if isinstance(b, list) else b.get("data", [])) if s == 200 else []
dept_id = departments[0].get("id") if departments else None

s, b = req("GET", "/branches", token=admin_token)
branches = (b if isinstance(b, list) else b.get("data", [])) if s == 200 else []
branch_id = branches[0].get("id") if branches else None

new_agents = [
    {"email": "fatima.r@tashfeen.com", "firstName": "Fatima", "lastName": "Raza"},
    {"email": "omar.k@tashfeen.com", "firstName": "Omar", "lastName": "Khan"},
]

for ag_data in new_agents:
    # Try login first (may already exist)
    s, b = req("POST", "/auth/login",
               {"email": ag_data["email"], "password": "Sales@123456"})
    if s in (200, 201):
        ag_token = b.get("accessToken") or (b.get("tokens") or {}).get("accessToken")
        s2, b2 = req("GET", "/employees", token=admin_token)
        emps2 = (b2 if isinstance(b2, list) else b2.get("data", [])) if s2 == 200 else []
        emp_id = None
        for emp in emps2:
            user = emp.get("user") or emp.get("userAccount") or {}
            if user.get("email") == ag_data["email"]:
                emp_id = emp.get("id")
                break
        agents.append({"email": ag_data["email"], "employee_id": emp_id, "token": ag_token})
        log(PASS, f"Agent {len(agents)} already exists", f"{ag_data['email']}")
        continue

    # Create user account
    s, b = req("POST", "/users", {
        "email": ag_data["email"],
        "password": "Sales@123456",
        "roleNames": ["sales"],
    }, token=admin_token)
    if s not in (200, 201):
        log(FAIL, f"Create user {ag_data['email']}", f"HTTP {s}  {str(b)[:200]}")
        continue
    user_id = b.get("id") or (b.get("data") or {}).get("id")

    # Create employee profile
    emp_payload = {
        "userId": user_id,
        "firstName": ag_data["firstName"],
        "lastName": ag_data["lastName"],
    }
    if dept_id:
        emp_payload["departmentId"] = dept_id
    if branch_id:
        emp_payload["branchId"] = branch_id

    s2, b2 = req("POST", "/employees", emp_payload, token=admin_token)
    if s2 in (200, 201):
        emp_id = b2.get("id") or (b2.get("data") or {}).get("id")
        s3, b3 = req("POST", "/auth/login",
                     {"email": ag_data["email"], "password": "Sales@123456"})
        ag_token = (b3.get("accessToken") or (b3.get("tokens") or {}).get("accessToken")) if s3 in (200, 201) else None
        agents.append({"email": ag_data["email"], "employee_id": emp_id, "token": ag_token})
        log(PASS, f"Agent {len(agents)} created", f"{ag_data['email']}  emp_id={emp_id}")
    else:
        log(FAIL, f"Create employee {ag_data['email']}", f"HTTP {s2}  {str(b2)[:200]}")

log(INFO, "Agents ready for distribution", f"{len(agents)}/3")

# ============================================================
# 6. LEAD CREATION & DISTRIBUTION
# ============================================================
section("6. LEAD CREATION & DISTRIBUTION TO 3 SALES AGENTS")

test_leads_data = [
    {"firstName": "Ahmed", "lastName": "Siddiqui", "phone": f"+9230012{RUN_ID}1",
     "email": f"ahmed.dist.{RUN_ID}@example.com", "sourceChannel": "WALK_IN",
     "targetCountry": "Canada", "notes": "Smoke test - agent 1"},
    {"firstName": "Sara", "lastName": "Malik", "phone": f"+9230012{RUN_ID}2",
     "email": f"sara.dist.{RUN_ID}@example.com", "sourceChannel": "WEBSITE",
     "targetCountry": "United Kingdom", "notes": "Smoke test - agent 2"},
    {"firstName": "Bilal", "lastName": "Iqbal", "phone": f"+9230012{RUN_ID}3",
     "email": f"bilal.dist.{RUN_ID}@example.com", "sourceChannel": "WHATSAPP",
     "targetCountry": "Australia", "notes": "Smoke test - agent 3"},
]

created_leads = []
for i, lead_data in enumerate(test_leads_data):
    s, b = req("POST", "/leads", lead_data, token=admin_token)
    if s in (200, 201):
        lead_id = b.get("id") or (b.get("data") or {}).get("id")
        created_leads.append({"id": lead_id, "name": f"{lead_data['firstName']} {lead_data['lastName']}"})
        log(PASS, f"Lead #{i+1} created",
            f"id={lead_id}  {lead_data['firstName']} {lead_data['lastName']}  to={lead_data['targetCountry']}")
    else:
        created_leads.append(None)
        log(FAIL, f"Lead #{i+1} failed", f"HTTP {s}  {str(b)[:200]}")

for i, lead in enumerate(created_leads):
    if lead is None:
        continue
    if i < len(agents) and agents[i].get("employee_id"):
        agent = agents[i]
        s, b = req("POST", f"/leads/{lead['id']}/assign",
                   {"assignedEmployeeId": agent["employee_id"]}, token=admin_token)
        if s in (200, 201):
            log(PASS, f"Lead #{i+1} distributed", f"{lead['name']} -> {agent['email']}")
        else:
            log(FAIL, f"Lead #{i+1} assignment failed", f"HTTP {s}  {str(b)[:200]}")
    else:
        log(WARN, f"Lead #{i+1} assignment skipped", "no agent employee_id")

# Agent reads their assigned leads
for i, agent in enumerate(agents[:3]):
    if agent.get("token"):
        s, b = req("GET", "/leads", token=agent["token"])
        if s == 200:
            leads = b if isinstance(b, list) else b.get("data", [])
            log(PASS, f"Agent {i+1} can read their leads",
                f"{agent['email']} sees {len(leads) if isinstance(leads,list) else '?'} leads")
        else:
            log(WARN, f"Agent {i+1} leads", f"HTTP {s}  {str(b)[:100]}")

# ============================================================
# 7. LEAD INFO GATHERING
# ============================================================
section("7. LEAD INFO GATHERING - Update & Follow-Up")

first_lead = next((l for l in created_leads if l), None)
if admin_token and first_lead:
    lid = first_lead["id"]

    s, b = req("PATCH", f"/leads/{lid}", {
        "nationality": "Pakistani",
        "notes": "Express Entry candidate - 5 years IT. Interested in PR pathway.",
    }, token=admin_token)
    log(PASS if s in (200, 201) else FAIL, "Lead profile updated", f"HTTP {s}")

    s, b = req("POST", "/follow-ups", {
        "leadId": lid,
        "title": "Initial consultation - Express Entry",
        "dueAt": "2026-05-25T10:00:00.000Z",
        "priority": "HIGH",
    }, token=admin_token)
    log(PASS if s in (200, 201) else WARN, "Follow-up created", f"HTTP {s}")

    s, b = req("GET", f"/leads/{lid}", token=admin_token)
    if s == 200:
        log(PASS, "Lead detail readable after update",
            f"status={b.get('status')}  nationality={b.get('nationality')}")
    else:
        log(WARN, "Lead detail fetch", f"HTTP {s}")

# ============================================================
# 8. LEAD -> CLIENT CONVERSION
# ============================================================
section("8. LEAD TO CLIENT CONVERSION")

converted_client_id = None
if admin_token and first_lead:
    lid = first_lead["id"]
    s, b = req("GET", "/services", token=admin_token)
    svcs = (b if isinstance(b, list) else b.get("data", [])) if s == 200 else []
    service_id = svcs[0].get("id") if svcs else None

    convert_payload = {"notes": "Converted via smoke test"}

    s, b = req("POST", f"/leads/{lid}/convert", convert_payload, token=admin_token)
    if s in (200, 201):
        converted_client_id = (b.get("clientId") or b.get("id") or
                               (b.get("data") or {}).get("id") or
                               (b.get("client") or {}).get("id"))
        log(PASS, "Lead converted to client", f"client_id={converted_client_id}")
    else:
        log(FAIL, "Lead conversion", f"HTTP {s}  {str(b)[:300]}")

if admin_token and converted_client_id:
    s, b = req("GET", f"/clients/{converted_client_id}", token=admin_token)
    if s == 200:
        log(PASS, "Client record verified", f"name={b.get('firstName')} {b.get('lastName')}  status={b.get('status')}")
    else:
        log(WARN, "Client fetch", f"HTTP {s}")

    s, b = req("GET", f"/activity-timeline?clientId={converted_client_id}", token=admin_token)
    if s == 200:
        events = b if isinstance(b, list) else b.get("data", [])
        log(PASS, "Activity timeline", f"{len(events) if isinstance(events,list) else '?'} events")
    else:
        log(WARN, "Client timeline", f"HTTP {s}  {str(b)[:100]}")

# ============================================================
# 9. FINANCE
# ============================================================
section("9. FINANCE - Invoice -> Payment -> Verify")

invoice_id = None
if admin_token and converted_client_id:
    s, b = req("POST", "/finance/invoices", {
        "clientId": converted_client_id,
        "subtotal": "150000",
        "currency": "PKR",
        "dueDate": "2026-06-30T00:00:00.000Z",
        "notes": "Work Permit Fee - Smoke Test",
    }, token=admin_token)
    if s in (200, 201):
        invoice_id = b.get("id") or (b.get("data") or {}).get("id")
        log(PASS, "Invoice created", f"id={invoice_id}  PKR 150,000")
    else:
        log(FAIL, "Invoice creation", f"HTTP {s}  {str(b)[:300]}")

    if invoice_id:
        s, b = req("POST", "/finance/payments", {
            "invoiceId": invoice_id,
            "amount": "75000",
            "currency": "PKR",
            "paymentMethod": "BANK_TRANSFER",
            "transactionRef": "TXN-SMOKE-2026",
            "notes": "First installment - smoke test",
        }, token=admin_token)
        if s in (200, 201):
            payment_id = b.get("id") or (b.get("data") or {}).get("id")
            log(PASS, "Payment recorded", f"id={payment_id}  PKR 75,000")

            if payment_id:
                s, b = req("POST", f"/finance/payments/{payment_id}/verify",
                           {"notes": "Verified by smoke test"}, token=admin_token)
                log(PASS if s in (200, 201) else FAIL, "Payment verified",
                    f"HTTP {s}" + (f"  {str(b)[:150]}" if s not in (200, 201) else ""))
        else:
            log(FAIL, "Payment recording", f"HTTP {s}  {str(b)[:300]}")

    s, b = req("GET", "/finance/invoices", token=admin_token)
    if s == 200:
        invs = b if isinstance(b, list) else b.get("data", [])
        log(PASS, "Finance invoices list", f"{len(invs) if isinstance(invs,list) else '?'} invoices")
    else:
        log(WARN, "Finance invoices list", f"HTTP {s}")

# ============================================================
# 10. WHATSAPP
# ============================================================
section("10. WHATSAPP - Module Endpoints")

if admin_token:
    s, b = req("GET", "/whatsapp/channels", token=admin_token)
    if s == 200:
        chs = b if isinstance(b, list) else b.get("data", [])
        ch_count = len(chs) if isinstance(chs, list) else 0
        if ch_count == 0:
            log(WARN, "WhatsApp channels", "0 channels - Meta phone number not configured yet")
        else:
            log(PASS, "WhatsApp channels", f"{ch_count} active channels")
    else:
        log(FAIL, "WhatsApp channels endpoint", f"HTTP {s}  {str(b)[:150]}")

    s, b = req("GET", "/whatsapp/threads", token=admin_token)
    threads = b if isinstance(b, list) else b.get("data", [])
    log(PASS if s == 200 else FAIL, "WhatsApp threads endpoint",
        f"HTTP {s}  {len(threads) if s==200 and isinstance(threads,list) else str(b)[:100]}")

    s, b = req("GET", "/whatsapp/presence/me", token=sales_token or admin_token)
    log(PASS if s == 200 else WARN, "WhatsApp presence/me endpoint", f"HTTP {s}")

if sales_token:
    s, b = req("GET", "/whatsapp/threads", token=sales_token)
    threads = b if isinstance(b, list) else b.get("data", [])
    log(PASS if s == 200 else FAIL, "Sales agent inbox accessible",
        f"{len(threads) if s==200 and isinstance(threads,list) else str(b)[:100]} threads")

# ============================================================
# 11. APPOINTMENTS
# ============================================================
section("11. APPOINTMENTS")

if admin_token and converted_client_id:
    s, b = req("POST", "/appointments", {
        "clientId": converted_client_id,
        "title": "Initial visa consultation - smoke test",
        "appointmentType": "CONSULTATION",
        "scheduledAt": "2026-05-28T11:00:00.000Z",
        "notes": "Smoke test appointment",
    }, token=admin_token)
    if s in (200, 201):
        appt_id = b.get("id") or (b.get("data") or {}).get("id")
        log(PASS, "Appointment created", f"id={appt_id}")
    else:
        log(WARN, "Appointment creation", f"HTTP {s}  {str(b)[:200]}")

    s, b = req("GET", "/appointments", token=admin_token)
    if s == 200:
        appts = b if isinstance(b, list) else b.get("data", [])
        log(PASS, "Appointments list", f"{len(appts) if isinstance(appts,list) else '?'} total")
    else:
        log(WARN, "Appointments list", f"HTTP {s}")

# ============================================================
# 12. CLIENT PORTAL
# ============================================================
section("12. CLIENT PORTAL")

if admin_token:
    for portal_path in ["/portal/cases/mine"]:
        s, b = req("GET", portal_path, token=admin_token)
        log(PASS if s in (200, 403) else WARN, f"Portal {portal_path}",
            f"HTTP {s}" + (" (admin has no client record - expected)" if s == 403 else ""))

# ============================================================
# 13. REPORTS
# ============================================================
section("13. REPORTS - Export Endpoints")

if admin_token:
    for report_path in ["/reports/dashboard", "/reports/workflow-board", "/reports/sales-overview"]:
        s, b = req("GET", report_path, token=admin_token)
        log(PASS if s == 200 else WARN, f"Report {report_path}", f"HTTP {s}")

# ============================================================
# SUMMARY
# ============================================================
section("FINAL TEST SUMMARY")

passed = sum(1 for r in results if r[0] == PASS)
failed = sum(1 for r in results if r[0] == FAIL)
warned = sum(1 for r in results if r[0] == WARN)

print(f"\n  Total checks : {len(results)}")
print(f"  {PASS} Passed   : {passed}")
print(f"  {FAIL} Failed   : {failed}")
print(f"  {WARN} Warnings : {warned}\n")

if failed > 0:
    print("  FAILURES TO FIX:")
    for r in results:
        if r[0] == FAIL:
            print(f"    * {r[1]}: {r[2]}")

if warned > 0:
    print("\n  WARNINGS (non-critical / config needed):")
    for r in results:
        if r[0] == WARN:
            print(f"    * {r[1]}: {r[2]}")

print()
sys.exit(1 if failed > 0 else 0)
