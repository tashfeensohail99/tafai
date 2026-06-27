/**
 * One-off: wire the Meta Ads account into the CRM + seed spend immediately.
 *  1. Upsert the active `meta_ads` API key (label = account id; key = the
 *     account id too → MetaAdsService reuses the live WhatsApp token).
 *  2. Pull the last 35 days of per-ad daily spend and upsert AdSpendDaily,
 *     FX-converting PKR→CAD (same math the service uses), so the dashboard
 *     shows real spend now instead of waiting for the 6-hour cron.
 */
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const prisma = new PrismaClient();
const ACCT = 'act_469276969829554';

function enc(plain: string, keyHex: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv.toString('base64'), data.toString('base64'), c.getAuthTag().toString('base64')].join(':');
}
function dec(p: string, k: string): string {
  const [a, b, c] = p.split(':');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(k, 'hex'), Buffer.from(a, 'base64'));
  d.setAuthTag(Buffer.from(c, 'base64'));
  return Buffer.concat([d.update(Buffer.from(b, 'base64')), d.final()]).toString('utf8');
}
async function getToken(keyHex: string): Promise<string> {
  const ch = await prisma.whatsAppChannel.findMany({
    where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, select: { accessTokenEnc: true },
  });
  for (const c of ch) { try { return dec(c.accessTokenEnc, keyHex); } catch { /* next */ } }
  throw new Error('no decryptable channel token');
}
async function pkrPerCad(): Promise<number> {
  try {
    const r = (await fetch('https://open.er-api.com/v6/latest/CAD').then((x) => x.json())) as { rates?: { PKR?: number } };
    if (r?.rates?.PKR) return r.rates.PKR;
  } catch { /* fall back */ }
  return 202;
}

async function main() {
  const keyHex = process.env.WHATSAPP_ENCRYPTION_KEY ?? '';
  const ver = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
  const token = await getToken(keyHex);
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!org) throw new Error('no organization');

  // 1) Credential (idempotent; single active per provider).
  await prisma.apiKey.updateMany({
    where: { organizationId: org.id, provider: 'meta_ads', isActive: true }, data: { isActive: false },
  });
  const existing = await prisma.apiKey.findFirst({ where: { organizationId: org.id, provider: 'meta_ads', label: ACCT } });
  const payload = { keyEnc: enc(ACCT, keyHex), keyTail: ACCT.slice(-4), isActive: true };
  if (existing) await prisma.apiKey.update({ where: { id: existing.id }, data: payload });
  else await prisma.apiKey.create({ data: { organizationId: org.id, provider: 'meta_ads', label: ACCT, ...payload } });
  console.log('✓ meta_ads credential active for', ACCT);

  // 2) Seed spend (last 35d, per-ad daily).
  const rate = await pkrPerCad();
  const since = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10);
  const until = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const fields = 'ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,account_currency';
  let url = `https://graph.facebook.com/${ver}/${ACCT}/insights?level=ad&time_increment=1&fields=${fields}&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=200`;
  let n = 0;
  for (let p = 0; p < 50 && url; p += 1) {
    const r = (await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then((x) => x.json())) as {
      data?: Array<Record<string, string>>; paging?: { next?: string };
    };
    for (const row of r?.data ?? []) {
      if (!row.ad_id || !row.date_start) continue;
      const spend = Number(row.spend ?? 0);
      if (!Number.isFinite(spend)) continue;
      const cur = (row.account_currency || 'PKR').toUpperCase();
      const base = cur === 'CAD' ? spend : Math.round((spend / rate) * 100) / 100;
      const imp = Number(row.impressions); const clk = Number(row.clicks);
      const date = new Date(`${row.date_start}T00:00:00.000Z`);
      const data = {
        adAccountId: ACCT, adId: row.ad_id, adName: row.ad_name ?? null,
        campaignId: row.campaign_id ?? null, campaignName: row.campaign_name ?? null,
        spend: String(row.spend ?? '0'), currency: cur, baseSpend: base, baseCurrency: 'CAD',
        fxRate: cur === 'CAD' ? 1 : rate,
        impressions: Number.isFinite(imp) ? Math.round(imp) : null,
        clicks: Number.isFinite(clk) ? Math.round(clk) : null, syncedAt: new Date(),
      };
      await prisma.adSpendDaily.upsert({ where: { date_adId: { date, adId: row.ad_id } }, create: { date, ...data }, update: data });
      n += 1;
    }
    url = r?.paging?.next ?? '';
  }
  const agg = await prisma.adSpendDaily.aggregate({ _sum: { spend: true, baseSpend: true }, _count: { _all: true } });
  console.log(`✓ seeded ${n} ad-day rows (PKR/CAD=${rate})`);
  console.log(`AdSpendDaily total: ${agg._count._all} rows · PKR ${Math.round(Number(agg._sum.spend ?? 0)).toLocaleString()} · CAD ${Math.round(Number(agg._sum.baseSpend ?? 0)).toLocaleString()}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
