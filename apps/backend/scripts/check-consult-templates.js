/**
 * Read-only: current Meta review status of the reception paid-consult templates.
 *   railway run --service backend -- node scripts/check-consult-templates.js
 */
const { PrismaClient } = require('@prisma/client');
const { createDecipheriv } = require('node:crypto');
const axios = require('axios');

const NAMES = [
  'consultation_confirmed',
  'consultation_payment_received',
  'consultation_no_show',
  'consultation_payment_reminder',
  'consultation_reminder',
  'consultation_slot_released',
];

function decryptToken(payload, keyHex) {
  const [ivB64, dataB64, tagB64] = payload.split(':');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
}

async function main() {
  const prisma = new PrismaClient();
  const keyHex = process.env.WHATSAPP_ENCRYPTION_KEY || '';
  const version = process.env.META_GRAPH_API_VERSION || 'v21.0';
  const ch = await prisma.whatsAppChannel.findFirst({
    where: { status: 'ACTIVE' },
    select: { wabaId: true, accessTokenEnc: true },
  });
  const token = decryptToken(ch.accessTokenEnc, keyHex);
  const res = await axios.get(`https://graph.facebook.com/${version}/${ch.wabaId}/message_templates`, {
    params: { fields: 'name,language,status,category', limit: 200 },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  const all = res.data.data || [];
  for (const n of NAMES) {
    const hit = all.find((t) => t.name === n);
    console.log(hit ? `${n} [${hit.language}] → ${hit.status} (${hit.category})` : `${n} → NOT FOUND`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
