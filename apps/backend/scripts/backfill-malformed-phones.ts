/**
 * Backfill malformed phone numbers to canonical E.164.
 *
 * Fixes the legacy shape written by the WhatsApp webhook before it normalised
 * inbound phones: "+92" glued onto a local-with-0 number → "+9203189155405"
 * (13 digits, "920…"), plus over-length "92…" numbers.
 *
 * SAFE BY DESIGN:
 *   • Read-only audit by default. Pass --apply to write.
 *   • Writes use DIRECT_URL (5432) when present (avoids the 6543 pooler).
 *   • crm.leads.phone / crm.clients.phone are canonicalised ONLY when the fix is
 *     deterministic (a retained PK trunk-0) AND no other live row already holds
 *     the canonical E.164. A clean twin → MANUAL merge (never auto-merged: merge
 *     is destructive — owner attribution, finance ledger, agreements, history).
 *   • OVERSEAS numbers with a spurious 92 prefix (real Gulf/Saudi/UAE/etc numbers
 *     glued behind Pakistan's CC, e.g. "+92966…" = Saudi "+966…") are NEVER
 *     auto-stripped: these leads were created FROM "92…" inbound, so Meta keeps
 *     sending "92…" and the stored phone still matches — stripping would break
 *     WhatsApp routing and manufacture a duplicate. Reported for MANUAL review.
 *   • Numbers libphonenumber can't validate at all → manual review, never touched.
 *   • whatsapp.threads."waContactId" is Meta's natural resend key — NEVER
 *     rewritten; threads are only reported.
 *
 * Idempotent + re-runnable. Run:
 *   railway run --service backend -- npx ts-node -T scripts/backfill-malformed-phones.ts          # audit/dry-run
 *   railway run --service backend -- npx ts-node -T scripts/backfill-malformed-phones.ts --apply  # write
 */
import { PrismaClient } from '@prisma/client';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { normalisePhone } from '../src/common/phone/phone.util';

const prisma = new PrismaClient(
  process.env.DIRECT_URL ? { datasources: { db: { url: process.env.DIRECT_URL } } } : undefined,
);

const APPLY = process.argv.includes('--apply');

const MALFORMED_SQL = (col: string) => {
  const d = `regexp_replace(${col}, '[^0-9]', '', 'g')`;
  return `(${d} LIKE '920%' OR (length(${d}) > 12 AND ${d} LIKE '92%'))`;
};

type Action = 'fix' | 'collision' | 'overseas' | 'unparseable' | 'noop';
type Row = { id: string; value: string; name: string };
type Plan = { table: 'lead' | 'client'; row: Row; canonical: string; action: Action; twinId?: string; country?: string };

async function classify(
  table: 'lead' | 'client',
  row: Row,
  twinFinder: (e164: string, selfId: string) => Promise<string | null>,
): Promise<Plan> {
  const digits = row.value.replace(/\D/g, '');
  // Overseas number with a spurious leading 92: strip it and see if the rest is a
  // valid NON-PK international number. If so, it's a mislabeled foreign contact —
  // NEVER auto-fix (see header). Checked before normalise because normalise leaves
  // "+92966…" unchanged (libphonenumber accepts it), which would hide the problem.
  if (digits.startsWith('92')) {
    const stripped = parsePhoneNumberFromString('+' + digits.slice(2));
    if (stripped?.isValid() && stripped.country && stripped.country !== 'PK') {
      return { table, row, canonical: stripped.number, action: 'overseas', country: stripped.country };
    }
  }
  const norm = normalisePhone(row.value, 'PK');
  if (!norm.ok || !norm.e164) return { table, row, canonical: '', action: 'unparseable' };
  if (norm.e164 === row.value) return { table, row, canonical: norm.e164, action: 'noop' };
  const twin = await twinFinder(norm.e164, row.id);
  return { table, row, canonical: norm.e164, action: twin ? 'collision' : 'fix', twinId: twin ?? undefined };
}

