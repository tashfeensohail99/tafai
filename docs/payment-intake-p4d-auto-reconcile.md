# Payment Intake v2 — P4d: automatic payment reconciliation (feasibility + plan)

**Status:** design/feasibility only — **not built.** It is blocked on an
external business decision + a merchant/bank integration contract, not on code.
This document is what you need to green-light and unblock it.

**Context:** P4a–P4c are live. Today a bank-transfer consultation fee is
recorded as a `VisitorPayment` (`PENDING_REVIEW`), the customer uploads a
receipt via the desk QR (P4b), an AI reads it advisorily (P4c), and **a finance
officer manually verifies** it — which issues the receipt and confirms the
appointment. P4d's goal is to remove that manual step for the common case:
**confirm the payment automatically the moment the money actually arrives.**

---

## The honest constraint

"Reconcile against the bank" implies programmatic, trustworthy knowledge that
funds landed in the UBL receiving account (`PK33UNIL0109000368947164`). There
are only two ways to get that, and both need something we cannot self-provision:

1. **Read the bank account directly** (host-to-host / corporate API / open
   banking). Pakistan has **no consumer open-banking standard**, and UBL's
   corporate host-to-host statement/transaction feed requires a **signed
   corporate integration agreement + onboarding** with the bank. It is not a
   self-serve API key. Even once live, matching a raw incoming credit to a
   specific pending consultation is fuzzy (the payer's narration rarely carries
   our reference), so it still needs a matching heuristic + a human exception
   queue.

2. **Put a payment processor in the middle** (PSP / aggregator hosted
   checkout). The customer pays through a link/checkout we control; the PSP
   fires a **signed webhook** on success that we trust and auto-verify. This is
   the standard, achievable path and it is **strictly better** than raw bank
   reconciliation for our use case: the payment is tied to *our* order id from
   the start, so there is no fuzzy matching.

**Recommendation: do P4d as the PSP path, not raw bank-API reconciliation.**
It also subsumes the separate "online-pay link" backlog item — one build gives
both online payment *and* auto-confirmation.

What is still blocked on you (cannot be done in code by an agent):

- **Pick a PSP** and **open a merchant account** (a business/legal step).
  Pakistan options that do hosted checkout + webhooks: **Safepay**, **PayFast
  (APPS)**, **JazzCash Business**, **Easypaisa/Telenor Microfinance**, or an
  international gateway if you invoice in USD/CAD (Stripe is not available to PK
  merchants for local acquiring).
- Provide the **merchant API keys** — you enter them yourself in
  **Admin → API Keys** (encrypted at rest; an agent must never handle payment
  credentials).

Once those exist, the code below is a small, well-scoped build that reuses the
P4a state machine end to end.

---

## Recommended architecture (PSP hosted-checkout → webhook → auto-verify)

Everything hangs off the existing `VisitorPayment` row, so no parallel money
path is introduced.

```
Desk records a bank/online consult fee
        │
        ├─ VisitorPayment PENDING_REVIEW  (as today)
        │
        ├─ NEW: create a PSP checkout for amount+currency, orderId = visitorPaymentId
        │        → store pspOrderId + a hosted payUrl on the row
        │
        └─ Show/send the payUrl (the P4b QR can point here instead of the
           receipt-upload page, or in addition to it)

Customer pays on the PSP hosted page
        │
PSP → POST /public/psp/webhook   (signature-verified, no auth guard)
        │
        ├─ verify HMAC/signature with the merchant secret
        ├─ look up VisitorPayment by pspOrderId
        ├─ if event = PAID and row still PENDING_REVIEW:
        │     call the EXISTING finalizeVisitorPayment(...) chain
        │       → invoice → payment → receipt → CONFIRM slot → WhatsApp confirm
        │     stamp visit paid ONLY on full success (unchanged P4a invariant)
        └─ if event = FAILED/EXPIRED: leave PENDING_REVIEW (finance/desk handles)
```

Key point: **the webhook does exactly what a finance officer's "Verify" click
does today** — it calls the same `finalizeVisitorPayment` chain, so all the
P4a hardening (transient `VERIFYING` state, resume-safe invoice/payment anchored
on the row, no double-charge, receipt recovery) is inherited for free. Manual
verify stays as the fallback for cash and for transfers done outside the link.

### What to build (small, ~1 PR once a PSP is chosen)

- **Schema (additive):** `VisitorPayment.pspProvider?`, `pspOrderId? @unique`,
  `pspStatus?`, `payUrl?`. Nullable columns; migration mirrors the P4c one.
- **`PspService`** (per provider): `createCheckout({ amount, currency, orderId,
  customer })` → `{ payUrl, pspOrderId }`; `verifyWebhook(rawBody, signature)`
  → typed event. Loads the merchant key from `ApiKeysService.getActiveKey(
  '<psp>')` — same pattern as the OpenAI key, rotatable from Admin → API Keys.
- **Public webhook controller** `POST /public/psp/webhook` — **no auth guard**
  (mirror `PublicConsultPayController` / `PublicDownloadsController`), but
  **signature-verified**, `@UseGuards(ThrottlerGuard)`, and **idempotent** on
  `pspOrderId` + event id (a PSP retries webhooks — verifying twice must be a
  no-op, which the existing `PENDING_REVIEW → VERIFYING` CAS already gives us).
- **Reception wiring:** on collect for an online/bank method, call
  `createCheckout` and store `payUrl`/`pspOrderId`; expose `payUrl` so the desk
  QR (P4b) and/or a WhatsApp message can send it.
- **Frontend:** show the pay link/QR at the desk; the finance Visitor-Payments
  row shows a "paid online — auto-verified" state instead of the manual buttons
  once the webhook lands.

### Non-negotiable review gates (money code)

- Webhook **signature verification is mandatory** before trusting any event —
  an unauthenticated `/public/psp/webhook` that skips it would let anyone
  auto-confirm a payment. Constant-time compare, reject on mismatch.
- **Idempotency** on `pspOrderId` + event id (PSPs deliver at-least-once).
- **Amount/currency check**: confirm the PSP-reported paid amount matches the
  `VisitorPayment.amount`/`currency` before finalizing (never trust the event's
  amount blindly; never finalize a short payment).
- Keep the **manual verify** path — it's the fallback and the audit control.
- Adversarial review before ship, same as P4a/P4b/P4c.

---

## Why not "just read the UBL account"

- No PK open-banking standard; UBL host-to-host is a **contracted corporate
  integration**, weeks of bank onboarding, not an API key.
- Raw credits carry **no order reference** → fuzzy matching (amount + time +
  payer name) → false matches on identical fees → still needs a human exception
  queue. The PSP path eliminates this by binding the payment to `orderId` up
  front.
- If you *do* later get a UBL transaction feed, it can be added as a **second
  reconciliation source** feeding the same webhook-style `finalize` path
  (poll → match by our reference in the narration → finalize), but it should
  not be the primary mechanism.

## Decision checklist to unblock P4d

1. Confirm the goal: auto-confirm on payment (yes) vs. only online-pay-link
   without auto-verify (smaller).
2. Choose a PSP (recommend Safepay or PayFast for PKR hosted checkout; an
   international gateway only if you collect in USD/CAD).
3. Open the merchant account; obtain sandbox + live API keys.
4. Enter the keys in **Admin → API Keys** (you, not an agent).
5. Then the ~1-PR build above is straightforward and low-risk (it rides the P4a
   chain).

Until step 2–4 happen, P4d cannot be built — and shipping a stub "bank
integration" with no real acquirer would be misleading, so it is deliberately
left as this plan.
