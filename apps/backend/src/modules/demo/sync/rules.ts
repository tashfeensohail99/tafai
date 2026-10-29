/**
 * Which production tables the demo mirror copies, in foreign-key order, and
 * how every sensitive column is masked. Anything text-like that is not listed
 * here still goes through the generic scrubber in the engine.
 *
 * Tables deliberately NOT copied (never needed by the demo UI, or too
 * identity-dense to be worth masking): audit logs, login sessions, password
 * reset tokens, device tokens, webhook events, API keys, system alerts, lead
 * import batches/rows, Meta lead-form submissions, agreements, HR / payroll /
 * attendance / face tables, the databank, judicial-review, processing
 * documents + versions, and every `public.*` legacy table.
 */
import type { ColumnRule, PeopleDirectory, Row, TableRule } from './types';
import { DemoMasker } from '../masking';

const keep: ColumnRule = { kind: 'keep' };
const nul: ColumnRule = { kind: 'null' };
const text: ColumnRule = { kind: 'text' };
const json: ColumnRule = { kind: 'json' };
const phone: ColumnRule = { kind: 'phone' };
const email: ColumnRule = { kind: 'email' };
const media: ColumnRule = { kind: 'media' };
const secret: ColumnRule = { kind: 'secret' };
const fileName: ColumnRule = { kind: 'fileName' };
const adReferral: ColumnRule = { kind: 'fn', fn: (v, _r, ctx) => (v == null ? null : ctx.masker.scrubAdReferral(v, { names: ctx.names })) };

/**
 * A valid bcrypt hash (cost 12) of a 32-byte random string that was thrown
 * away. Every synced account gets it, so nobody can log into the demo with a
 * production password; bcrypt.compare() simply returns false.
 */
export const LOCKED_PASSWORD_HASH = '$2b$12$lycvZzLDik2U82v/0dfIKeHw7IjKd/aaI0EWZkIMY5gxBKyue9tlC';

/** Stable, non-colliding replacement for Meta wamids (unique columns). */
const wamid: ColumnRule = {
  kind: 'fn',
  fn: (v, _row, ctx) => (v == null ? null : `wamid.demo${ctx.masker.hex('wamid', String(v), 32)}`),
};

/** Live-lane rows are never pruned: anything hanging off a live channel. */
const LIVE_CHANNEL_IDS = `SELECT id FROM whatsapp.channels WHERE "phoneNumberId" = ANY($1::text[])`;
const LIVE_LEAD_IDS = `SELECT "leadId" FROM whatsapp.threads WHERE "leadId" IS NOT NULL AND "channelId" IN (${LIVE_CHANNEL_IDS})`;

const staffByUserId = (row: Row, people: PeopleDirectory) => people.users.get(String(row.userId ?? row.id)) ?? null;
const staffByEmployeeId = (col: string) => (row: Row, people: PeopleDirectory) => {
  const userId = people.employeeUser.get(String(row[col] ?? ''));
  return userId ? people.users.get(userId) ?? null : null;
};

