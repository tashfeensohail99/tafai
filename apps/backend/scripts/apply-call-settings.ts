/**
 * ONE-OFF (re-runnable): apply the WhatsApp Calling settings on the business
 * number via POST /{phone_number_id}/settings — two upgrades the number's
 * bootstrap (calling: ENABLED + call icon) never set:
 *
 *  1. callback_permission_status=ENABLED — after a missed/ended user-initiated
 *     call, META ITSELF prompts the customer "can the business call you back?".
 *     Grants arrive on our already-live `call_permission_reply` webhook with
 *     response_source='automatic' — converting every miss into a legal
 *     outbound-callback opportunity with zero extra sends from us.
 *
 *  2. call_hours — business hours Mon–Sat 09:00–18:00 Asia/Karachi (matches the
 *     missed-call invite copy). Outside these hours Meta hides/disables the
 *     call button, so off-hours callers are steered to MESSAGE instead of
 *     producing an unanswerable missed call (off-hours ≈45% of all misses).
 *
 * Reads current settings first, prints them, POSTs the merged calling block,
 * then GETs again to verify. DRY_RUN=1 to preview without writing.
 *
 *   railway run --service backend npx ts-node --transpile-only scripts/apply-call-settings.ts
 *   DRY_RUN=1 railway run --service backend ... (show current + intended, no write)
 *
 * Voicemail (alpha): NOT set here — it needs Meta alpha access + an uploaded
 * OGG/Opus announcement (use_case=call_voicemail_announcement). Request access
 * in the Meta App Dashboard first; wiring it is a follow-up once granted.
 */
import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'node:crypto';
import axios, { AxiosError } from 'axios';

const prisma = new PrismaClient();

function decryptToken(payload: string, keyHex: string): string {
  const [ivB64, dataB64, tagB64] = payload.split(':');
  if (!tagB64) throw new Error('Invalid ciphertext format on accessTokenEnc');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

const WORK_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;

// The full calling block we want live. POSTing the complete object (rather
// than a partial patch) keeps the result deterministic regardless of what was
// set before; values mirror the current bootstrap for the untouched keys.
const CALLING_SETTINGS = {
  status: 'ENABLED',
  call_icon_visibility: 'DEFAULT',
  callback_permission_status: 'ENABLED',
  call_hours: {
    status: 'ENABLED',
    timezone_id: 'Asia/Karachi',
    weekly_operating_hours: WORK_DAYS.map((day) => ({
      day_of_week: day,
      open_time: '0900',
      close_time: '1800',
    })),
    holiday_schedule: [],
  },
};

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const keyHex = process.env.WHATSAPP_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error('WHATSAPP_ENCRYPTION_KEY missing/invalid. Run via `railway run`.');
  const version = process.env.META_GRAPH_API_VERSION ?? 'v21.0';

  const channel = await prisma.whatsAppChannel.findFirst({
    where: { status: 'ACTIVE' },
    select: { id: true, label: true, phoneNumberId: true, displayNumber: true, accessTokenEnc: true },
  });
  if (!channel) throw new Error('No ACTIVE channel found.');
  console.log(`Channel: ${channel.label} (${channel.displayNumber})  phoneNumberId=${channel.phoneNumberId}`);
  const token = decryptToken(channel.accessTokenEnc, keyHex);

  const base = `https://graph.facebook.com/${version}`;
  const auth = { Authorization: `Bearer ${token}` };

  const current = await axios.get<Record<string, unknown>>(`${base}/${channel.phoneNumberId}/settings`, {
    headers: auth,
    timeout: 15000,
  });
  console.log('── CURRENT settings ──\n' + JSON.stringify(current.data, null, 2));
  console.log('── INTENDED calling block ──\n' + JSON.stringify(CALLING_SETTINGS, null, 2));

  if (dryRun) {
    console.log('DRY_RUN=1 → not writing.');
    return;
  }

  try {
    const res = await axios.post<Record<string, unknown>>(
      `${base}/${channel.phoneNumberId}/settings`,
      { calling: CALLING_SETTINGS },
      { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 20000 },
    );
    console.log('POST →', JSON.stringify(res.data));
  } catch (e) {
    const err = e as AxiosError<{ error?: { message?: string; error_user_msg?: string; code?: number } }>;
    const d = err.response?.data?.error;
    console.error(`❌ POST FAILED  HTTP ${err.response?.status ?? '??'} code=${d?.code ?? '?'}`);
    console.error(`   ${d?.error_user_msg ?? d?.message ?? err.message}`);
    console.error(
      '   If the error names callback_permission_status or call_hours, the account may not have the field yet — retry with a newer META_GRAPH_API_VERSION (e.g. v23.0).',
    );
    process.exitCode = 1;
    return;
  }

  const after = await axios.get<Record<string, unknown>>(`${base}/${channel.phoneNumberId}/settings`, {
    headers: auth,
    timeout: 15000,
  });
  console.log('── VERIFY (settings after write) ──\n' + JSON.stringify(after.data, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
