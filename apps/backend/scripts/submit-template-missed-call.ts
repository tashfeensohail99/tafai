/**
 * ONE-OFF: submit the `missed_call_callback` UTILITY template to Meta.
 *
 * Sent by the webhook ingest when an inbound call is MISSED and the 24h
 * messaging window is CLOSED (a call does not open one) — 43% of missed
 * callers previously got no follow-up at all. UTILITY: it's a direct,
 * transactional follow-up to the customer's OWN just-made call, not marketing.
 *
 * Copy mirrors the free-form invite the open-window path already sends
 * (Mon–Sat 9 AM–6 PM PKT), minus emoji (template review is stricter).
 *
 * Same mechanism as submit-templates-reception-consult.ts: reuse the ACTIVE
 * prod channel's encrypted token, idempotent (skips if the name already
 * exists), DRY_RUN=1 to preview only. The webhook code degrades gracefully
 * until this is APPROVED + synced, so submit any time.
 *
 *   railway run --service backend npx ts-node --transpile-only scripts/submit-template-missed-call.ts
 *   DRY_RUN=1 railway run --service backend ... (preview payload, no submit)
 */
import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'node:crypto';
import axios, { AxiosError } from 'axios';

const prisma = new PrismaClient();

const TEMPLATE = {
  name: 'missed_call_callback',
  language: 'en',
  category: 'UTILITY' as const,
  bodyText:
    'Hi {{1}}, sorry we just missed your call at Tashfeen Immigration Solutions. ' +
    'Reply here with a day and time that suits you and we will arrange a callback for you. ' +
    'We are available Monday to Saturday, 9 AM to 6 PM (Pakistan time).',
  sample: ['Ahmed'],
};

function decryptToken(payload: string, keyHex: string): string {
  const [ivB64, dataB64, tagB64] = payload.split(':');
  if (!tagB64) throw new Error('Invalid ciphertext format on accessTokenEnc');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
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

  // Idempotency: skip if any template with this name already exists.
  try {
    const list = await axios.get<{ data: Array<{ name: string; language: string; status: string; category: string }> }>(
      `${base}/${channel.wabaId}/message_templates`,
      { params: { name: TEMPLATE.name, fields: 'name,language,status,category', limit: 50 }, headers: auth, timeout: 15000 },
    );
    const existing = (list.data.data ?? []).filter((x) => x.name === TEMPLATE.name);
    if (existing.length > 0) {
      console.log('⚠️  Already exists — NOT re-submitting:');
      for (const x of existing) console.log(`   ${x.name} [${x.language}] → status=${x.status}, category=${x.category}`);
      return;
    }
  } catch (e) {
    const err = e as AxiosError<{ error?: { message?: string } }>;
    console.warn(`(pre-check failed: ${err.response?.data?.error?.message ?? err.message} — continuing)`);
  }

  const payload = {
    name: TEMPLATE.name,
    language: TEMPLATE.language,
    category: TEMPLATE.category,
    components: [{ type: 'BODY', text: TEMPLATE.bodyText, example: { body_text: [TEMPLATE.sample] } }],
  };
  console.log('Payload:\n' + JSON.stringify(payload, null, 2));

  if (dryRun) {
    console.log('DRY_RUN=1 → not submitting.');
    return;
  }

  try {
    const res = await axios.post<{ id?: string; status?: string; category?: string }>(
      `${base}/${channel.wabaId}/message_templates`,
      payload,
      { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 20000 },
    );
    console.log(`✅ SUBMITTED  id=${res.data.id ?? '(none)'} status=${res.data.status ?? '(pending)'} category=${res.data.category ?? TEMPLATE.category}`);
    console.log('NOTE: the invite auto-activates once the template is APPROVED and the channel template sync has run.');
  } catch (e) {
    const err = e as AxiosError<{ error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } }>;
    const d = err.response?.data?.error;
    console.error(`❌ Submit FAILED  HTTP ${err.response?.status ?? '??'} code=${d?.code ?? '?'} subcode=${d?.error_subcode ?? '?'}`);
    console.error(`   ${d?.error_user_msg ?? d?.message ?? err.message}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
