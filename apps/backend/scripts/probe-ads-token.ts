/** READ-ONLY: can the EXISTING WhatsApp/leads Meta token read the Marketing
 *  API (ad spend)? Also discovers the ad-account id (not stored anywhere). */
import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'node:crypto';
const prisma = new PrismaClient();

function decrypt(payload: string, keyHex: string): string {
  const [iv, data, tag] = payload.split(':');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

const g = async (url: string) => {
  try {
    const r = await fetch(url);
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) {
    return { status: 0, body: { error: String(e) } };
  }
};

async function main() {
  const ver = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
  const base = `https://graph.facebook.com/${ver}`;
  let token = process.env.META_PAGE_ACCESS_TOKEN?.trim() || '';
  if (!token) {
    const key = process.env.WHATSAPP_ENCRYPTION_KEY ?? '';
    const chans = await prisma.whatsAppChannel.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { label: true, accessTokenEnc: true },
    });
    for (const c of chans) {
      try {
        token = decrypt(c.accessTokenEnc, key);
        console.log(`using token from channel "${c.label}"`);
        break;
      } catch {
        /* try next */
      }
    }
  }
  if (!token) {
    console.log('NO USABLE TOKEN');
    return;
  }
  console.log('token tail: …' + token.slice(-6));

  const perms = await g(`${base}/me/permissions?access_token=${encodeURIComponent(token)}`);
  console.log('\n/me/permissions →', perms.status, JSON.stringify(perms.body).slice(0, 700));

  const accts = await g(
    `${base}/me/adaccounts?fields=account_id,name,currency,account_status,amount_spent&access_token=${encodeURIComponent(token)}`,
  );
  console.log('\n/me/adaccounts →', accts.status, JSON.stringify(accts.body).slice(0, 1400));

  const me = await g(`${base}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  console.log('\n/me →', me.status, JSON.stringify(me.body).slice(0, 300));

  // Find the Business that owns the WABA, then its ad accounts.
  const chan = await prisma.whatsAppChannel.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { wabaId: true },
  });
  console.log('\nWABA id:', chan?.wabaId);
  if (chan?.wabaId) {
    const waba = await g(
      `${base}/${chan.wabaId}?fields=id,name,currency,timezone_id,owner_business_info{id,name},on_behalf_of_business_info{id,name}&access_token=${encodeURIComponent(token)}`,
    );
    console.log('WABA →', waba.status, JSON.stringify(waba.body).slice(0, 700));
    const wb = waba.body as {
      owner_business_info?: { id?: string };
      on_behalf_of_business_info?: { id?: string };
    };
    const bizId = wb?.owner_business_info?.id ?? wb?.on_behalf_of_business_info?.id;
    console.log('business id →', bizId);
    if (bizId) {
      for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
        const r = await g(
          `${base}/${bizId}/${edge}?fields=account_id,name,currency,amount_spent&limit=50&access_token=${encodeURIComponent(token)}`,
        );
        const data = (r.body as { data?: unknown[] })?.data ?? [];
        console.log(`/${bizId}/${edge} →`, r.status, `(${data.length})`, JSON.stringify(data).slice(0, 900));
      }
    }
  }

  // Discover ad accounts via the Business edge (works for System-User tokens
  // where /me/adaccounts is empty because the account is business-owned).
  const collected: Array<{ account_id?: string; name?: string; currency?: string }> = [];
  const biz = await g(`${base}/me/businesses?fields=id,name&access_token=${encodeURIComponent(token)}`);
  console.log('\n/me/businesses →', biz.status, JSON.stringify(biz.body).slice(0, 600));
  const businesses = (biz.body as { data?: Array<{ id: string; name?: string }> })?.data ?? [];
  for (const b of businesses) {
    for (const edge of ['owned_ad_accounts', 'client_ad_accounts']) {
      const r = await g(
        `${base}/${b.id}/${edge}?fields=account_id,name,currency,amount_spent&access_token=${encodeURIComponent(token)}`,
      );
      const data = (r.body as { data?: Array<{ account_id?: string; name?: string; currency?: string }> })?.data ?? [];
      console.log(`\n/${b.id}/${edge} →`, r.status, `(${data.length})`, JSON.stringify(data).slice(0, 700));
      collected.push(...data);
    }
  }

  const first =
    (accts.body as { data?: Array<{ account_id?: string }> })?.data?.[0]?.account_id ??
    collected[0]?.account_id;
  if (first) {
    const act = `act_${first}`;
    const ins = await g(
      `${base}/${act}/insights?level=account&fields=spend,account_currency&date_preset=last_30d&access_token=${encodeURIComponent(token)}`,
    );
    console.log(`\n✅ /${act}/insights(last_30d) →`, ins.status, JSON.stringify(ins.body).slice(0, 700));
  } else {
    console.log('\n(no ad accounts discovered via /me/adaccounts or business edges)');
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
