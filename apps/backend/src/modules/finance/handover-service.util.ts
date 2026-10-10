import { serviceForTemplateCategory } from '../../common/service-types';

/** Minimal Prisma surface this helper needs (a PrismaService satisfies it).
 *  Typed loose on the args (Prisma's generated findUnique is a heavily
 *  overloaded generic that fights a precise structural type); results are read
 *  through the explicit select below. */
type AgreementLookupClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agreement: { findUnique: (args: any) => Promise<{ templateId: string } | null> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agreementTemplate: { findUnique: (args: any) => Promise<{ categoryKey: string } | null> };
};

type HandoverLike = {
  agreementId: string | null;
  lead: { serviceInterest: string | null };
};

/**
 * The canonical service a finance handover represents — derived from the signed
 * agreement's TEMPLATE category (what the customer actually bought), falling back
 * to the lead's `serviceInterest` tag only for manual handovers that carry no
 * agreement, or an agreement on an unmapped template.
 *
 * This is the single source of truth for the Finance → Processing-vs-JR fork:
 * a JR client who signs a visit-visa agreement goes to Processing, and a
 * non-JR-tagged lead who signs a JR agreement goes to JR — because the routing
 * follows the paper, not the lead's (often stale) classification.
 */
export async function resolveHandoverService(
  prisma: AgreementLookupClient,
  handover: HandoverLike,
): Promise<string | null> {
  if (handover.agreementId) {
    const ag = await prisma.agreement.findUnique({
      where: { id: handover.agreementId },
      select: { templateId: true },
    });
    if (ag) {
      const tpl = await prisma.agreementTemplate.findUnique({
        where: { id: ag.templateId },
        select: { categoryKey: true },
      });
      const mapped = serviceForTemplateCategory(tpl?.categoryKey);
      if (mapped) return mapped;
    }
  }
  return handover.lead.serviceInterest ?? null;
}
