# Finance Module — System Design

**Status:** Design draft v2 (extends your v1 brief)
**Audience:** Tafsheen frontend + backend team, Ahsan, finance department stakeholders
**Goal:** Single source of truth for what the Finance module is, how it
behaves, and which decisions still need a human to make before we build it.

This document deliberately includes **open policy questions** marked with
`▸ DECIDE:`. Those aren't gaps in my thinking — they're business decisions
only Tafsheen leadership can answer. They block parts of the build, so flag
them early.

---

## Table of contents

0. [TL;DR](#0-tldr)
1. [What's in v1 vs. what's added in v2](#1-whats-in-v1-vs-whats-added-in-v2)
2. [Core principles](#2-core-principles)
3. [The canonical workflow (state diagram)](#3-the-canonical-workflow-state-diagram)
4. [User roles & permissions matrix](#4-user-roles--permissions-matrix)
5. [Screen inventory (full)](#5-screen-inventory-full)
6. [Status taxonomy (all the states)](#6-status-taxonomy-all-the-states)
7. [Data model](#7-data-model)
8. [Multi-currency handling](#8-multi-currency-handling)
9. [Partial payments & installment plans](#9-partial-payments--installment-plans)
10. [Refunds, adjustments, write-offs](#10-refunds-adjustments-write-offs)
11. [Discounts & fee adjustments](#11-discounts--fee-adjustments)
12. [Maker-checker & approval limits](#12-maker-checker--approval-limits)
13. [Fraud & duplicate detection](#13-fraud--duplicate-detection)
14. [SLA, escalation & inbox](#14-sla-escalation--inbox)
15. [Reconciliation & end-of-day close](#15-reconciliation--end-of-day-close)
16. [Receipt numbering scheme](#16-receipt-numbering-scheme)
17. [Audit trail & immutability](#17-audit-trail--immutability)
18. [Notifications](#18-notifications)
19. [Integrations](#19-integrations)
20. [Edge cases & policy decisions needed](#20-edge-cases--policy-decisions-needed)
21. [UI direction](#21-ui-direction)
22. [Phasing — what to build first](#22-phasing--what-to-build-first)

---

## 0. TL;DR

What your v1 spec gets right: the core workflow (Sales → Finance verify →
Processing), the 8 main screens, the no-processing-without-verified-payment
rule, the permissions split, and the requirement to reuse the premium glass
design system.

What v2 adds:

- **Multi-currency** — clients pay in CAD/USD/PKR but quotes may be in
  another currency. FX rate locking matters.
- **Partial payments & installments** — clients rarely pay the full fee in
  one shot. Deposit + balance is the norm.
- **Refunds** — visa denials, withdrawals, and partial service refunds all
  need an explicit path. Finance is where the money flows back from.
- **Maker-checker** — single-officer verification is fine for small amounts,
  large amounts need a second pair of eyes.
- **Fraud / duplicate detection** — same transaction reference, same receipt
  image, same client+amount within a window — all should auto-flag.
- **Reconciliation** — daily bank statement reconciliation, cash drawer
  closeout. Without this, finance can't actually trust the numbers.
- **SLA & escalation** — finance has time pressure too. Cash verifies in
  hours, cheques take days. The system needs to know.
- **Branches & cash drawers** — Tafsheen runs multiple offices; cash receipts
  are tied to a specific drawer / officer.
- **Tax / fees breakdown** — receipt should itemize service fee, gov fee, tax.
- **Hand-back to Sales** — the correction flow needs a real loop, not just a
  status flip.
- **Receipt numbering** — formal scheme (`TF-{branch}-{YYYY}-{seq}`).
- **Audit immutability** — once verified, the record is append-only.

This document specifies all of the above plus the screens, data model, and
phasing. Build phase 1 first (§22), then revisit.

---

## 1. What's in v1 vs. what's added in v2

| Area | v1 (your brief) | v2 (this doc) |
|---|---|---|
| Core workflow | ✓ Solid | ✓ Same |
| 8 main screens | ✓ Listed | Expanded to 13 with sub-screens |
| Payment methods | Cash / bank / card / other | + cheque (with clearance), mobile money (JazzCash/EasyPaisa), wire, online gateway |
| Currency | Mentioned in passing | Full multi-currency with FX-rate locking |
| Partial payments | Not addressed | First-class — deposit + balance, installments |
| Refunds | Not addressed | Full refund workflow with maker-checker |
| Discounts | Not addressed | Explicit discount approval flow |
| Maker-checker | Not addressed | Threshold-based dual approval |
| Fraud detection | "Duplicate not found" line item | Rules engine with 4 detection vectors |
| SLA per payment method | Not specified | Cash 2h / card 4h / online 6h / bank 24h / cheque clearance lag |
| Branch / office | Not addressed | Cash drawers per branch, branch reports |
| Tax breakdown | Not addressed | Receipt itemization (fee / gov fee / tax) |
| Reconciliation | Not addressed | Daily bank recon + cash closeout |
| Receipt numbering | "Generate receipt number" | Formal scheme + sequence per branch |
| Audit trail | Mentioned | Immutable verification records + append-only correction log |
| Notifications | Implied | Spec'd per actor + channel |
| Integrations | Not addressed | Bank API, accounting export, email/SMS/WhatsApp receipts |
| Correction flow | High-level | Round-trip with Sales, SLA-tracked |
| Inbox / claim | Not addressed | Officer claims case; "being reviewed by X" lock |
| Status taxonomy | 7 statuses | 12 statuses (deposit-only, awaiting clearance, partial-paid, etc.) |

---

## 2. Core principles

These are the invariants the system must enforce. Everything else is built on
top of them.

1. **No money moves without a verified record.** Processing cannot start
   until Finance marks the payment Verified. The backend rejects any attempt
   to create a processing intake for an unverified case.
2. **Every receipt has exactly one verification.** A receipt is verified at
   most once. Verification is immutable — corrections create a new
   verification linked to the prior one; they never overwrite.
3. **Sales records the receipt. Finance verifies the money.** These two
   actions live in different tables and require different permissions.
4. **No silent edits.** Once a payment record is in `Under Verification` or
   later, edits are append-only. The audit log is the source of truth for
   "what did the officer see when they verified".
5. **Maker is not checker.** Above the single-approver threshold, the
   officer who verifies and the officer who approves cannot be the same
   person.
6. **Money flows in one currency at a time.** A payment record has one
   currency. Multi-currency invoices are split into multiple payment records.
7. **Refunds use the original payment as their anchor.** You can't refund
   what you never received — refunds reference a verified payment record.
8. **The lead stage and the finance status are different things.** A lead
   moves through sales stages; a payment moves through finance statuses. They
   intersect at the handover but are tracked separately.

---

## 3. The canonical workflow (state diagram)

```
SALES                            FINANCE                         PROCESSING
─────────────────────────────────────────────────────────────────────────────

Lead reaches
"Payment Interested"
    │
    │ Sales uploads receipt + sends to Finance
    ▼
                                 NEW FROM SALES
                                      │
                                      │ Officer claims case
                                      ▼
                                 UNDER VERIFICATION
                                      │
                              ┌───────┼────────┐
                              │       │        │
                              ▼       ▼        ▼
                           VERIFIED  CORRECTION REJECTED
                              │     REQUIRED      │
                              │       │           │ Refund flow
                              │       │           │ if applicable
                              │       │           ▼
                              │       │      (closed)
                              │       │
                              │       │ Sales uploads corrected receipt
                              │       ▼
                              │   UNDER VERIFICATION (re-entry)
                              │       │
                              │       └─→ back to verify/correction/reject
                              │
                              │ (if amount > maker-checker threshold)
                              ▼
                           PENDING APPROVAL
                              │ (second officer approves)
                              ▼
                          APPROVED
                              │ Receipt number generated
                              ▼
                          RECEIPT CONFIRMED
                              │
                              │ Finance assigns to Processing
                              ▼
                          SENT TO PROCESSING ─────────► NEW PROCESSING INTAKE
                                                              │
                                                              ▼
                                                        (Processing module owns
                                                          everything from here)
```

**Parallel side flows:**

- **Partial payment**: receipt covers only deposit → status is `Deposit Verified`,
  case waits in `Awaiting Balance` until full amount received.
- **Cheque payment**: between `Verified` and `Approved`, status sits in
  `Awaiting Clearance` for N business days before moving forward.
- **Hold**: officer can pause a verification with a reason — case sits in
  `On Hold` and doesn't count against SLA.
- **Refund**: a verified payment can be refunded — opens a `Refund Request`
  flow that requires manager approval before money goes out.

---

## 4. User roles & permissions matrix

| Action | Finance Officer | Senior Finance | Finance Manager | Finance Auditor | Admin |
|---|---|---|---|---|---|
| View intake queue | ✓ | ✓ | ✓ | ✓ | ✓ |
| Claim case for verification | ✓ | ✓ | ✓ | — | ✓ |
| Verify ≤ threshold | ✓ | ✓ | ✓ | — | ✓ |
| Verify > threshold (needs second approval) | submit only | submit + approve | submit + approve | — | ✓ |
| Request correction | ✓ | ✓ | ✓ | — | ✓ |
| Reject payment | ✓ | ✓ | ✓ | — | ✓ |
| Generate receipt | ✓ | ✓ | ✓ | — | ✓ |
| Send to processing | ✓ | ✓ | ✓ | — | ✓ |
| Approve discount ≤ 5% | ✓ | ✓ | ✓ | — | ✓ |
| Approve discount 5-15% | — | ✓ | ✓ | — | ✓ |
| Approve discount > 15% | — | — | ✓ | — | ✓ |
| Initiate refund | ✓ | ✓ | ✓ | — | ✓ |
| Approve refund ≤ CAD 500 | — | ✓ | ✓ | — | ✓ |
| Approve refund > CAD 500 | — | — | ✓ | — | ✓ |
| End-of-day close | — | ✓ | ✓ | — | ✓ |
| Bank reconciliation | — | ✓ | ✓ | — | ✓ |
| Reverse a verified payment | — | — | ✓ | — | ✓ |
| Override SLA / unblock | — | — | ✓ | — | ✓ |
| View audit log | ✓ (own actions) | ✓ | ✓ | ✓ (all) | ✓ |
| Export reports | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit officer roster | — | — | — | — | ✓ |
| Edit FX rates | — | — | ✓ | — | ✓ |

▸ **DECIDE:** thresholds for maker-checker (suggest CAD 1,500 / ~PKR 100K).
▸ **DECIDE:** discount approval bands (suggest 5% / 15% / >15%).
▸ **DECIDE:** refund approval threshold (suggest CAD 500).

---

## 5. Screen inventory (full)

Each screen below has the same template: **purpose / inputs / sections /
actions / edge cases**. Build them in roughly this order (priority in §22).

### 5.1 Finance Dashboard

**Purpose:** Officer/manager landing page. What needs my attention today?

**KPI strip (six tiles):**

| Tile | Value | Tone |
|---|---|---|
| New from Sales | count | accent |
| Under Verification (mine) | count | info |
| Awaiting Balance | count | warm |
| Correction Required | count | warning |
| Ready for Processing | count | success |
| Collected Today | amount in base currency | warm |

**Below KPIs:**

- **Today's verification queue** — list of cases assigned to me, sorted by
  SLA-time-remaining (most urgent first).
- **Problem pile** — rejected, correction-required, on-hold cases that are
  >24h old.
- **Reconciliation status** — has end-of-day been done for yesterday? Yes/no
  badge; click to open.
- **Refund inbox** (managers only) — pending refund approvals.
- **Collection summary card** — today / week / month with breakdown by method.

**Edge cases:**
- Empty dashboard for a new finance officer with no assigned cases.
- Manager view shows team-wide pile; officer view shows only "mine".

---

### 5.2 Finance Intake Queue

**Purpose:** All cases Sales has handed to Finance, awaiting verification.

**Filters (left-rail or chip strip):**
- Status: all / new / under verification / correction / on hold / awaiting clearance / awaiting balance
- Payment method
- Sales person (autocomplete)
- Finance officer (assigned to)
- Branch
- Amount range
- Date range
- Priority

**Columns / card fields:**
- Client name + avatar
- Service + target country
- Amount + currency
- Payment method icon
- Receipt status (uploaded / missing / multiple)
- Sales owner
- Time waiting (SLA-coloured)
- Priority badge
- Assigned-to officer (or "Unclaimed")

**Actions on each row:**
- Open verification detail (primary)
- Claim (if unclaimed)
- Reassign (manager only)
- Mark urgent
- Quick reject (with mandatory reason — opens modal)

**Bulk actions:**
- Bulk reassign to officer
- Bulk mark urgent

**Edge cases:**
- Case is locked by another officer who's currently reviewing — show "Being
  reviewed by Maria K." badge; opening it shows a read-only view.
- Case is past SLA — row turns warning-tone, with "SLA breach" badge.
- Multiple receipts on one record — collapse into a count chip "3 files".

---

### 5.3 Payment Verification Detail

**The workhorse screen.** Finance officer spends most of their day here.

**Layout:** Two-column. Left = receipt preview (sticky), right = verification
form + actions.

**Sections (right column, top to bottom):**

1. **Client summary** — name, phone, email, service, target country, lead
   source, sales person, "View lead profile →".

2. **Sales handover details** — what sales sent, when, sales note.

3. **Expected vs. received** — amounts side-by-side. Mismatch is highlighted
   in red.

4. **Payment details (editable)** — verified amount, currency, payment
   method, transaction reference, bank/account, received date, received by
   (sales person who collected).

5. **Verification checklist** — 8 toggleable checks:
   - Amount matches expected
   - Payment method valid for this amount (e.g., cash limit)
   - Receipt image readable
   - Transaction reference exists (and not a duplicate)
   - Date is valid (not future, not >30d old)
   - Client name on receipt matches
   - Sales note reviewed
   - No outstanding compliance flag on client

6. **Duplicate / fraud flags** — auto-populated. Examples:
   - "Same reference seen 14 days ago on a different client — review"
   - "Same receipt image hash uploaded before"
   - "Client has 3 receipts in last 24h — verify intent"
   - Each flag can be "acknowledged" (with note) or "blocked" (rejects the
     verification).

7. **Tax & fee breakdown** (auto-calculated, editable) — service fee, govt fee, tax, total.

8. **Finance note** — free-form text for the officer's comments.

9. **Action bar (sticky bottom):**
   - Save Draft
   - Request Correction (opens reason picker — see 5.6)
   - Reject Payment (requires reason + manager-flag if > threshold)
   - **Verify Payment** (primary)
     - If above maker-checker threshold → submits as Pending Approval
     - Otherwise → moves to Approved immediately
   - Place on Hold (with reason)

**Left column — receipt preview:**

- File viewer (image / PDF / multiple receipts as tabs)
- Zoom + pan
- Rotate
- Compare side-by-side mode (when 2+ receipts on one record)
- OCR-suggested values pop-up: "Detected amount: CAD 1,500" → click to fill
- Re-upload (opens correction flow if sales originally uploaded wrong file)

**Edge cases:**
- Verification expires after N hours if officer abandons (releases lock).
- Submitting "Verify" on a case that exceeds officer's authority redirects
  to "Pending Approval" — not a silent failure.
- Receipt missing entirely → can't verify, action bar shows "Request
  Receipt from Sales".

---

### 5.4 Pending Approval (maker-checker)

**Purpose:** Senior finance / manager queue. Cases above threshold awaiting
second-pair-of-eyes approval.

**Layout:** Similar to intake queue but every row is already 80% verified.

**Each row shows:**
- Client + amount
- Maker (who verified)
- Maker's verification timestamp + note
- Time waiting for approval
- Quick actions: Approve, Send back to Maker, Reject

**Approval detail:**
Same as verification detail but with a "Maker's verification" panel pre-filled
read-only, and the second officer's action bar:
- Approve & Confirm Receipt (primary)
- Send back to Maker (with correction note)
- Override (admin only)

**Edge cases:**
- Maker tries to also be checker → blocked at API level.
- Approval times out — case is auto-escalated to manager after N hours.

---

### 5.5 Receipt Confirmation

**Purpose:** Generate the formal receipt artifact after verification passes
(or maker-checker approval).

**Auto-generated fields (read-only):**
- Receipt number — `TF-{branch}-{YYYY}-{seq}` (see §16)
- Client name + ID
- Service
- Verified amount + currency
- Payment method
- Verified date
- Verified by (officer name)
- Approved by (if maker-checker triggered)

**Editable fields:**
- Public remarks (shown on the printed receipt to client)
- Internal remarks (hidden from client)
- Tax / fee itemization (final review)
- Receipt template (if branch has multiple templates)

**Actions:**
- Generate Receipt → mints the receipt number, locks the record
- Preview PDF
- Download PDF
- Email to client (uses template)
- WhatsApp to client (uses template)
- Print
- Mark Ready for Processing → moves to handover queue

**Edge cases:**
- Receipt number generation is atomic and idempotent — clicking twice doesn't
  create two numbers.
- If client email/phone is missing, the email/WhatsApp buttons are
  disabled with a tooltip "Add contact in lead profile".
- Receipt regeneration (rare — e.g. typo in client name) requires manager
  approval and leaves an audit log entry.

---

### 5.6 Correction Required (sales hand-back)

**Purpose:** When a receipt has a fixable issue (blurry image, wrong
reference, etc.), send it back to Sales with a clear ask **AND** with a
threaded conversation log that both sides see — so nothing gets lost across
multiple round-trips.

This is the most-bounced workflow in the system. Treat it like a support
ticket, not a status flip.

#### 5.6.1 Routing — back to the originating sales person

Hard rule: a correction request **always goes to the specific sales person
who originally handed the case to Finance**, not to a generic sales queue.

The `finance_handover_queue.sales_user_id` is the authoritative routing
target. The system reads from that field; UI cannot override it for a normal
officer.

**Rationale:**
- That sales person already has context on the client (who they are, why
  they're paying, what they discussed).
- Re-explaining to a different sales person adds latency and risk of
  mis-communication with the client.
- It creates a clean accountability loop: same sales person, same finance
  officer, same client.

**Visibility:**
- The case **also** appears in the originating sales person's manager queue
  (read-only) so the manager can intervene if it stalls.
- Sales manager dashboard shows "Corrections sitting with my team" with
  age and SLA status.

**Reassignment (rare, manager-only):** if the originating sales person is
unavailable (on leave, terminated, sick > 24h), the sales manager can
explicitly reassign the correction to another sales person. The reassignment:
- Logs `correction_reassigned` in the audit trail with reason.
- Is visible in the conversation thread ("Reassigned to Sara K. by manager
  because Awais Q. is on leave until 2026-05-20").
- Counts against the manager's quality metric (high reassignment rate = bad).

#### 5.6.2 The reason picker (Finance side)

Required when opening a correction:

- **One or more reason tags** (multi-select):
  - Receipt image unclear / unreadable
  - Amount mismatch (with received amount field)
  - Payment not yet received in our account
  - Wrong client / wrong reference on receipt
  - Duplicate receipt (already used on case X)
  - Suspected fraudulent receipt
  - Missing transaction reference
  - Wrong payment method category
  - Sales uploaded wrong file
  - Other (free text required, no default)

- **Officer note** (required, ≥ 20 chars): describes what Sales needs to do
  in concrete terms. "Resend a clearer photo of the bank slip showing the
  reference number `TFN-2391` and the timestamp" — not "image not clear".

- **Target SLA** (default 24h, officer can adjust to 4h / 24h / 48h / 5d).

- **Required action** (picker): _Re-upload receipt_ / _Provide reference
  number_ / _Confirm with client_ / _Contact bank_ / _Other_. Helps Sales
  triage quickly.

#### 5.6.3 The correction conversation thread

This is the heart of the workflow. Every correction has a persistent,
ordered thread of messages between Finance and Sales, attached to the case
forever.

**The thread:**

```
┌─────────────────────────────────────────────────────────────┐
│ Correction thread — Case TF-LHR-2026-000142                │
│ Started: 2026-05-09 14:22  ·  Status: Awaiting Sales       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ① Finance → Sales        2026-05-09 14:22    Hassan F.     │
│   Tag: Receipt unclear                                      │
│   Action: Re-upload receipt                                 │
│   SLA: 24h (due 2026-05-10 14:22)                          │
│                                                             │
│   Cannot read the transaction reference on the bank slip.   │
│   Need a clearer photo or screenshot with the reference     │
│   number visible.                                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ② Sales → Finance        2026-05-09 17:08    Awais Q.      │
│   Status: Resubmitted                                       │
│   Uploaded: bank-slip-clear.jpg                             │
│                                                             │
│   Called client, got a clearer copy. Reference is TFN-2391. │
│   Attached. Please re-verify.                               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ③ Finance → Sales        2026-05-09 17:42    Hassan F.     │
│   Tag: Amount mismatch                                      │
│   Action: Confirm with client                               │
│   SLA: 24h (due 2026-05-10 17:42)                          │
│                                                             │
│   Reference is now clear, thanks. But the slip shows        │
│   CAD 1,450, not 1,500. Confirm with client what amount     │
│   was actually paid.                                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ④ Sales → Finance        2026-05-09 18:31    Awais Q.      │
│   Status: Resubmitted                                       │
│   Note only (no new file)                                   │
│                                                             │
│   Confirmed with client — they paid 1,450 (received a       │
│   small loyalty discount). Please verify at 1,450 and       │
│   I'll update the lead amount on my side.                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Current status: Awaiting Finance review
Verifier on duty: Hassan F.
Total bounces: 2 (sales → finance: 2, finance → sales: 2)
Total time in correction loop: 4h 9m
```

**Thread message types:**

| Type | Direction | Created by | What it represents |
|---|---|---|---|
| `correction_request` | Finance → Sales | Finance officer | New correction ask (with reason tags + required action) |
| `correction_resubmission` | Sales → Finance | Sales person | Sales resubmits with note (and optionally new files) |
| `internal_note` | One side only | Either | Note not sent to the other side (rare, for manager visibility) |
| `system_event` | — | System | Auto-events: reassigned, SLA breached, escalated to admin |
| `manager_intervention` | Either | Manager | When a manager steps in with a message |

**Each message has:**
- Author (user + role + timestamp)
- Direction (finance→sales or sales→finance, or system)
- Reason tags (for correction_request type)
- Required-action picker (for correction_request type)
- Body text (always)
- Attached files (optional, common for resubmissions)
- Internal flag (visible to managers only, default false)

**Thread is append-only.** Messages cannot be edited or deleted once sent.
If an officer needs to retract, they post a follow-up message explicitly
saying so — the original stays.

**Thread is visible to:**
- Originating sales person (always)
- Sales manager of that sales person (always, read-only)
- Finance officer currently assigned (always)
- Finance manager (always, read-only)
- Any other officer who has previously been on the case (always, read-only)
- Admin (always)

**Thread is NOT visible to:**
- Other sales people on the same team
- Other finance officers not involved in this case
- The client (this is internal — client-facing communication is separate)

#### 5.6.4 What happens when Finance hits "Request Correction"

1. Officer fills the reason picker + note + SLA + required action.
2. Click "Request Correction" → triggers atomically:
   - `payment_records.status` → `correction_required`
   - New `correction_thread` row created (if first correction) or reused
     (if this is a 2nd / 3rd bounce on the same case)
   - New `correction_message` of type `correction_request` appended to the
     thread, addressed to `finance_handover_queue.sales_user_id`
   - `finance_audit_log` entry written
   - Notification dispatched to **the originating sales person** via their
     configured channels (in-app always, WhatsApp / email per their prefs)
   - SLA timer starts
3. Case appears in the originating sales person's "Corrections" inbox.
4. Case **also** appears in the sales manager's team-corrections view (read-only).
5. Case is removed from active finance verification (released from any lock).

#### 5.6.5 What happens when Sales hits "Resubmit to Finance"

Sales-side flow (canonical, even though the screen lives in the Sales module):

1. Sales person opens the correction inbox item.
2. Sales reads the full thread, sees the latest correction_request.
3. Sales takes action — may call client, upload new file, both, or just
   reply with a note.
4. Sales fills:
   - Note (required if no new file uploaded, ≥ 10 chars)
   - File upload (optional, but common)
5. Click "Resubmit to Finance" → triggers atomically:
   - `payment_records.status` → `under_verification` (re-enters the queue)
   - New `correction_message` of type `correction_resubmission` appended
   - Linked to the same `correction_thread` as the original request
   - `finance_audit_log` entry
   - **Notification dispatched to the SAME finance officer who originally
     raised the correction** — not a generic finance inbox
   - SLA timer for sales correction stops; verification SLA timer restarts
6. Case re-enters the finance verification screen for the same officer.
7. If that officer is unavailable (on leave > 24h), the case falls to the
   finance manager's reassignment queue.

#### 5.6.6 Re-routing rules — keeping the same pair of eyes

By default, every round-trip keeps the same finance officer ↔ same sales
person pair. This is the accountability loop.

| Scenario | Default behaviour |
|---|---|
| Finance officer raised correction, then resubmission comes back | Goes to same finance officer |
| Finance officer is offline / on leave > 24h | Reassigned by finance manager |
| Sales person is offline / on leave > 24h | Reassigned by sales manager |
| Either party permanently leaves the company | Manager reassigns + thread shows the reassignment system event |
| Case bounces 3+ times | Auto-escalated to both managers (still same pair though, unless explicitly reassigned) |

The system **does not** silently reroute. Every reassignment is a visible
system event in the thread.

#### 5.6.7 Correction queue UI (this screen)

Default view for a finance officer = **my corrections** — cases currently in
`correction_required` that THIS officer raised.

Default view for a sales person = **my corrections inbox** — cases currently
in `correction_required` assigned to THIS sales person (the originating one,
or a reassignee).

**Filters:**
- Status (awaiting sales / awaiting finance / escalated / resolved)
- Reason tag(s)
- Originating sales person (finance manager view)
- Verifying finance officer (sales manager view)
- SLA breach (yes / no)
- Age (< 4h / 4-24h / 1-2d / > 2d)
- Branch
- Number of bounces (1 / 2 / 3+)

**Each row shows:**
- Client name + amount
- Reason tag(s) (latest message)
- Last message preview (first 60 chars)
- Last message author + timestamp
- SLA countdown (red if breached)
- Bounce count chip ("2nd bounce")
- Direction indicator ("→ awaiting sales" or "← awaiting finance")

**Row click → opens the full thread view** (the conversation log shown above).

#### 5.6.8 Edge cases + safeguards

- **Sales never responds (SLA breached):** at 1× SLA → reminder in sales
  inbox. At 1.5× SLA → notification to sales manager. At 2× SLA → admin
  notification + case appears in "Stuck cases" admin dashboard.
- **Same case bounces 3+ times:** auto-escalates to both finance and sales
  managers. They jointly decide: reassign, reject, or admin intervention.
- **Sales resubmits without changing anything:** if no new file AND note
  text is identical to a previous message, system warns sales before posting
  ("You haven't changed anything since last time — are you sure?").
- **Sales person resubmits but the original finance officer is gone:**
  finance manager's reassignment queue picks it up. The thread shows the
  system event clearly.
- **Sales person quits mid-correction:** sales manager reassigns. Thread
  shows the system event. New sales person can read the whole history.
- **Correction marked "Resolved" prematurely:** doesn't happen — resolution
  only comes from finance hitting "Verify Payment" or "Reject" on the
  resubmitted case. There's no manual "close thread" action.
- **A case is rejected outright (not corrected):** thread is preserved
  forever for audit, even though no more messages will be added.
- **Multiple corrections on the same payment_record:** they all live in
  **one** thread per payment_record. The thread persists across bounces, so
  you can always see the full history from first correction to final
  resolution.

#### 5.6.9 What "resolution" looks like

A correction thread is **resolved** when:
- Finance hits "Verify Payment" on the resubmitted case (positive path), OR
- Finance hits "Reject Payment" definitively (negative path), OR
- Admin manually closes the case with reason (rare).

On resolution:
- A final `system_event` message is appended ("Resolved: Payment Verified by
  Hassan F." or "Resolved: Rejected — fraudulent receipt").
- The thread becomes read-only.
- Both sides get notification of resolution.
- Thread + all messages remain queryable in `Payment History` audit view.

---

### 5.7 On-Hold Queue

**Purpose:** Cases the officer can't act on right now (e.g., waiting for
bank confirmation, waiting for branch manager call, etc.).

Distinct from `Correction Required` because the ball is with Finance / external
parties, not Sales.

**Hold reasons:**
- Awaiting bank confirmation
- Awaiting cheque clearance (auto-set when method = cheque)
- Awaiting compliance review
- Awaiting client clarification (rare — sales usually handles this)
- Manager review pending
- Other

**Features:**
- Auto-resume on a set date (e.g. cheque clearance in 5 days)
- Manual resume button
- Hold time doesn't count against verification SLA (only against "total time
  in finance" metric).

---

### 5.8 Awaiting Balance (partial payments)

**Purpose:** Client paid deposit, balance owed. The case sits here until full
payment received.

**Each row:**
- Client + service
- Total fee
- Paid so far (sum of verified payments)
- Outstanding balance
- Due date (if there's a payment plan)
- Last payment date
- Number of installments paid / total installments

**Actions on row:**
- Open payment plan
- Record new partial payment (opens verification flow tied to existing case)
- Send payment reminder to client
- Mark case as fully paid (only when balance = 0)

**Detail screen** = the payment plan (see §9).

---

### 5.9 Send to Processing Handover

**Purpose:** Final review + dispatch to processing.

Reached when payment is fully verified, fully paid, receipt confirmed.

**Sections:**
- Client + service summary (read-only)
- Verified payment summary
- Receipt number + download link
- Sales note (read-only)
- Finance note (read-only)
- **Processing assignment**:
  - Processing department (Study Visa / Work Permit / etc.) — auto-suggested
    from service, editable
  - Processing officer / team — auto-assigned by load balancer, editable
  - Processing priority (Normal / Rush / Critical)
- Finance handover note (free text — what Processing should know first)

**Actions:**
- Send to Processing (primary, big green button)
- Cancel and return to verified state (rare)
- Hold processing dispatch (with reason)

**What sending does:**
- Creates a record in `processing_handover_queue`
- Finance status → `Sent to Processing`
- Lead stage → `Finance Verified`
- Processing inbox gets new item
- Sales person and Admin both get notified
- Audit log entry

---

### 5.10 Payment History

**Purpose:** Searchable, filterable, exportable record of every payment.

**Columns:**
- Receipt number
- Date verified
- Client (name + ID)
- Service
- Amount + currency
- Base currency equivalent
- Payment method
- Sales owner
- Finance officer (verifier)
- Approver (if maker-checker)
- Status
- Branch
- Sent to Processing date

**Filters:** date range, officer, sales person, method, branch, service,
status, amount range, currency.

**Row actions:**
- Open detail (read-only verification view)
- View receipt PDF
- View audit timeline
- Initiate refund (if eligible)
- Reverse (manager only, rare)

**Export:** CSV, PDF, XLSX. Selected columns + filtered rows.

---

### 5.11 Refunds

**Purpose:** Track money flowing back to the client.

**When refunds happen:**
- Visa rejected → client entitled to partial refund per policy
- Client withdraws before processing → full or partial refund
- Service delivered short — partial refund as goodwill
- Duplicate / wrong amount paid — full refund

**Refund initiation:**
- From `Payment History`, find the verified payment, click "Initiate Refund".
- Refund form: amount (≤ original), reason (picker), client communication
  note, refund method (cash / bank / original method).
- Submitted → status `Pending Approval (Refund)` — managers see in dashboard.

**Refund approval:**
- Manager reviews, can approve / reject / send back to officer.
- On approval, refund execution screen opens:
  - Confirm refund method
  - Generate refund receipt number (`TF-{branch}-{YYYY}-R-{seq}`)
  - Record payout details
  - Update case status (if refund > 50% of payment → case status to `Refunded`,
    otherwise `Partially Refunded`)

**Refund queue:**
- Pending approval
- Approved + pending execution
- Executed (history)

**Audit:**
- Refund record links to original payment record (foreign key)
- Original verification record is unchanged (immutable)
- Refund creates a separate audit-log chain

▸ **DECIDE:** refund policy — what % refundable at each lead stage? What
about non-refundable processing fees once visa work has started?

---

### 5.12 Reconciliation (end-of-day + bank match)

**Purpose:** Finance can't trust the books without daily close.

**Cash reconciliation (per branch, per officer):**
- All cash receipts officer recorded today
- Cash drawer physical count
- Discrepancy (zero is required to close)
- Officer signs off
- Manager counter-signs

**Bank reconciliation (daily):**
- Import bank statement (manual upload CSV or API)
- Auto-match: bank transactions ↔ verified payment records by reference + amount + date
- Unmatched bank transactions → "Money received but no receipt — investigate"
- Unmatched verified payments → "Receipt verified but money not in bank yet — flag"
- Manual match button for items the auto-match misses

**End-of-day report:**
- Total cash collected, by branch
- Total bank transfers, matched / unmatched
- Total card, matched / unmatched
- Total refunds executed
- Net change

▸ **DECIDE:** which banks Tafsheen uses and whether they have CSV / API
statement access.

---

### 5.13 Reports

**Reports list:**
- Daily / weekly / monthly collection
- Collection by payment method
- Collection by sales person (sales attribution)
- Collection by service / by country
- Collection by branch
- Average verification time per officer
- SLA breach report
- Correction rate per sales person
- Rejection rate per sales person (fraud signal)
- Refund report (volume + reasons)
- Aging report (cases sitting in finance > X days)
- Conversion funnel (sales handover → receipt confirmed rate)
- Fraud / duplicate flag report

**Each report:**
- Date range selector
- Filter by branch / officer / sales person
- Visualizations (chart + table)
- Export (CSV / PDF)
- Drilldown to individual records

---

## 6. Status taxonomy (all the states)

```
PAYMENT RECORD STATUS

new_from_sales              Sales handed over, awaiting officer claim
under_verification          Officer claimed, actively reviewing
on_hold                     Paused with reason
awaiting_clearance          Cheque awaiting bank clearance
pending_approval            Above threshold, awaiting senior approver
correction_required         Sent back to sales with reason
rejected                    Definitively rejected, closed
verified                    Approved, awaiting receipt confirmation
receipt_confirmed           Receipt minted, ready to send to processing
awaiting_balance            Partial payment received, balance owed
sent_to_processing          Handed off to processing
refunded                    Fully refunded
partially_refunded          Partial refund issued
reversed                    Verified payment reversed (rare, admin only)
```

**Allowed transitions:**

```
new_from_sales
  → under_verification (officer claims)
  → rejected (quick reject from queue)

under_verification
  → on_hold | awaiting_clearance
  → correction_required (back to sales)
  → rejected (definitively)
  → verified (single approver, ≤ threshold)
  → pending_approval (> threshold)

pending_approval
  → verified (second approver OK)
  → under_verification (second approver sends back)
  → rejected

verified
  → receipt_confirmed (receipt number generated)
  → awaiting_balance (partial payment scenario)
  → reversed (admin only)

receipt_confirmed
  → sent_to_processing
  → awaiting_balance (if still owed)

awaiting_balance
  → receipt_confirmed (new payment closes the balance)
  → refunded / partially_refunded

sent_to_processing
  → partially_refunded | refunded (if processing fails or withdrawal)
```

Some transitions are not allowed (e.g. `sent_to_processing → rejected`) —
the system must enforce this at the API level.

---

## 7. Data model

Building on your v1 schema. Renamed / added tables in **bold**.

### finance_handover_queue
Inbox of cases Sales has sent to Finance.

```
id                  uuid PK
lead_id             uuid FK leads
client_id           uuid FK clients
sales_user_id       uuid FK users
finance_user_id     uuid FK users (nullable, set on claim)
branch_id           uuid FK branches
status              enum (see §6)
priority            enum (low/normal/urgent)
sales_note          text
sent_to_finance_at  timestamptz
claimed_at          timestamptz
sla_due_at          timestamptz
sla_status          enum (active/breached/cleared)
created_at, updated_at
```

### payment_records
The actual payment fact. One per cash event.

```
id                          uuid PK
client_id                   uuid FK
lead_id                     uuid FK
finance_handover_id         uuid FK finance_handover_queue
branch_id                   uuid FK branches
expected_amount             numeric(12,2)
expected_currency           varchar(3)
received_amount             numeric(12,2)
received_currency           varchar(3)
fx_rate                     numeric(14,6)            base currency conversion locked at verification
base_currency_amount        numeric(12,2)            convenience for reports
payment_method              enum (cash/bank/card/cheque/mobile/wire/online/other)
payment_method_detail       jsonb                    { bank_account_id, card_last4, drawer_id, ... }
transaction_reference       varchar
payment_received_at         timestamptz
status                      enum (see §6)
is_deposit                  boolean                   true if this is part of a payment plan
payment_plan_id             uuid FK payment_plans     nullable
created_by_sales_user_id    uuid FK
created_at, updated_at
```

### payment_receipts
File attachments — bank slip, cash photo, screenshot.

```
id                  uuid PK
payment_record_id   uuid FK
file_url            text
file_type           enum (image/pdf)
file_size_bytes     bigint
file_hash           varchar(64)            sha256 of file bytes
perceptual_hash     varchar                 image fingerprint (for duplicate detection)
uploaded_by         uuid FK users
uploaded_at         timestamptz
ocr_extracted       jsonb                   { amount: ..., reference: ..., date: ... }
is_primary          boolean
```

### payment_verifications
Append-only verification log. **Never updated, only inserted.**

```
id                          uuid PK
payment_record_id           uuid FK
verification_attempt_no     int                     1, 2, 3 for re-verifications
verification_status         enum (verified/rejected/correction_required)
amount_matched              boolean
receipt_readable            boolean
transaction_verified        boolean
date_valid                  boolean
client_name_matched         boolean
duplicate_checked           boolean
fraud_flags_cleared         boolean
verified_by                 uuid FK users
verified_at                 timestamptz
approved_by                 uuid FK users           nullable (only if maker-checker)
approved_at                 timestamptz             nullable
finance_note                text
correction_reasons          text[]                  if correction_required
rejection_reason            text                    if rejected
```

### payment_holds
Holds applied to a payment record.

```
id                  uuid PK
payment_record_id   uuid FK
hold_reason         enum (bank/cheque/compliance/client/manager/other)
hold_note           text
held_by             uuid FK users
held_at             timestamptz
auto_resume_at      timestamptz nullable
resumed_at          timestamptz nullable
resumed_by          uuid FK users nullable
```

### **payment_plans**
For partial payment / installment scenarios.

```
id                  uuid PK
client_id           uuid FK
lead_id             uuid FK
total_amount        numeric(12,2)
currency            varchar(3)
installments        int                      number of payments planned
status              enum (active/completed/cancelled/defaulted)
created_by          uuid FK users
created_at, updated_at
```

### **payment_plan_installments**
Each scheduled installment row.

```
id                  uuid PK
payment_plan_id     uuid FK
installment_no      int
due_date            date
expected_amount     numeric(12,2)
paid_amount         numeric(12,2)           sum of payment_records.received_amount linked here
status              enum (upcoming/due/paid/overdue/cancelled)
```

### **receipts**
The formal receipt artifact. Distinct from `payment_receipts` (which are
uploaded proof) — `receipts` are what we issue to the client.

```
id                      uuid PK
receipt_number          varchar UNIQUE              TF-LHR-2026-000142
payment_record_id       uuid FK
client_id               uuid FK
service_id              uuid FK
issued_amount           numeric(12,2)
currency                varchar(3)
fee_breakdown           jsonb                       { service_fee, gov_fee, tax, ... }
issued_by               uuid FK users
issued_at               timestamptz
pdf_url                 text                        generated PDF, S3
sent_to_client_via      enum (email/whatsapp/print/none)
sent_at                 timestamptz nullable
```

### **refunds**
Refund records linked back to a verified payment.

```
id                          uuid PK
payment_record_id           uuid FK                 the original payment being refunded
amount                      numeric(12,2)
currency                    varchar(3)
fx_rate                     numeric(14,6)
reason                      enum (rejection/withdrawal/duplicate/goodwill/other)
reason_note                 text
initiated_by                uuid FK users
initiated_at                timestamptz
approval_status             enum (pending/approved/rejected)
approved_by                 uuid FK users nullable
approved_at                 timestamptz nullable
executed_at                 timestamptz nullable
execution_method            enum (cash/bank/card/original)
execution_reference         varchar
refund_receipt_number       varchar UNIQUE          TF-LHR-2026-R-000023
```

### **discounts**
Discount adjustments applied to a case.

```
id                  uuid PK
lead_id             uuid FK
service_quoted_amount   numeric(12,2)
discount_amount     numeric(12,2)
discount_pct        numeric(5,2)
reason              text
requested_by        uuid FK users
approved_by         uuid FK users
approval_band       enum (officer/senior/manager/admin)
approved_at         timestamptz
status              enum (active/cancelled)
```

### **bank_reconciliations**
Daily bank statement matching.

```
id                  uuid PK
branch_id           uuid FK
bank_account_id     uuid FK
statement_date      date
statement_url       text                       uploaded CSV / PDF
total_credits       numeric(12,2)
total_debits        numeric(12,2)
matched_count       int
unmatched_count     int
status              enum (in_progress/balanced/discrepancy/closed)
closed_by           uuid FK users
closed_at           timestamptz
```

### **bank_transactions**
Individual lines from the bank statement.

```
id                          uuid PK
bank_reconciliation_id      uuid FK
transaction_date            date
description                 text
reference                   varchar
amount                      numeric(12,2)
matched_payment_record_id   uuid FK payment_records nullable
match_status                enum (auto/manual/unmatched)
```

### **cash_drawer_sessions**
Per-officer per-day cash counting.

```
id                  uuid PK
branch_id           uuid FK
officer_id          uuid FK users
opened_at           timestamptz
closed_at           timestamptz nullable
opening_balance     numeric(12,2)
expected_closing    numeric(12,2)              opening + sum(cash receipts)
actual_closing      numeric(12,2) nullable
discrepancy         numeric(12,2) nullable
counter_signed_by   uuid FK users nullable
notes               text
status              enum (open/closed/discrepancy)
```

### **correction_threads**
One thread per payment_record. Persists across multiple bounces. The
authoritative routing record for finance ↔ sales correction conversations.

```
id                          uuid PK
payment_record_id           uuid FK UNIQUE             one thread per payment_record
originating_sales_user_id   uuid FK users              the sales person we ALWAYS route back to
current_sales_user_id       uuid FK users              == originating unless manager reassigned
originating_finance_user_id uuid FK users              the finance officer who raised first correction
current_finance_user_id     uuid FK users              == originating unless manager reassigned
sales_manager_id            uuid FK users              read-only watcher
finance_manager_id          uuid FK users              read-only watcher
status                      enum (awaiting_sales/awaiting_finance/resolved_verified/resolved_rejected/escalated)
bounce_count                int                        increments on each finance→sales→finance round-trip
opened_at                   timestamptz
resolved_at                 timestamptz nullable
resolution_type             enum (verified/rejected/admin_closed) nullable
total_time_open_seconds     int                        excludes time on the finance side
created_at, updated_at
```

### **correction_messages**
Append-only thread messages. **Never UPDATE, never DELETE.** Corrections,
resubmissions, system events, and manager interventions all live here.

```
id                  uuid PK
thread_id           uuid FK correction_threads
sequence_no         int                              1-based, monotonic within thread
message_type        enum (correction_request/correction_resubmission/internal_note/system_event/manager_intervention)
direction           enum (finance_to_sales/sales_to_finance/system) nullable for system_event
author_id           uuid FK users nullable           null for system_event
author_role         varchar                          captured at write time (officer/senior/manager/sales/admin/system)
reason_tags         text[]                           for correction_request only
required_action     enum (re_upload/provide_ref/confirm_with_client/contact_bank/other) nullable
sla_hours           int nullable                     for correction_request only
sla_due_at          timestamptz nullable
body                text                             required; ≥ 20 chars for correction_request, ≥ 10 for resubmission
is_internal         boolean DEFAULT false            true → visible to managers only
attachments         jsonb                            [{file_url, file_type, file_size, uploaded_at, hash}, ...]
posted_at           timestamptz
ip_address          inet
user_agent          text
```

A `UNIQUE(thread_id, sequence_no)` constraint protects against out-of-order
inserts.

System events (`message_type = 'system_event'`) are emitted by the backend
for: reassignment, SLA breach, escalation to admin, resolution. They have
`direction = NULL`, `author_id = NULL`, and a deterministic `body` like
"Reassigned by manager: Awais Q. on leave until 2026-05-20".

### **finance_audit_log**
Every state change, every decision, every override. Append-only.

```
id              uuid PK
actor_id        uuid FK users
actor_role      varchar
entity_type     enum (payment_record/verification/receipt/refund/handover/...)
entity_id       uuid
action          varchar                        verify / reject / approve_refund / reverse / ...
before_state    jsonb
after_state     jsonb
note            text
ip_address      inet
user_agent      text
at              timestamptz
```

### **fraud_flags**
Auto-detected red flags on a payment.

```
id                  uuid PK
payment_record_id   uuid FK
rule                enum (dup_reference/dup_image_hash/velocity/amount_pattern/...)
severity            enum (info/warning/blocking)
detected_at         timestamptz
acknowledged_by     uuid FK users nullable
acknowledged_at     timestamptz nullable
acknowledgment_note text
```

### processing_handover_queue
Inbox for the Processing module.

```
id                          uuid PK
client_id                   uuid FK
lead_id                     uuid FK
payment_record_id           uuid FK
receipt_id                  uuid FK
processing_department       varchar
processing_user_id          uuid FK users nullable
processing_priority         enum
status                      enum (new/claimed/in_progress/...)
finance_handover_note       text
sent_to_processing_by       uuid FK users
sent_to_processing_at       timestamptz
```

---

## 8. Multi-currency handling

The reality: Tafsheen quotes in CAD/USD/AUD/etc. but most clients pay in PKR
or AED. The system must handle this without losing money to FX confusion.

**Rules:**
1. `payment_records.received_amount` + `received_currency` capture **what the
   client actually paid** in whatever currency they used.
2. `expected_amount` + `expected_currency` capture **what the case was quoted
   for** at the time of payment.
3. `fx_rate` + `base_currency_amount` lock the conversion at verification time.
   Once locked, this is the number reports use forever.
4. The base currency is set per branch / org (suggest PKR for HQ, CAD for
   Toronto branch if you go international).
5. FX rates are managed by Finance Manager via a daily-set rates table.

**Why lock the rate?** If verification happens 3 days after the payment, and
PKR has moved 2% against CAD, you don't want to retroactively change the
client's verified amount.

▸ **DECIDE:** base currency per branch.
▸ **DECIDE:** FX rate source — manual entry by manager, central bank API,
  or both (manual override of API)?

**UI implications:**
- Verification screen shows `received_currency` prominently.
- Reports default to base currency but allow toggle to "as received".
- Receipt shows received currency only (client doesn't care about your base).

---

## 9. Partial payments & installment plans

**Two scenarios:**

### Scenario A: Deposit + balance (informal)

Most common. Client pays a deposit (e.g. 30%), promises to pay balance "soon".

- First payment record: `is_deposit = true`, status flows normally → `verified`.
- Case status becomes `Awaiting Balance`.
- Lead stays in finance (not sent to processing) until full payment cleared.
- Sales is notified that case is waiting for balance — they nudge the client.
- Second payment record created when balance arrives, same verification flow.
- When `sum(verified payments) >= expected_amount`, case is fully paid and
  flows to processing.

### Scenario B: Formal payment plan (installments)

Client and sales agree to 3 monthly installments. Tafsheen wants visibility
into the schedule.

- Sales creates a `payment_plan` with N installments and due dates.
- Each payment record references its installment row.
- The plan has its own status (`active` / `completed` / `defaulted`).
- Overdue installments show up in finance's "Defaulters" queue → trigger
  sales follow-up.

**UI:**
- `Awaiting Balance` queue shows: total owed, paid-so-far, last-payment-date.
- Payment plan detail shows the full schedule with paid/unpaid markers.

▸ **DECIDE:** processing start policy — wait for full payment? Or start
  processing once deposit verified? (Industry standard varies; for visa work
  many agencies start processing on deposit.)

---

## 10. Refunds, adjustments, write-offs

Detailed in §5.11. Key invariants:

- Refund references a verified payment record (cannot refund an unverified one).
- Refund creates a new record — does not modify the original.
- Refund approval is mandatory above a threshold.
- Refund execution records the actual payout method and reference.
- Refund receipt has its own numbering scheme (`-R-`).
- Reports separate refunds from collections (so "net collected" is meaningful).

**Write-offs** (giving up on collecting an outstanding balance):
- Only manager can write-off.
- Creates a `write_off` record (similar shape to refund but no payout).
- Lead is closed with reason.

▸ **DECIDE:** refund policy by case stage:
  - Pre-processing: 100% refundable minus admin fee?
  - In processing: % refundable per stage?
  - Visa denied: full refund of processing portion?
  - Withdrawn after submission: nothing refundable?

---

## 11. Discounts & fee adjustments

Sales sometimes negotiates a discount with the client. Finance needs to know
about it so the expected amount matches what arrives.

**Flow:**
- Sales applies a discount during quote stage → creates a `discounts` record.
- Discount > some threshold requires approval before the case can leave Sales.
- Approval flows via a separate `discount approval` inbox (manager / admin).
- Once approved, the discount is reflected in `expected_amount`.
- Finance verification compares against the **discounted** expected amount.

▸ **DECIDE:** approval bands (suggest 0-5% officer, 5-15% senior, >15% manager,
  promotional campaign discounts pre-approved by admin).

---

## 12. Maker-checker & approval limits

For any payment > `maker_checker_threshold` (suggested CAD 1,500 or local
equivalent):

- The verifying officer (maker) submits → status `pending_approval`.
- A different officer (checker, must have approval permission) reviews and approves.
- System enforces maker ≠ checker.

For refunds, discounts, reversals, write-offs — separate approval bands per §4.

**Why this matters:** trivial to bypass internal-fraud checks without this.
A single bad-actor officer can verify their friend's fake receipts. Two
officers can collude but it's a much harder bar.

---

## 13. Fraud & duplicate detection

The system auto-runs these rules on every payment record at verification time.
Each match creates a `fraud_flag` with severity:

| Rule | Severity | Trigger |
|---|---|---|
| Duplicate transaction reference | **blocking** | Same reference + amount in another record within 90 days |
| Identical receipt image hash | **blocking** | sha256 of file matches another upload |
| Similar receipt image (perceptual hash) | warning | Within Hamming distance 5 of another image |
| Velocity: same client | warning | Client has ≥ 3 payments in 24h |
| Velocity: same officer | warning | Officer processed > 20 verifications in an hour |
| Amount pattern | info | Round number ending in 999 / 9,000 |
| Date pattern | info | Receipt dated > 30 days ago |
| Client name vs. receipt name mismatch | warning | Fuzzy name match below 80% |
| Bank account mismatch | warning | Bank ref not from our known accounts |

**Blocking flags:**
- Officer cannot mark Verify until the flag is acknowledged with a written note.
- All blocking-flag acknowledgments are in the audit log.
- Manager-level review can override a blocking flag.

**Warning flags:**
- Visible in the verification screen but don't block.
- Officer is expected to add a note explaining how they cleared it.

**Info flags:**
- Decorative only — for the officer's awareness.

---

## 14. SLA, escalation & inbox

### SLAs (proposed defaults)

| Event | SLA |
|---|---|
| New from Sales → Officer claims | 30 min |
| Under Verification → Verified | 2h (cash), 4h (card), 6h (online), 24h (bank) |
| Cheque payment → Cleared | 5 business days |
| Correction Required → Sales resubmits | 24h |
| Verified → Receipt confirmed | 1h |
| Receipt confirmed → Sent to processing | 4h |
| Refund initiated → Approved | 24h |
| Refund approved → Executed | 48h |

### Escalation rules

- SLA breached → notification to officer's manager.
- 2x SLA breached → notification to finance manager + admin.
- 3x SLA breached → admin auto-reassigns to another officer.

### Officer inbox

Each officer has a single "inbox" landing screen aggregating:
- Cases I claimed but haven't verified
- Cases assigned to me by manager
- Corrections waiting for my review
- Refund approvals (if I'm senior/manager)
- SLA breaches I'm responsible for
- Yesterday's reconciliation if not closed

The inbox is the de-facto homepage for finance team members.

---

## 15. Reconciliation & end-of-day close

Critical for trust in the numbers. Without this, the finance dashboard's
"Collected Today" is a guess.

### Daily close routine

End of each business day, **per branch**:

1. **Cash drawer close** — each officer reconciles their drawer.
   - System lists expected cash (opening balance + verified cash receipts).
   - Officer enters actual count.
   - Discrepancy ≠ 0 → cannot close until investigated. Either:
     - Officer finds the error (missing receipt entry, miscount)
     - Manager overrides with a `cash_variance` note → flagged in audit
2. **Bank statement upload** — finance manager uploads daily bank CSV.
   - Auto-match runs: bank credit ↔ verified bank payment record (by ref +
     amount + date).
   - Unmatched bank credits → "Money received but no receipt recorded yet" →
     creates "Investigate" task.
   - Unmatched verified bank payments → "Receipt verified but money not in
     bank yet" → flag for cheque-clearance or bank delay.
3. **Card terminal close** — same pattern for POS settlement.
4. **Daily summary report** — gets emailed to manager + admin.

### Discrepancy handling

- Small variances (< 1% or < CAD 10) → manager can close with note.
- Large variances → blocks close until investigated by admin.
- All variances are in the audit log forever.

---

## 16. Receipt numbering scheme

Format: `TF-{branch}-{YYYY}-{6-digit-seq}`

Examples:
- `TF-LHR-2026-000142` (Lahore branch, 142nd receipt of 2026)
- `TF-KHI-2026-000003` (Karachi branch)
- `TF-LHR-2026-R-000023` (refund receipt)
- `TF-LHR-2026-V-000007` (void, rare)

**Properties:**
- Sequence resets at year boundary per branch.
- Atomic (DB sequence, never two same numbers).
- Receipt numbers are immutable once generated.
- Voids / corrections get a NEW number with `-V-` and reference the original.

▸ **DECIDE:** branch codes (suggest 3-letter airport-style: `LHR`, `KHI`,
  `ISB`, `TOR`).

---

## 17. Audit trail & immutability

The audit log is the legal record. Treat it like banking software.

**Rules:**
1. `payment_verifications`, `receipts`, `refunds`, `correction_threads`,
   `correction_messages`, and `finance_audit_log` are **append-only** at the
   API level. The backend rejects UPDATE on these tables. Corrections create
   new records linked to the prior; they never overwrite.
2. Every state change writes a `finance_audit_log` row with:
   - Actor user + role
   - Before / after state (JSONB)
   - IP, user agent
   - Timestamp
3. Correction-thread events double up: in addition to writing a
   `correction_messages` row, the backend writes a `finance_audit_log` row
   for state changes (`correction_requested`, `correction_resubmitted`,
   `correction_reassigned`, `correction_resolved`). The conversation log and
   the audit log are two independent records of the same event, kept in
   sync.
4. The audit log is exposed to Finance Auditor role read-only.
5. Audit log entries are **never deleted**, even if the underlying record is.
6. PII in audit logs gets the same encryption-at-rest treatment as the main
   tables.

**UI:** Every detail screen has an "Audit timeline" tab showing every action
taken on this record, chronologically. For payment records that went through
correction, the audit timeline interleaves system audit events with the
correction-thread messages so a Finance Auditor (or admin) can see the full
human + system narrative on one page.

---

## 18. Notifications

Per recipient (specific user, not a generic queue), per channel, per event:

| Recipient | Event | Channel(s) |
|---|---|---|
| **Originating sales person** (`correction_threads.current_sales_user_id`) | Correction requested | in-app + WhatsApp |
| **Originating sales person** | Reminder at 1× SLA, no resubmission yet | in-app |
| Sales manager of originating sales person | Correction at 1.5× SLA (no resubmission) | in-app + email |
| Originating sales person | Payment finally verified after correction | in-app |
| Originating sales person | Payment finally rejected after correction loop | in-app + WhatsApp + email |
| **Originating finance officer** (`correction_threads.current_finance_user_id`) | Sales resubmitted correction | in-app + (email if officer offline > 30m) |
| Finance manager | Sales has resubmitted but original officer is offline > 24h | in-app + email |
| Sales manager + Finance manager | Same case bounced 3+ times | in-app + email |
| Admin | Correction at 2× SLA still unresolved | in-app + email |
| Sales person being reassigned-to | Manager reassigned a correction to me | in-app + WhatsApp |
| Finance officer being reassigned-to | Manager reassigned a correction to me | in-app |
| Originating finance officer (general) | New case from sales for me to verify | in-app |
| Finance officer | SLA approaching on my verification | in-app + email |
| Manager | SLA breached | in-app + email |
| Manager | Refund awaiting approval | in-app + email |
| Manager | Discrepancy in cash close | in-app + email |
| Admin | Officer escalation | in-app + email |
| Admin | Fraud blocking flag | in-app + email |
| Client | Receipt issued | email + WhatsApp |
| Client | Refund executed | email + WhatsApp |
| Processing officer | New case handed over | in-app |

**Routing invariant:** notifications about a correction-thread event ALWAYS
go to the specific user in `correction_threads.current_sales_user_id` /
`current_finance_user_id`. Never to a generic team channel. The team channel
sees an aggregated daily digest if at all.

Each user has notification preferences (toggle per event per channel) in
their profile. Reassignment and SLA-breach notifications are mandatory and
cannot be disabled.

---

## 19. Integrations

Not all of these need to be in v1, but the data model should not preclude them.

### Bank integration

- Daily CSV import (manual upload) — v1
- Direct API integration with each bank — v2+ (depends on bank)
- Real-time webhook for high-value transfers — v3

### Accounting export

- Daily / monthly export to QuickBooks / Xero / Tally / SAP — v2
- Format: configurable per accounting system

### Receipt delivery

- PDF generation (server-side, with branch letterhead) — v1
- Email delivery (with branded template) — v1
- WhatsApp delivery via WhatsApp Business API — v1
- Client portal (clients download from their portal) — v2

### Notification channels

- In-app (built-in) — v1
- Email (SMTP or transactional like Resend/Postmark) — v1
- WhatsApp (Business API) — v1
- SMS — v2

### OCR / receipt parsing

- Receipt image → extracted amount, reference, date — v2
- Powered by a vision model (suggest GPT-4o or Anthropic Claude vision)
- Pre-fills verification form, officer confirms
- Big productivity win, not in scope for v1

### Anti-money laundering (AML)

- Large-amount flagging — v1 (built into fraud rules)
- Sanctions list screening — v3+ (depends on regulatory environment)

---

## 20. Edge cases & policy decisions needed

Collected from the spec. Each `▸ DECIDE` above is repeated here for quick
review. Tag each with an owner and decide before that screen is built.

| # | Decision | Suggested default | Owner |
|---|---|---|---|
| 1 | Maker-checker threshold | CAD 1,500 (PKR ~100K) | Finance Manager |
| 2 | Discount approval bands | 5% / 15% / >15% | Finance Manager + Sales head |
| 3 | Refund approval threshold | CAD 500 | Finance Manager |
| 4 | Base currency per branch | PKR for HQ | Finance Manager |
| 5 | FX rate source | Manual entry, manager-owned | Finance Manager |
| 6 | Processing start on deposit or full payment? | Full payment unless service config says otherwise | Operations + Finance |
| 7 | Refund % at each lead stage | Pre-processing 90%, in-processing varies by stage, denial 100% of processing | Legal + Operations |
| 8 | Banks Tafsheen uses & statement access | List from Finance | Finance Manager |
| 9 | Branch codes | 3-letter | Admin |
| 10 | Cash discrepancy tolerance | < 1% or < CAD 10 | Finance Manager |
| 11 | Cheque clearance days | 5 business days | Finance Manager |
| 12 | SLA per payment method | See §14 | Finance Manager |
| 13 | Notification channels per event | See §18 | Operations |
| 14 | Tax / fee structure | Per service | Finance + Tax Advisor |
| 15 | Receipt template — content & branding | Per branch optional | Marketing + Finance |
| 16 | What happens to a case if processing rejects it later? | Refund per policy or move to redo state | Operations |
| 17 | Are processing fees non-refundable? | Likely yes once started | Legal |
| 18 | Sales discount above 15% — can officer enter it or must manager pre-approve? | Officer can request, manager must approve before client sees | Sales Manager |
| 19 | Officer authority — can junior officers reject payments unilaterally? | Yes, but rejections are sample-audited weekly | Finance Manager |
| 20 | What if a verified payment is later found fraudulent? | Reversal process, admin-only, very rare | Admin |
| 21 | Correction SLA defaults per reason tag — should "Receipt unclear" have a shorter SLA than "Amount mismatch"? | Same default (24h), officer can override per-message | Finance Manager |
| 22 | What's the absolute time-out where Admin auto-closes a stale correction? | 14 days no movement → admin intervention | Finance Manager + Sales Manager |
| 23 | Should sales managers be able to read internal-flagged messages on threads inside their team, even though they're for finance managers? | No — internal = single side | Finance Manager + Sales Manager |
| 24 | What happens to the correction thread if the sales person is reassigned mid-loop? Old SP retains read access? | Yes, read-only forever (audit) | Admin |
| 25 | Maximum number of attached files per resubmission message | 5 | Operations |

---

## 21. UI direction

Use the existing **Tafsheen design system** (see [`apps/frontend/styles/THEME.md`](apps/frontend/styles/THEME.md) and [`ahsan.md`](ahsan.md)).

**Specific reuses:**

- **Finance Dashboard** → mirrors Sales Dashboard layout: `<PageHeader>` hero,
  `<MetricCard>` row of 6 KPIs, two-column body with focus list left + pipeline /
  trends right.
- **Intake Queue** → mirrors Sales Leads page: `<PageHeader>`, KPI strip,
  filter `<GlassCard>`, list of cards with hover lift.
- **Verification Detail** → uses `<DetailPageShell>` for left/right split.
  Receipt preview left, form right. Sticky `<ActionBar>` for the action buttons.
  Status badges via `<StatusBadge>`. Form fields via `<Field>` + `<FormInput>` /
  `<FormSelect>` / `<FormTextarea>`.
- **Correction request modal (Finance side)** → `<GlassCard variant="strong">`
  in a modal overlay. Reason picker as a chip cloud with multi-select.
  Required-action picker as a segmented control. Officer note as
  `<FormTextarea>` with min-length validation.
- **Correction thread view (both sides)** → full-width
  `<DetailPageShell>` with the conversation thread as the main column,
  case-summary card and SLA countdown card in the aside.
  - Each message rendered as a `<GlassCard variant="default">` styled by
    direction: finance messages tinted with `--sos-brand-primary-soft`,
    sales messages with `--sos-brand-accent-soft`, system events as
    plain `<GlassCard variant="soft">` with a `<StatusBadge tone="neutral">`.
  - Attached files inside a message → reuse the file-row component from
    Decisions screen.
  - Sticky composer at the bottom — `<FormTextarea>` + file upload +
    "Request correction" / "Resubmit to Finance" button (whichever side
    is currently on turn).
- **Correction inbox row (Sales side)** → reuse the existing `sos-row` /
  `<LeadCard>` style. Add a "→ awaiting sales" / "← awaiting finance"
  directional chip and a bounce-count badge.
- **Receipt PDF** → server-side render, NOT a webview. Use a separate template
  engine (suggest `react-pdf` or `puppeteer` + HTML template).

**New shared components to add to the kit** (in `components/finance-ui/`):

- `<MoneyValue amount currency baseCurrency />` — renders "CAD 1,500.00
  (≈ PKR 287,400)" with token-driven styling.
- `<PaymentMethodIcon method />` — bank / card / cash / etc.
- `<FraudFlagList flags onAcknowledge />` — list of fraud flags with
  acknowledge action.
- `<VerificationChecklist items />` — the 8 toggleable checks.
- `<ReceiptPreview file />` — pan/zoom file viewer.
- `<AuditTimeline entries />` — append-only log view (reuse Timeline).
- `<CorrectionThread thread messages currentUser />` — full conversation
  view with directional tinting, attachments, system events, composer.
  Used by both Finance and Sales correction screens.
- `<CorrectionRequestModal onSubmit />` — finance-side composer for raising
  a correction with reason tags, required-action picker, SLA selector.
- `<CorrectionResubmitForm onSubmit />` — sales-side composer with file
  upload + note + "Resubmit to Finance" button.
- `<DirectionalChip direction count />` — small chip showing
  "→ awaiting sales" / "← awaiting finance" + bounce count.
- `<SLACountdown dueAt status />` — live countdown with color-tone change
  when SLA is approaching or breached.

All theme via `--sos-*` tokens. No hardcoded colours, no per-screen one-off
styling. If you need a colour the kit doesn't have, add a token (§9 of
`ahsan.md`).

---

## 22. Phasing — what to build first

Build in 4 phases. Each phase is shippable on its own.

### Phase 1 — Core verification loop (3-4 weeks)

The minimum to replace manual finance work.

- Finance Dashboard (basic — 4 KPIs, no reconciliation)
- Intake Queue
- Verification Detail (no fraud rules, no maker-checker)
- Receipt Confirmation (PDF generation, email delivery)
- Send to Processing
- Payment History (basic)
- **Correction Required — full threaded conversation log** (this is core,
  not optional): same-sales-person routing, persistent thread per
  payment_record, append-only `correction_messages`, system events for
  reassignment/SLA-breach/resolution, both-sides UI screens, audit-log
  parity with the conversation log. The simple "send back with note"
  shortcut from your v1 brief is not enough — the threaded version is what
  actually keeps accountability when cases bounce 2-3 times.
- Status taxonomy
- Single currency only
- Single approver only

What's deferred: refunds, partial payments, reconciliation, fraud detection,
maker-checker, reports beyond basic.

### Phase 2 — Money safety nets (3-4 weeks)

- Fraud / duplicate detection rules
- Maker-checker for amounts above threshold
- Multi-currency (FX rate locking)
- Partial payments + `Awaiting Balance`
- On-hold queue
- Payment plan model
- Audit log surfaced in UI
- Notifications (in-app)

### Phase 3 — Money out (2-3 weeks)

- Refunds workflow (initiation, approval, execution)
- Discounts workflow
- Write-offs

### Phase 4 — Operational hygiene (3 weeks)

- Reconciliation (cash drawer + bank match)
- End-of-day close
- Full reports + exports
- Accounting export
- WhatsApp / email receipt delivery
- OCR-assist on receipt upload

### Phase 5 — Scale + automation (later)

- Bank API integration
- Direct accounting sync
- AML screening
- Client portal access

---

## Sign-off checklist

Before this design becomes a build:

- [ ] Finance Manager has read §1 (the gap analysis) and confirmed the v2
      additions are correct.
- [ ] All 20 `▸ DECIDE` items in §20 have a default agreed in writing.
- [ ] Backend lead has reviewed §7 (data model) and §17 (immutability rules).
- [ ] Sales lead has reviewed §5.6 (correction flow) — sales side has work too.
- [ ] Processing lead has reviewed §5.9 (handover) — processing side accepts the
      contract.
- [ ] Admin has reviewed §4 (permissions).
- [ ] Legal has reviewed §20 #7 and #17 (refund / non-refundability policy).
- [ ] Phase 1 (§22) scope is locked.
- [ ] Receipt template is signed off by Marketing + Finance.

Once signed off, build phase 1.

---

## Open questions list (consolidated for the next meeting)

If Tafsheen leadership wants to bring this back to a meeting, here's the
list ordered by impact:

1. Refund policy by stage — affects refund UI, accounting, legal exposure.
2. Maker-checker threshold — affects officer workflow and authority.
3. Processing start: full payment or deposit? — affects sales pitch and
   working capital.
4. Branches: how many today, planned expansion? — affects receipt numbering,
   reconciliation, reports.
5. Bank integration: feasibility per bank.
6. Tax / fee structure per service — affects receipts.
7. Notification channels: do we have WhatsApp Business API?
8. Sanctions / AML: regulatory requirement for immigration services?
9. Cash limit: above what amount is cash refused per policy?
10. Officer authority for rejections — single sign-off or peer review?

Bring all 10 to the next finance leadership sync. Each one decided saves a
week of build time.
