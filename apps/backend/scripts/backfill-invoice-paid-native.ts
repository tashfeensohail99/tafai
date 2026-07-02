/**
 * PHASE 2 BACKFILL for the native-currency Invoice.paidAmount fix.
 *
 * BACKGROUND. Before the "native ledger" change, verifyPayment accumulated each
 * verified payment's CAD equivalent (baseAmount) into Invoice.paidAmount, so a
 * PKR agreement's paidAmount was stored as a small CAD number even though its
 * totalAmount/installments are native PKR. The new code stores paidAmount in the
 * invoice's OWN currency. This script rewrites every existing invoice's
 * paidAmount to that native value, recomputed from its verified (PAID/PARTIAL)
 * payments using the exact same rule the new verifyPayment uses.
 *
 * SAFETY. For a CAD invoice the native amount == the CAD base, so nothing
 * changes — the script is a no-op there and is fully idempotent (safe to run
 * repeatedly). Only genuinely non-CAD invoices are corrected. It also repairs
 * the invoice status (a fully-paid foreign invoice that was wrongly left
 * PARTIALLY_PAID because CAD-paid < native-total becomes PAID).
 *
 * DRY RUN by default — prints every proposed change and writes NOTHING. Read the
 * dry-run output first, then pass --apply to persist.
 *
 *   railway run --service backend -- npx ts-node -T scripts/backfill-invoice-paid-native.ts
 *   railway run --service backend -- npx ts-node -T scripts/backfill-invoice-paid-native.ts --apply
 */
import { PrismaClient, InvoiceStatus, PaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const n = (d: unknown): number => (d == null ? 0 : Number((d as { toString(): string }).toString()));
const r2 = (x: number): number => Math.round(x * 100) / 100;

(async () => {
  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      invoiceNumber: true,
      currency: true,
      totalAmount: true,
      paidAmount: true,
      status: true,
      // Only PAID/PARTIAL payments contribute to paidAmount — the same set
      // verifyPayment adds and refund/cancel removes.
      payments: {
        where: { status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] } },
        select: { amount: true, baseAmount: true, currency: true },
      },
    },
  });

  const rows: string[] = [];
  let changed = 0;
  let unchanged = 0;

  for (const inv of invoices) {
    // Identical rule to the new verifyPayment: apply each payment in the
    // invoice's own currency; only a genuine cross-currency payment (rare)
    // falls back to its stored CAD base.
    const nativePaid = r2(
      inv.payments.reduce((s, p) => {
        const applied =
          (p.currency ?? inv.currency) === inv.currency ? n(p.amount) : n(p.baseAmount ?? p.amount);
        return s + applied;
      }, 0),
    );
    const current = n(inv.paidAmount);
    const total = n(inv.totalAmount);
    const delta = r2(nativePaid - current);

    // Recompute the money-carrying status from the corrected native paid.
    let newStatus = inv.status;
    const active =
      inv.status === InvoiceStatus.SENT ||
      inv.status === InvoiceStatus.PARTIALLY_PAID ||
      inv.status === InvoiceStatus.PAID ||
      inv.status === InvoiceStatus.OVERDUE;
    if (inv.payments.length > 0 && active) {
      newStatus =
        nativePaid >= total - 0.005 ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
    }

    const statusChange = newStatus !== inv.status;
    if (Math.abs(delta) < 0.005 && !statusChange) {
      unchanged++;
      continue;
    }
    changed++;
    rows.push(
      `${inv.invoiceNumber}  ${inv.currency}  paid ${current} -> ${nativePaid} (Δ${delta})  total ${total}  ` +
        `status ${inv.status}${statusChange ? ' -> ' + newStatus : ''}  [${inv.payments.length} pmt]`,
    );

    if (APPLY) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { paidAmount: nativePaid.toString(), status: newStatus },
      });
    }
  }

  console.log(`\n=== Invoice paidAmount → native backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  console.log(`Scanned: ${invoices.length} | changed: ${changed} | unchanged: ${unchanged}\n`);
  for (const line of rows) console.log('  ' + line);
  if (rows.length === 0) {
    console.log('  (no invoices need correction — all paidAmount values already native)');
  }
  if (!APPLY && changed > 0) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to persist the ${changed} change(s) above.`);
  } else if (APPLY) {
    console.log(`\nAPPLIED ${changed} change(s).`);
  }
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
