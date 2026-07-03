/**
 * ONE-OFF: submit the reception PAID-CONSULTATION UTILITY templates to Meta.
 *
 * These cover the paid-consult lifecycle that had no template (the existing
 * approved set — appointment_reminder / document_request /
 * finance_consultation_today / reengage_personal — does not):
 *   1. consultation_confirmed        — slot confirmed after payment
 *   2. consultation_payment_received — bank transfer received, verifying
 *   3. consultation_no_show          — missed the appointment, rebook
 *   4. consultation_payment_reminder — pending payment, complete via /pay link
 *
 * All UTILITY (each is tied to a specific booked consultation / payment).
 * Same mechanism as submit-template-consultation-confirmation.ts: reuse the
 * ACTIVE prod channel's encrypted token, idempotent (skips a template whose
 * name already exists), DRY_RUN=1 to preview only. Read-only on our DB; the
 * only writes are the create calls to Meta.
 *
 *   railway run --service backend npx ts-node --transpile-only scripts/submit-templates-reception-consult.ts
 *   DRY_RUN=1 railway run --service backend ... (preview payloads, no submit)
 *   ONLY=consultation_no_show ... (submit just one)
 */
import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'node:crypto';
import axios, { AxiosError } from 'axios';

const prisma = new PrismaClient();

type Tpl = {
  name: string;
  language: string;
  category: 'UTILITY';
  bodyText: string;
  /** One value per body {{n}} variable — Meta requires examples. */
  sample: string[];
  /** Optional dynamic URL button (a variable suffix on a fixed base). */
  button?: { text: string; urlWithVar: string; urlExample: string };
};

const TEMPLATES: Tpl[] = [
  {
    name: 'consultation_confirmed',
    language: 'en',
    category: 'UTILITY',
    bodyText:
      'Hi {{1}}, your paid consultation with Tashfeen Immigration Solutions is confirmed for {{2}}. Your payment of {{3}} has been received. Please arrive 10 minutes early. Reply RESCHEDULE if you need a different time.',
    sample: ['Ahmed', '28 June 2026, 3:00 PM with Mr. Tashfeen', 'PKR 5,000'],
  },
  {
    name: 'consultation_payment_received',
    language: 'en',
    category: 'UTILITY',
    bodyText:
      'Hi {{1}}, we have received your payment of {{2}} for your consultation with Tashfeen Immigration Solutions and are verifying it. We will confirm your appointment for {{3}} shortly. Thank you.',
    sample: ['Ahmed', 'PKR 5,000', '28 June 2026, 3:00 PM'],
  },
  {
    name: 'consultation_no_show',
    language: 'en',
    category: 'UTILITY',
    bodyText:
      'Hi {{1}}, we missed you at your scheduled consultation on {{2}} with Tashfeen Immigration Solutions. Would you like to rebook? Reply here and we will arrange a new time that suits you.',
    sample: ['Ahmed', '28 June 2026, 3:00 PM'],
  },
  {
    name: 'consultation_payment_reminder',
    language: 'en',
    category: 'UTILITY',
    bodyText:
      'Hi {{1}}, your consultation slot for {{2}} is being held. To confirm it, please complete your payment of {{3}} and upload your receipt using the button below. Your slot will be released if payment is not received.',
    sample: ['Ahmed', '28 June 2026, 3:00 PM', 'PKR 5,000'],
    button: {
      text: 'Complete payment',
      urlWithVar: 'https://tashfeengroup.com/pay/{{1}}',
      urlExample: 'https://tashfeengroup.com/pay/abcd1234',
    },
  },
];

function decryptToken(payload: string, keyHex: string): string {
  const [ivB64, dataB64, tagB64] = payload.split(':');
  if (!tagB64) throw new Error('Invalid ciphertext format on accessTokenEnc');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function buildComponents(t: Tpl): unknown[] {
  const components: unknown[] = [
    { type: 'BODY', text: t.bodyText, example: { body_text: [t.sample] } },
  ];
  if (t.button) {
    components.push({
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: t.button.text, url: t.button.urlWithVar, example: [t.button.urlExample] },
      ],
    });
  }
  return components;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const only = process.env.ONLY?.trim();
  const keyHex = process.env.WHATSAPP_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('WHATSAPP_ENCRYPTION_KEY missing/invalid. Run via `railway run`.');
  const version = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, label: true, wabaId: true, displayNumber: true, accessTokenEnc: true },
  });
  if (!channel) throw new Error('No ACTIVE channel found.');
  console.log(`Channel: ${channel.label} (${channel.displayNumber})  wabaId=${channel.wabaId}`);
  const token = decryptToken(channel.accessTokenEnc, keyHex);

  const base = `https://graph.facebook.com/${version}`;
  const auth = { Authorization: `Bearer ${token}` };
  const queue = only ? TEMPLATES.filter((t) => t.name === only) : TEMPLATES;
  if (only && queue.length === 0) throw new Error(`ONLY=${only} matched no template.`);

  for (const t of queue) {
    console.log(`\n──────────── ${t.name} [${t.category}] ────────────`);

    // idempotency
    try {
      const list = await axios.get<{ data: Array<{ name: string; language: string; status: string; category: string }> }>(
        `${base}/${channel.wabaId}/message_templates`,
        { params: { name: t.name, fields: 'name,language,status,category', limit: 50 }, headers: auth, timeout: 15000 },
      );
      const existing = (list.data.data ?? []).filter((x) => x.name === t.name);
      if (existing.length > 0) {
        console.log('⚠️  Already exists — NOT re-submitting:');
        for (const x of existing) console.log(`   ${x.name} [${x.language}] → status=${x.status}, category=${x.category}`);
        continue;
      }
    } catch (e) {
      const err = e as AxiosError<{ error?: { message?: string } }>;
      console.warn(`(pre-check failed: ${err.response?.data?.error?.message ?? err.message} — continuing)`);
    }

    const payload = { name: t.name, language: t.language, category: t.category, components: buildComponents(t) };
    console.log('Payload:\n' + JSON.stringify(payload, null, 2));

    if (dryRun) {
      console.log('DRY_RUN=1 → not submitting.');
      continue;
    }

    try {
      const res = await axios.post<{ id?: string; status?: string; category?: string }>(
        `${base}/${channel.wabaId}/message_templates`,
        payload,
        { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 20000 },
      );
      console.log(`✅ SUBMITTED  id=${res.data.id ?? '(none)'} status=${res.data.status ?? '(pending)'} category=${res.data.category ?? t.category}`);
    } catch (e) {
      const err = e as AxiosError<{ error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } }>;
      const d = err.response?.data?.error;
      console.error(`❌ Submit FAILED  HTTP ${err.response?.status ?? '??'} code=${d?.code ?? '?'} subcode=${d?.error_subcode ?? '?'}`);
      console.error(`   message: ${d?.error_user_msg ?? d?.message ?? err.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
