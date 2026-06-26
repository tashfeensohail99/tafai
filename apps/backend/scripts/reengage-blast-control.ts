/**
 * Control the self-paced dormant-backlog re-engagement blast (driven by an
 * ACTIVE WhatsAppCampaign row that WhatsAppReengageBlastService reads).
 *
 *   railway run --service backend npx ts-node -T scripts/reengage-blast-control.ts <action>
 *
 * actions:
 *   status   (default) — show the campaign + counters + remaining backlog
 *   preview            — show the NEXT batch (priority agent first) + per-agent backlog; sends nothing
 *   start              — create an ACTIVE campaign (Iffat Hanif first, reengage_personal, ~15/hr, cap 200/day)
 *   pause              — ACTIVE → PAUSED (cron stops sending; resume later)
 *   resume             — PAUSED → ACTIVE
 *   stop               — → COMPLETED (done)
 *
 * Read-only except start/pause/resume/stop. No customer messages are sent by this
 * script — the cron does the sending, paced, only while a campaign is ACTIVE.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const TEMPLATE_NAME = 'reengage_personal';
const LANGUAGE = 'en';
const TEMPLATE_BODY =
  'Hi {{1}}, this is {{2}} from Tashfeen Immigration Solutions — I can still help with your immigration enquiry whenever you are ready. Just reply here and I will assist you personally.';
const CONFIG = { perTick: 5, dailyCap: 200, staggerMs: 1500 }; // ~15/hr, ≤200/day

async function eligibleByAgent() {
  const now = new Date();
  const sent = await prisma.whatsAppMessage.findMany({
    where: { templateName: TEMPLATE_NAME },
    select: { threadId: true },
    distinct: ['threadId'],
  });
  const sentIds = new Set(sent.map((s) => s.threadId).filter((x): x is string => !!x));
  const rows = await prisma.whatsAppThread.findMany({
    where: {
      lastHumanReplyAt: null,
      status: { in: ['OPEN', 'PENDING'] },
      windowExpiresAt: { lt: now },
      leadId: { not: null },
      lead: { is: { blockedAt: null, convertedClientId: null, deletedAt: null, assignedEmployeeId: { not: null } } },
      ...(sentIds.size ? { id: { notIn: [...sentIds] } } : {}),
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 5000,
    select: { id: true, lead: { select: { firstName: true, assignedEmployeeId: true, assignedEmployee: { select: { firstName: true, lastName: true } } } } },
  });
  const byAgent = new Map<string, { name: string; firstNames: string[] }>();
  for (const r of rows) {
    const aid = r.lead?.assignedEmployeeId;
    if (!aid) continue;
    const name = `${r.lead?.assignedEmployee?.firstName ?? ''} ${r.lead?.assignedEmployee?.lastName ?? ''}`.trim() || aid.slice(0, 8);
    const g = byAgent.get(aid) ?? { name, firstNames: [] };
    g.firstNames.push((r.lead?.firstName ?? 'there').trim() || 'there');
    byAgent.set(aid, g);
  }
  return { total: rows.length, alreadySent: sentIds.size, byAgent };
}

async function main() {
  const action = (process.argv[2] || 'status').toLowerCase();
  const channel = await prisma.whatsAppChannel.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, label: true } });
  if (!channel) throw new Error('No ACTIVE channel');

  if (action === 'status' || action === 'preview') {
    const active = await prisma.whatsAppCampaign.findFirst({ where: { status: 'SENDING' }, orderBy: { createdAt: 'desc' } });
    const { total, byAgent } = await eligibleByAgent();
    console.log(`Channel: ${channel.label}`);
    console.log(`Active campaign: ${active ? `${active.name} (sent ${active.totalSent}, started ${active.startedAt?.toISOString() ?? '—'})` : 'NONE (blast idle)'}`);
    console.log(`Eligible remaining (uncontacted + window-closed + assigned + not-yet-sent): ${total}`);
    console.log('--- backlog by agent (desc) ---');
    const sorted = [...byAgent.entries()].sort((a, b) => b[1].firstNames.length - a[1].firstNames.length);
    for (const [, g] of sorted) console.log(`  ${String(g.firstNames.length).padStart(4)}  ${g.name}`);

    if (action === 'preview') {
      const iffat = await prisma.employee.findFirst({ where: { firstName: 'Iffat', lastName: 'Hanif', isActive: true, deletedAt: null }, select: { id: true } });
      const priorityId = iffat?.id;
      const pick = (priorityId && byAgent.get(priorityId)) || sorted[0]?.[1];
      console.log('\n=== PREVIEW: next batch (no send) ===');
      if (!pick) { console.log('  (nothing eligible)'); }
      else {
        console.log(`  agent: ${pick.name}  — next ${CONFIG.perTick} of ${pick.firstNames.length}`);
        for (const raw of pick.firstNames.slice(0, CONFIG.perTick)) {
          const n = /^[A-Za-z][A-Za-z .'’-]{1,38}$/.test(raw) ? raw : 'there'; // mirror cleanGreetingName
          console.log(`    → "${TEMPLATE_BODY.replace('{{1}}', n).replace('{{2}}', pick.name.split(' ')[0])}"`);
        }
      }
    }
    return;
  }

  if (action === 'pause' || action === 'resume' || action === 'stop') {
    const from = action === 'resume' ? 'PAUSED' : 'SENDING';
    const to = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'SENDING' : 'COMPLETED';
    const res = await prisma.whatsAppCampaign.updateMany({ where: { status: from as any }, data: { status: to as any, ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}) } });
    console.log(`${action}: ${res.count} campaign(s) ${from} → ${to}`);
    return;
  }

  if (action === 'start') {
    const existing = await prisma.whatsAppCampaign.findFirst({ where: { status: 'SENDING' } });
    if (existing) { console.log(`Already running: ${existing.name} (sent ${existing.totalSent}). Use pause/stop first.`); return; }
    // Ensure the template row exists (FK + body for the cron to render).
    const tpl = await prisma.whatsAppTemplate.upsert({
      where: { channelId_name_language: { channelId: channel.id, name: TEMPLATE_NAME, language: LANGUAGE } },
      create: {
        channelId: channel.id, name: TEMPLATE_NAME, language: LANGUAGE,
        category: 'MARKETING' as any, status: 'APPROVED' as any,
        components: [{ type: 'BODY', text: TEMPLATE_BODY }] as unknown as Prisma.InputJsonValue,
        lastSyncAt: new Date(),
      },
      update: { status: 'APPROVED' as any, components: [{ type: 'BODY', text: TEMPLATE_BODY }] as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
    const owner = await prisma.userAccount.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!owner) throw new Error('No UserAccount found for createdByUserId');
    const iffat = await prisma.employee.findFirst({ where: { firstName: 'Iffat', lastName: 'Hanif', isActive: true, deletedAt: null }, select: { id: true } });
    const { total } = await eligibleByAgent();
    const campaign = await prisma.whatsAppCampaign.create({
      data: {
        channelId: channel.id, templateId: tpl.id, createdByUserId: owner.id,
        name: 'Dormant backlog re-engagement', description: 'Agent-by-agent, ~15/hr, reengage_personal',
        status: 'SENDING', totalAudience: total,
        variableMap: {
          templateName: TEMPLATE_NAME, language: LANGUAGE,
          perTick: CONFIG.perTick, dailyCap: CONFIG.dailyCap, staggerMs: CONFIG.staggerMs,
          priorityEmployeeId: iffat?.id ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    console.log(`STARTED campaign ${campaign.id}: ${total} eligible, priority=Iffat Hanif${iffat ? '' : ' (NOT FOUND — falls back to largest backlog)'}, ${CONFIG.perTick}/tick, ${CONFIG.dailyCap}/day. The cron sends on its next sweep (≤20 min, 8am-10pm PKT).`);
    return;
  }

  console.log(`unknown action "${action}". Use: status | preview | start | pause | resume | stop`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
