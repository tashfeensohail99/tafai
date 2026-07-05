/**
 * DIAGNOSTIC (read-only): why does the mobile/web inbox show no chats?
 * Reproduces the exact list() where-clauses to see whether the disposition
 * filter (or anything else) is zeroing out the default inbox.
 */
import { PrismaClient, LeadDisposition } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const total = await prisma.whatsAppThread.count();
  const notArchived = await prisma.whatsAppThread.count({
    where: { status: { not: 'ARCHIVED' } },
  });

  // Leads that actually carry a JUNK/DEAD disposition (the only rows the new
  // filter should remove). If this is ~0, the filter removes nothing.
  const junkDeadLeads = await prisma.lead.count({
    where: { disposition: { in: [LeadDisposition.JUNK, LeadDisposition.DEAD] } },
  });
  const anyDisposition = await prisma.lead.count({
    where: { disposition: { not: null } },
  });

  // Default visibility clause WITHOUT the disposition filter.
  const baseVisibility = {
    AND: [
      { OR: [{ lead: { is: { deletedAt: null } } }, { lead: null }] },
      { status: { not: 'ARCHIVED' as const } },
      { OR: [{ lead: { is: { blockedAt: null } } }, { lead: null }] },
      { OR: [{ client: { is: { blockedAt: null } } }, { client: null }] },
    ],
  };

  const withoutDisposition = await prisma.whatsAppThread.count({
    where: baseVisibility,
  });

  // Default visibility WITH the disposition filter (what list() now runs).
  const withDisposition = await prisma.whatsAppThread.count({
    where: {
      AND: [
        ...baseVisibility.AND,
        {
          NOT: {
            lead: {
              is: {
                disposition: { in: [LeadDisposition.JUNK, LeadDisposition.DEAD] },
              },
            },
          },
        },
      ],
    },
  });

  // The "All" tab adds contacted=true (a human has replied).
  const allTab = await prisma.whatsAppThread.count({
    where: {
      AND: [
        ...baseVisibility.AND,
        { NOT: { lead: { is: { disposition: { in: [LeadDisposition.JUNK, LeadDisposition.DEAD] } } } } },
        { lastHumanReplyAt: { not: null } },
      ],
    },
  });

  // CANDIDATE FIX — null-safe exclusion of JUNK/DEAD via explicit OR.
  const candidateFix = await prisma.whatsAppThread.count({
    where: {
      AND: [
        ...baseVisibility.AND,
        {
          OR: [
            { leadId: null },
            { lead: { is: { disposition: null } } },
            { lead: { is: { disposition: { notIn: [LeadDisposition.JUNK, LeadDisposition.DEAD] } } } },
          ],
        },
      ],
    },
  });

  // How many threads have a NULL lead (client-only) — the NOT+is null-relation
  // edge case would drop these if Prisma mis-handles it.
  const nullLeadThreads = await prisma.whatsAppThread.count({
    where: { leadId: null },
  });
  // Same, but do they survive the disposition NOT filter?
  const nullLeadSurviving = await prisma.whatsAppThread.count({
    where: {
      AND: [
        { leadId: null },
        { NOT: { lead: { is: { disposition: { in: [LeadDisposition.JUNK, LeadDisposition.DEAD] } } } } },
      ],
    },
  });

  console.log(JSON.stringify({
    total,
    notArchived,
    junkDeadLeads,
    anyDisposition,
    withoutDisposition,
    withDisposition,
    candidateFix,
    allTab,
    nullLeadThreads,
    nullLeadSurviving,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