async function main() {
  console.log(`=== Malformed-phone backfill — ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (read-only)'} ===`);
  console.log(`   db endpoint: ${process.env.DIRECT_URL ? 'DIRECT_URL (5432)' : 'DATABASE_URL (default)'}\n`);

  const leadRows = await prisma.$queryRawUnsafe<Array<{ id: string; phone: string; fn: string | null; ln: string | null }>>(
    `SELECT id, phone, "firstName" AS fn, "lastName" AS ln FROM crm.leads
      WHERE "deletedAt" IS NULL AND phone !~ '[A-Za-z]' AND ${MALFORMED_SQL('phone')}
      ORDER BY "createdAt" ASC`,
  );
  const leadPlans: Plan[] = [];
  for (const r of leadRows) {
    leadPlans.push(
      await classify('lead', { id: r.id, value: r.phone, name: `${r.fn ?? ''} ${r.ln ?? ''}`.trim() || '(no name)' }, async (e164, selfId) => {
        const t = await prisma.lead.findFirst({ where: { phone: e164, deletedAt: null, id: { not: selfId } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
        return t?.id ?? null;
      }),
    );
  }

  const clientRows = await prisma.$queryRawUnsafe<Array<{ id: string; phone: string; fn: string | null; ln: string | null }>>(
    `SELECT id, phone, "firstName" AS fn, "lastName" AS ln FROM crm.clients
      WHERE "deletedAt" IS NULL AND phone !~ '[A-Za-z]' AND ${MALFORMED_SQL('phone')}
      ORDER BY "createdAt" ASC`,
  );
  const clientPlans: Plan[] = [];
  for (const r of clientRows) {
    clientPlans.push(
      await classify('client', { id: r.id, value: r.phone, name: `${r.fn ?? ''} ${r.ln ?? ''}`.trim() || '(no name)' }, async (e164, selfId) => {
        const t = await prisma.client.findFirst({ where: { phone: e164, deletedAt: null, id: { not: selfId } }, select: { id: true } });
        return t?.id ?? null;
      }),
    );
  }

  const threadRows = await prisma.$queryRawUnsafe<Array<{ id: string; wa: string; leadId: string | null; clientId: string | null }>>(
    `SELECT id, "waContactId" AS wa, "leadId", "clientId" FROM whatsapp.threads WHERE ${MALFORMED_SQL('"waContactId"')} ORDER BY "createdAt" ASC`,
  );

  const all = [...leadPlans, ...clientPlans];
  const by = (a: Action) => all.filter((p) => p.action === a);
  const fixes = by('fix');

  console.log(`Scanned: ${leadRows.length} leads, ${clientRows.length} clients, ${threadRows.length} threads (malformed).\n`);

  if (fixes.length) {
    console.log(`── FIXABLE (retained PK trunk-0, no clean twin — safe to canonicalise): ${fixes.length} ──`);
    for (const p of fixes) {
      if (APPLY) {
        if (p.table === 'lead') await prisma.lead.update({ where: { id: p.row.id }, data: { phone: p.canonical } });
        else await prisma.client.update({ where: { id: p.row.id }, data: { phone: p.canonical } });
        console.log(`  ✔ ${p.table} ${p.row.name.padEnd(22)} ${p.row.value}  →  ${p.canonical}`);
      } else console.log(`  would fix ${p.table} ${p.row.name.padEnd(22)} ${p.row.value}  →  ${p.canonical}`);
    }
    console.log('');
  }

  const collisions = by('collision');
  if (collisions.length) {
    console.log(`── COLLISIONS (a clean row already holds the canonical → MANUAL MERGE, not written): ${collisions.length} ──`);
    for (const p of collisions) {
      let extra = '';
      if (p.table === 'lead') {
        const [agr, thr] = await Promise.all([
          prisma.agreement.count({ where: { leadId: p.row.id, deletedAt: null } }).catch(() => -1),
          prisma.whatsAppThread.count({ where: { leadId: p.row.id } }).catch(() => -1),
        ]);
        extra = ` | malformed-side: ${agr} agreements, ${thr} threads`;
      }
      console.log(`  • ${p.table} "${p.row.name}" ${p.row.value} → wants ${p.canonical}; clean twin = ${p.twinId}${extra}`);
    }
    console.log('');
  }

  const overseas = by('overseas');
  if (overseas.length) {
    console.log(`── OVERSEAS with spurious "92" prefix (real foreign number → MANUAL REVIEW, NEVER auto-stripped): ${overseas.length} ──`);
    for (const p of overseas) console.log(`  • ${p.table} "${p.row.name}" ${p.row.value}  ⇒ really ${p.country} ${p.canonical}`);
    console.log('');
  }

  const unparseable = by('unparseable');
  if (unparseable.length) {
    console.log(`── UNPARSEABLE (not a valid number, likely seed/demo data → MANUAL REVIEW, not written): ${unparseable.length} ──`);
    for (const p of unparseable) console.log(`  • ${p.table} "${p.row.name}" ${p.row.value}`);
    console.log('');
  }

  const noops = by('noop');
  if (noops.length) console.log(`(${noops.length} rows already canonical after normalise — nothing to do.)\n`);

  if (threadRows.length) {
    console.log(`── THREADS with malformed waContactId (resend key — NEVER rewritten; linkage via leadId/clientId stays correct): ${threadRows.length} ──`);
    for (const t of threadRows) console.log(`  • thread ${t.id} wa=${t.wa} leadId=${t.leadId ?? '—'} clientId=${t.clientId ?? '—'}`);
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`  Safe fixes    : ${fixes.length}  ${APPLY ? '(applied)' : '(dry-run — add --apply)'}`);
  console.log(`  Collisions    : ${collisions.length}  (manual merge)`);
  console.log(`  Overseas "92" : ${overseas.length}  (manual review — real foreign numbers)`);
  console.log(`  Unparseable   : ${unparseable.length}  (manual review — likely seed/demo)`);
  console.log(`  Threads       : ${threadRows.length}  (report only)`);
}

main()
  .catch((e) => { console.error(String(e)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