export const DEMO_SYNC_RULES: TableRule[] = [
  // ── core reference data ────────────────────────────────────────────────
  {
    table: 'core.organizations',
    mode: 'full',
    prune: false,
    columns: {
      name: { kind: 'fn', fn: (_v, _r, ctx) => ctx.masker.cfg.brandName },
      legalName: { kind: 'fn', fn: (v, _r, ctx) => (v == null ? null : `${ctx.masker.cfg.brandName} (Pvt) Ltd`) },
      email: { kind: 'fn', fn: (v, _r, ctx) => (v == null ? null : `info@${ctx.masker.cfg.emailDomain}`) },
      phone,
      address: { kind: 'address' },
      logoUrl: nul,
      autoAckTemplate: text,
      afterHoursTemplate: text,
      consultationBankIban: { kind: 'fn', fn: (v, _r, ctx) => (v == null ? null : `PK00DEMO${ctx.masker.digits('iban', String(v), 16)}`) },
      consultationBankName: { kind: 'fn', fn: (v) => (v == null ? null : 'Demo Bank Ltd') },
      consultationBankTitle: { kind: 'fn', fn: (v, _r, ctx) => (v == null ? null : ctx.masker.cfg.brandName) },
      // The live lane needs the assistant ON whatever production's switch says.
      botMode: { kind: 'const', value: 'AUTO' },
      botEnabledAt: { kind: 'fn', fn: (v) => v ?? '2026-01-01 00:00:00' },
    },
  },
  { table: 'core.branches', mode: 'full', columns: { phone, email, name: text } },
  { table: 'core.departments', mode: 'full', columns: {} },
  { table: 'core.designations', mode: 'full', columns: {} },
  { table: 'core.services', mode: 'full', columns: {} },
  { table: 'core.countries', mode: 'full', columns: {} },
  { table: 'core.roles', mode: 'full', columns: {} },
  { table: 'core.permissions', mode: 'full', columns: {} },
  { table: 'core.role_permissions', mode: 'full', columns: {} },

  // ── staff ──────────────────────────────────────────────────────────────
  {
    table: 'core.user_accounts',
    mode: 'full',
    staff: staffByUserId,
    pruneExcludeSql: `t.id = ANY($2::text[])`,
    columns: {
      email: { kind: 'staffEmail' },
      phone,
      passwordHash: { kind: 'const', value: LOCKED_PASSWORD_HASH },
      twoFactorEnabled: { kind: 'const', value: false },
      twoFactorSecret: nul,
      emailSignature: text,
      failedLoginAttempts: { kind: 'const', value: 0 },
      lockedUntil: nul,
      mustChangePassword: { kind: 'const', value: false },
    },
  },
  { table: 'core.user_roles', mode: 'full', pruneExcludeSql: `t."userId" = ANY($2::text[])`, columns: {} },
  {
    table: 'core.employees',
    mode: 'full',
    staff: staffByUserId,
    pruneExcludeSql: `t."userId" = ANY($2::text[])`,
    columns: {
      firstName: { kind: 'firstName' },
      lastName: { kind: 'lastName' },
      dateOfBirth: { kind: 'dob' },
      nationalId: { kind: 'nationalId' },
      passportNumber: { kind: 'passport' },
      profilePhotoKey: nul,
      employeeCode: keep,
      pbxExtension: keep,
      // Park every synced rep OFFLINE (and locked) so new live-lane chats
      // round-robin to the demo agent account, which is the only one online.
      presenceStatus: { kind: 'const', value: 'OFFLINE' },
      presenceLocked: { kind: 'const', value: true },
      lastActivityAt: nul,
    },
  },
  {
    table: 'core.partners',
    mode: 'full',
    columns: {
      companyName: { kind: 'company' },
      contactName: { kind: 'fullName' },
      email,
      phone,
      notes: text,
      referralCode: keep,
    },
  },

  // ── WhatsApp channels / templates / campaigns ──────────────────────────
  {
    table: 'whatsapp.channels',
    mode: 'full',
    pruneExcludeSql: `t."phoneNumberId" = ANY($1::text[])`,
    columns: {
      label: text,
      displayNumber: phone,
      // Never copy the production Meta token. The demo factory refuses to
      // decrypt this marker and returns a blocked client for the channel.
      accessTokenEnc: { kind: 'const', value: 'demo:blocked' },
      webhookVerifyToken: nul,
      wabaId: keep,
      phoneNumberId: keep,
      pageId: keep,
    },
  },
  { table: 'whatsapp.templates', mode: 'full', columns: { components: json, name: keep, rejectedReason: text } },
  {
    table: 'whatsapp.campaigns',
    mode: 'full',
    columns: {
      name: text,
      description: text,
      variableMap: json,
      // A campaign mid-send in prod must not start blasting in the demo.
      status: { kind: 'fn', fn: (v) => (v === 'SENDING' || v === 'SCHEDULED' ? 'PAUSED' : v) },
    },
  },

  // ── leads / clients ────────────────────────────────────────────────────
  {
    table: 'crm.leads',
    mode: 'full',
    person: (row, people) => people.leads.get(String(row.id)) ?? null,
    pruneExcludeSql: `t.id IN (${LIVE_LEAD_IDS})`,
    columns: {
      firstName: { kind: 'firstName' },
      lastName: { kind: 'lastName' },
      email,
      phone,
      alternatePhone: phone,
      notes: text,
      lostReason: text,
      blockedReason: text,
      emailVerificationToken: nul,
      metaLeadId: secret,
      ctwaClid: secret,
      referenceCode: keep,
      metaAdName: keep,
      metaAdsetName: keep,
      metaCampaignName: keep,
      sourceChannel: keep,
      serviceInterest: keep,
      targetCountry: keep,
      nationality: keep,
    },
  },
  {
    table: 'crm.clients',
    mode: 'full',
    person: (row, people) => people.clients.get(String(row.id)) ?? null,
    columns: {
      firstName: { kind: 'firstName' },
      lastName: { kind: 'lastName' },
      email,
      phone,
      alternatePhone: phone,
      dateOfBirth: { kind: 'dob' },
      passportNumber: { kind: 'passport' },
      nationalId: { kind: 'nationalId' },
      cnic: { kind: 'cnic' },
      address: { kind: 'address' },
      blockedReason: text,
      referenceCode: keep,
      serviceType: keep,
      targetCountry: keep,
      nationality: keep,
    },
  },
  { table: 'crm.follow_ups', mode: 'full', pruneExcludeSql: `t."leadId" IN (${LIVE_LEAD_IDS})`, columns: { title: text, description: text, outcomeNotes: text } },
  { table: 'crm.lead_disposition_history', mode: 'full', pruneExcludeSql: `t."leadId" IN (${LIVE_LEAD_IDS})`, columns: { note: text } },
  { table: 'crm.lead_files', mode: 'full', columns: { fileName, fileKey: media } },
  { table: 'processing.cases', mode: 'full', columns: { notes: text, decisionNotes: text, caseNumber: keep } },
  {
    table: 'crm.appointments',
    mode: 'full',
    pruneExcludeSql: `t."leadId" IN (${LIVE_LEAD_IDS})`,
    columns: { title: text, location: text, notes: text, cancellationReason: text, meetingLink: nul },
  },
  { table: 'crm.appointment_requests', mode: 'full', pruneExcludeSql: `t."leadId" IN (${LIVE_LEAD_IDS})`, columns: { rawText: text } },
  { table: 'crm.reminder_jobs', mode: 'full', prune: false, columns: { title: text, body: text, lastError: text, dedupeKey: keep, link: keep } },

  // ── WhatsApp conversations ─────────────────────────────────────────────
  {
    table: 'whatsapp.threads',
    mode: 'full',
    pruneExcludeSql: `t."channelId" IN (${LIVE_CHANNEL_IDS})`,
    columns: {
      waContactId: {
        kind: 'fn',
        fn: (v, row, ctx) => {
          if (v == null) return null;
          // Messenger / Instagram ids are opaque PSIDs → hash; WhatsApp → fake phone.
          if (row.platform && row.platform !== 'WHATSAPP') return ctx.masker.digits('psid', String(v), String(v).length || 16);
          return ctx.masker.waId(String(v));
        },
      },
      lastMessagePreview: text,
      adReferral,
      aiSummary: json,
      aiState: keep,
      aiSummaryThroughMessageId: keep,
    },
  },
  { table: 'whatsapp.thread_pins', mode: 'full', columns: {} },
  {
    table: 'whatsapp.messages',
    mode: 'incremental',
    fetchSize: 2000,
    batchSize: 300,
    pruneExcludeSql: `t."channelId" IN (${LIVE_CHANNEL_IDS})`,
    columns: {
      body: text,
      payload: { kind: 'messagePayload' },
      mediaUrl: media,
      mediaSha256: nul,
      waMessageId: wamid,
      repliedToWaMessageId: wamid,
      idempotencyKey: secret,
      errorTitle: text,
      errorDetails: json,
      adReferral,
      templateName: keep,
      templateLanguage: keep,
      pricingCategory: keep,
      errorCode: keep,
    },
  },
  {
    table: 'whatsapp.calls',
    mode: 'incremental',
    pruneExcludeSql: `t."channelId" IN (${LIVE_CHANNEL_IDS})`,
    columns: {
      waCallId: secret,
      sdpOffer: nul,
      sdpAnswer: nul,
      recordingKey: media,
      transcript: text,
      endReason: keep,
      event: keep,
    },
  },
  { table: 'whatsapp.opt_outs', mode: 'full', prune: false, columns: { waId: { kind: 'waId' }, reason: text } },
  { table: 'whatsapp.daily_report_log', mode: 'full', columns: {} },

  // ── AI ─────────────────────────────────────────────────────────────────
  {
    table: 'ai.knowledge',
    mode: 'full',
    columns: { queryEn: text, queryUr: text, answerEn: text, answerUr: text, sourceFile: keep, embedding: keep },
  },
  { table: 'ai.brochures', mode: 'full', columns: { s3Key: media, displayTitle: text } },
  { table: 'ai.runs', mode: 'incremental', watermarkColumn: 'createdAt', prune: false, columns: { error: text, skipReason: keep, model: keep, mode: keep } },

  // ── activity / notifications ───────────────────────────────────────────
  { table: 'core.notifications', mode: 'incremental', watermarkColumn: 'createdAt', prune: false, columns: { title: text, body: text, link: keep, type: keep } },
  {
    table: 'crm.activity_timeline',
    mode: 'incremental',
    watermarkColumn: 'createdAt',
    prune: false,
    columns: { description: text, metadata: json, entityType: keep, entityId: keep },
  },

  // ── reception / telephony / email ──────────────────────────────────────
  {
    table: 'crm.visits',
    mode: 'full',
    columns: { name: { kind: 'fullName' }, phone, purpose: text, notes: text },
  },
  {
    table: 'crm.visitor_payments',
    mode: 'full',
    columns: {
      transactionRef: secret,
      proofImageKey: media,
      ocrReference: secret,
      ocrRawText: { kind: 'fn', fn: (v) => (v == null ? null : '[bank slip text removed for demo]') },
      rejectedReason: text,
      receiptNumber: keep,
    },
  },
  {
    table: 'crm.incoming_emails',
    mode: 'full',
    columns: {
      messageId: secret,
      fromAddress: email,
      fromName: { kind: 'fullName' },
      toAddress: { kind: 'fn', fn: (v, _r, ctx) => (v == null ? null : `inbox@${ctx.masker.cfg.emailDomain}`) },
      subject: text,
      bodyText: text,
      bodyHtml: text,
    },
  },
  {
    table: 'crm.smart_office_call_logs',
    mode: 'full',
    staff: staffByEmployeeId('agentEmployeeId'),
    columns: {
      callerE164: phone,
      callerRaw: phone,
      masterNumber: phone,
      callId: secret,
      reason: text,
      agentName: { kind: 'fn', fn: (v, _r, ctx) => (v == null ? null : ctx.staff?.fake ? `${ctx.staff.fake.firstName} ${ctx.staff.fake.lastName}` : ctx.masker.scrubText(String(v), { names: ctx.names })) },
      agentExtension: keep,
    },
  },
  { table: 'crm.quick_replies', mode: 'full', columns: { title: text, body: text } },

  // ── finance (dashboards) ───────────────────────────────────────────────
  { table: 'finance.document_sequences', mode: 'full', columns: {} },
  {
    table: 'finance.service_contracts',
    mode: 'full',
    columns: { notes: text, agreementFileName: fileName, agreementKey: media, contractNumber: keep },
  },
  { table: 'finance.installments', mode: 'full', columns: {} },
  { table: 'finance.invoices', mode: 'full', columns: { notes: text, invoiceNumber: keep } },
  { table: 'finance.payments', mode: 'full', columns: { transactionRef: secret, notes: text, internalReference: secret, receiptKey: media } },
  { table: 'finance.receipts', mode: 'full', columns: { transactionRef: secret, voidReason: text, pdfStorageKey: media, receiptNumber: keep } },
  { table: 'finance.credit_notes', mode: 'full', columns: { reason: text, creditNoteNumber: keep } },
  {
    table: 'finance.finance_handovers',
    mode: 'full',
    columns: { transactionRef: secret, notes: text, financeNotes: text, receiptKey: media, receiptFileName: fileName },
  },
  { table: 'finance.finance_proofs', mode: 'full', columns: { fileName, storageKey: media } },
  { table: 'finance.expenses', mode: 'full', columns: { description: text, receiptKey: media, receiptFileName: fileName } },

  // ── processing pipeline (dashboards only; no documents) ────────────────
  {
    table: 'processing.processing_cases',
    mode: 'full',
    columns: {
      authorityTrackingRef: secret,
      externalRef: secret,
      financeHandoverNote: text,
      processingNote: text,
      paymentPlanNote: text,
      cancellationReason: text,
      submissionPackageKey: media,
    },
  },
  { table: 'processing.processing_case_stage_history', mode: 'full', columns: { reason: text, notes: text, gateCheckResult: json } },
  { table: 'processing.case_milestones', mode: 'full', columns: {} },
  { table: 'processing.processing_tasks', mode: 'full', columns: { title: text, description: text } },

  // ── marketing (no PII) ─────────────────────────────────────────────────
  { table: 'crm.meta_campaigns', mode: 'full', columns: {} },
  { table: 'crm.meta_ad_sets', mode: 'full', columns: {} },
  { table: 'crm.meta_ads', mode: 'full', columns: {} },
  { table: 'crm.ad_spend_daily', mode: 'full', columns: {} },
  { table: 'crm.ad_routing_rules', mode: 'full', columns: {} },
  { table: 'crm.routing_cursors', mode: 'full', columns: {} },
];

export const DEMO_MEDIA_PLACEHOLDER = DemoMasker.MEDIA_PLACEHOLDER;

/** Tables the sync touches, for the leak checker and docs. */
export const DEMO_SYNC_TABLES = DEMO_SYNC_RULES.map((r) => r.table);
