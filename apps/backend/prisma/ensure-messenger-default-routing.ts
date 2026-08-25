/**
 * Seeds the Messenger channel-default routing rule so Facebook Messenger leads
 * default to the ISLAMABAD desk (the agreed "default for now"). Marketing can
 * later change this to Lahore / both from /marketing/routing.
 *
 * Idempotent + NON-destructive:
 *   - If a CHANNEL rule for 'MESSENGER' already exists, it is LEFT AS-IS (so a
 *     marketing edit to Lahore/both is never clobbered by a re-run).
 *   - Otherwise it creates one pinned to the Islamabad branch.
 *
 * Run (after the CHANNEL-enum migration has deployed):
 *   cd apps/backend
 *   npx ts-node prisma/ensure-messenger-default-routing.ts
 */
import { PrismaClient, AdRoutingTargetType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.adRoutingRule.findUnique({
    where: { targetType_targetId: { targetType: AdRoutingTargetType.CHANNEL, targetId: 'MESSENGER' } },
  });
  if (existing) {
    console.log(
      `• MESSENGER channel rule already exists (branches: ${existing.branchIds.join(', ') || 'none'}) — leaving as-is.`,
    );
    return;
  }

  const islamabad = await prisma.branch.findFirst({
    where: {
      isActive: true,
      OR: [
        { name: { contains: 'islamabad', mode: 'insensitive' } },
        { city: { contains: 'islamabad', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, city: true },
  });
  if (!islamabad) {
    throw new Error('No active Islamabad branch found — cannot seed the Messenger default. Create the rule from /marketing/routing instead.');
  }

  await prisma.adRoutingRule.create({
    data: {
      targetType: AdRoutingTargetType.CHANNEL,
      targetId: 'MESSENGER',
      branchIds: [islamabad.id],
      employeeIds: [],
      notes: 'Default desk for Facebook Messenger leads (auto-seeded). Editable in /marketing/routing.',
    },
  });
  console.log(`✓ Seeded MESSENGER channel default → Islamabad branch "${islamabad.name}" (${islamabad.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
