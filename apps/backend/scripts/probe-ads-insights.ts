/** READ-ONLY: can the live token read /act/insights on the discovered accounts? */
import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'node:crypto';
const prisma = new PrismaClient();
function dec(p: string, k: string): string {
  const [a, b, c] = p.split(':');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(k, 'hex'), Buffer.from(a, 'base64'));
  d.setAuthTag(Buffer.from(c, 'base64'));
  return Buffer.concat([d.update(Buffer.from(b, 'base64')), d.final()]).toString('utf8');
}
async function main() {
  const ver = process.env.META_GRAPH_API_VERSION?.trim() || 'v21.0';
  let t = process.env.META_PAGE_ACCESS_TOKEN?.trim() || '';
  if (!t) {
    const k = process.env.WHATSAPP_ENCRYPTION_KEY ?? '';
    const ch = await prisma.whatsAppChannel.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { accessTokenEnc: true },
    });
    for (const c of ch) {
      try {
        t = dec(c.accessTokenEnc, k);
        break;
      } catch {
        /* next */
      }
    }
  }
  for (const act of ['act_469276969829554', 'act_817813140562647']) {
    const u = `https://graph.facebook.com/${ver}/${act}/insights?level=account&fields=spend,account_currency&date_preset=last_30d`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
    console.log(act, r.status, JSON.stringify(await r.json().catch(() => null)).slice(0, 400));
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => prisma.$disconnect());
