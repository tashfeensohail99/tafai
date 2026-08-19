/**
 * Safe, idempotent production seed for the Judicial Review deadline RULES
 * (PR 4). A deadline rule is DATA, not a migration (a Special Order is a data
 * change, not a deploy), so the ruleSetVersion=1 rows ship via this script.
 *
 *   railway run --service backend -- npx ts-node -T scripts/seed-jr-deadline-rules.ts
 *
 * Additive and safe to re-run. Keyed on (ruleSetVersion, milestoneKey,
 * variantKey): a missing row is created with its seed verificationStatus; an
 * existing row has its day counts, offset, authority and dates refreshed but its
 * verificationStatus / verifiedByUserId / verifiedAt are LEFT UNTOUCHED — a human
 * "VERIFIED" decision is never silently reverted (nor an UNVERIFIED row silently
 * upgraded) by re-running the seed. Mirrors scripts/sync-jr-perms.ts.
 *
 * ⚠ RULE_10_PERFECTION ships UNVERIFIED on purpose (see notes). It BLOCKS quoting
 * any perfection date to a client until the JR Head reads the 26-Jun-2026 order
 * and marks the rule VERIFIED via PATCH /jr/rules/:id/verify.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EARLY = new Date('2001-01-01');

interface SeedRule {
  milestoneKey: string;
  variantKey: string | null;
  baseDays: number;
  modifierDays: number;
  offsetDirection: 'AFTER' | 'BEFORE';
  verificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'SUPERSEDED';
  authorityCitation: string;
  sourceUrl: string;
  effectiveFrom: Date;
  notes: string | null;
}

const IRPA = (section: string) =>
  `https://laws-lois.justice.gc.ca/eng/acts/i-2.5/section-${section}.html`;
const FCIRPR = 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-93-22/';
const PRACTICE_GUIDELINES = 'https://www.fct-cf.ca/en/pages/law-and-practice/practice-guidelines';
const RAD_RULES = 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-2012-257/';
const CLIENT_DOC = 'https://www.canada.ca/en/immigration-refugees-citizenship.html';

const RULES: SeedRule[] = [
  {
    milestoneKey: 'ALJR_FILING',
    variantKey: 'IN_CANADA',
    baseDays: 15,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'IRPA s.72(2)(b)',
    sourceUrl: IRPA('72'),
    effectiveFrom: EARLY,
    notes: null,
  },
  {
    milestoneKey: 'ALJR_FILING',
    variantKey: 'OUTSIDE_CANADA',
    baseDays: 60,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'IRPA s.72(2)(b)',
    sourceUrl: IRPA('72'),
    effectiveFrom: EARLY,
    notes: null,
  },
  {
    milestoneKey: 'ALJR_FILING',
    variantKey: 'UNKNOWN',
    baseDays: 15,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'IRPA s.72(2)(b)',
    sourceUrl: IRPA('72'),
    effectiveFrom: EARLY,
    notes: 'UNKNOWN computes as 15 — conservative',
  },
  {
    milestoneKey: 'PROOF_OF_SERVICE',
    variantKey: null,
    baseDays: 10,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'FCIRPR r.7(2)',
    sourceUrl: FCIRPR,
    effectiveFrom: EARLY,
    notes: null,
  },
  {
    milestoneKey: 'NOTICE_OF_APPEARANCE',
    variantKey: null,
    baseDays: 10,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'FCIRPR r.8(1)',
    sourceUrl: FCIRPR,
    effectiveFrom: EARLY,
    notes: null,
  },
  {
    milestoneKey: 'RULE_10_PERFECTION',
    variantKey: null,
    baseDays: 30,
    modifierDays: 90,
    offsetDirection: 'AFTER',
    verificationStatus: 'UNVERIFIED',
    authorityCitation: 'FCIRPR r.10(1) + Special Order 26 Jun 2026 (Bulletin 110)',
    sourceUrl: FCIRPR,
    // effectiveFrom is EARLY on purpose: this is the ONLY seeded perfection rule,
    // so an anchor-gated effectiveFrom (the +90 took effect 26-Jun-2026) would make
    // a FATAL perfection deadline vanish SILENTLY for any earlier anchor — and the
    // anchor (rule9ResponseAt / aljrFiledAt) is a user-entered historical date that
    // routinely predates that cut-off. A present-but-flagged provisional date is far
    // safer than a silent absence; the whole row is UNVERIFIED, so nothing computed
    // from it can reach a client until a human reads the order and marks it VERIFIED.
    effectiveFrom: EARLY,
    notes:
      'BLOCKING UNKNOWN — the 26-Jun-2026 order was never read verbatim; +90/120-day total ' +
      'UNVERIFIED. Applies from EARLY so a fatal perfection deadline is always shown (flagged ' +
      'non-quotable), never silently dropped for a pre-cut-off anchor. A human must read the ' +
      'order and PATCH this row VERIFIED before any perfection date reaches a client.',
  },
  {
    milestoneKey: 'RULE_11_RESPONDENT_RECORD',
    variantKey: null,
    baseDays: 30,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'FCIRPR r.11',
    sourceUrl: FCIRPR,
    effectiveFrom: EARLY,
    notes: 'Explicitly NOT extended by the Special Orders',
  },
  {
    milestoneKey: 'RULE_13_REPLY',
    variantKey: null,
    baseDays: 10,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'FCIRPR r.13',
    sourceUrl: FCIRPR,
    effectiveFrom: EARLY,
    notes: null,
  },
  {
    milestoneKey: 'POST_LEAVE_SETTLEMENT',
    variantKey: null,
    baseDays: 15,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'Consolidated Practice Guidelines',
    sourceUrl: PRACTICE_GUIDELINES,
    effectiveFrom: EARLY,
    notes: null,
  },
  {
    milestoneKey: 'CERTIFIED_QUESTION_NOTICE',
    variantKey: null,
    baseDays: 5,
    modifierDays: 0,
    offsetDirection: 'BEFORE',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'Consolidated Practice Guidelines',
    sourceUrl: PRACTICE_GUIDELINES,
    effectiveFrom: EARLY,
    notes: 'Counts back from the hearing',
  },
  {
    milestoneKey: 'FCA_NOTICE_OF_APPEAL',
    variantKey: null,
    baseDays: 30,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'FCIRPR r.20',
    sourceUrl: FCIRPR,
    effectiveFrom: EARLY,
    notes:
      'Straight 30 calendar days; FCA s.27(2) July/Aug exclusion does NOT apply (r.20 governs) — ' +
      'flag the conflict',
  },
  {
    milestoneKey: 'FCA_SERVICE',
    variantKey: null,
    baseDays: 15,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'FCIRPR r.20',
    sourceUrl: FCIRPR,
    effectiveFrom: EARLY,
    notes: 'anchor field not yet modelled (v1 gap)',
  },
  {
    milestoneKey: 'IAD_APPEAL',
    variantKey: null,
    baseDays: 30,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'IRPA s.63 / IAD Rules',
    sourceUrl: IRPA('63'),
    effectiveFrom: EARLY,
    notes: 'referral clock',
  },
  {
    milestoneKey: 'RAD_APPEAL',
    variantKey: null,
    baseDays: 0,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'UNVERIFIED',
    authorityCitation: 'RAD Rules — day count NOT established',
    sourceUrl: RAD_RULES,
    effectiveFrom: EARLY,
    notes: 'ships UNVERIFIED; must be read before use',
  },
  {
    milestoneKey: 'UNDERLYING_DOC_EXPIRY',
    variantKey: null,
    baseDays: 0,
    modifierDays: 0,
    offsetDirection: 'AFTER',
    verificationStatus: 'VERIFIED',
    authorityCitation: 'Client document expiry (not a court rule)',
    sourceUrl: CLIENT_DOC,
    effectiveFrom: EARLY,
    notes: 'sentinel rule for the expiry-watch endpoint',
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const r of RULES) {
    const existing = await prisma.jrDeadlineRule.findFirst({
      where: { ruleSetVersion: 1, milestoneKey: r.milestoneKey, variantKey: r.variantKey },
      select: { id: true, verificationStatus: true },
    });

    const descriptive = {
      baseDays: r.baseDays,
      modifierDays: r.modifierDays,
      offsetDirection: r.offsetDirection,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: null,
      authorityCitation: r.authorityCitation,
      sourceUrl: r.sourceUrl,
      notes: r.notes,
    };

    const label = `${r.milestoneKey}${r.variantKey ? ` [${r.variantKey}]` : ''}`;

    if (existing) {
      // Refresh the descriptive fields only — never touch a human's verification.
      await prisma.jrDeadlineRule.update({ where: { id: existing.id }, data: descriptive });
      updated++;
      console.log(
        `  UPDATED ${label} (verificationStatus left as ${existing.verificationStatus})`,
      );
    } else {
      await prisma.jrDeadlineRule.create({
        data: {
          ruleSetVersion: 1,
          milestoneKey: r.milestoneKey,
          variantKey: r.variantKey,
          verificationStatus: r.verificationStatus,
          ...descriptive,
        },
      });
      created++;
      console.log(`  CREATED ${label} (${r.verificationStatus})`);
    }
  }

  console.log(`\ndone — ruleSetVersion=1: ${created} created, ${updated} updated, ${RULES.length} total`);
  console.log(
    'NEXT: in /jr the Head must read the 26-Jun-2026 order and PATCH RULE_10_PERFECTION VERIFIED ' +
      'before any perfection date can be quoted to a client.',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
