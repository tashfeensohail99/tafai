import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateExpenseDto } from './expenses.dto';

const num = (d: Prisma.Decimal | number | null | undefined): number =>
  d == null ? 0 : Number(d.toString());

/**
 * Per-client expense ledger — the cost side that pairs with invoices/payments
 * to give a margin. Decoupled model (plain leadId/clientId/caseId columns).
 * Expenses are soft-deleted (reversible), and an optional receipt of the spend
 * can be attached via the same storage path the handover receipts use.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Shape returned to the UI (Decimal → number). */
  private view(e: {
    id: string;
    category: string;
    description: string;
    amount: Prisma.Decimal;
    taxAmount?: Prisma.Decimal;
    currency: string;
    billable: boolean;
    incurredAt: Date;
    receiptFileName: string | null;
    receiptKey: string | null;
    createdAt: Date;
  }) {
    return {
      id: e.id,
      category: e.category,
      description: e.description,
      amount: num(e.amount),
      taxAmount: num(e.taxAmount),
      currency: e.currency,
      billable: e.billable,
      incurredAt: e.incurredAt,
      receiptFileName: e.receiptFileName,
      hasReceipt: !!e.receiptKey,
      createdAt: e.createdAt,
    };
  }

  async create(dto: CreateExpenseDto, actorUserId: string) {
    // Validate the lead and inherit its client link (if already converted) so
    // the expense follows the customer across the lead→client boundary.
    const lead = await this.prisma.lead.findUnique({
      where: { id: dto.leadId },
      select: { id: true, convertedClientId: true },
    });
    if (!lead) throw new NotFoundException('Customer (lead) not found');

    let receiptKey: string | null = null;
    let receiptMimeType: string | null = null;
    let receiptSizeBytes: number | null = null;
    if (dto.receiptContentBase64) {
      const buffer = Buffer.from(dto.receiptContentBase64, 'base64');
      const upload = await this.storage.upload(
        buffer,
        dto.receiptMimeType ?? 'application/octet-stream',
        'client-expenses',
        dto.receiptFileName ?? 'expense-receipt',
      );
      receiptKey = upload.key;
      receiptMimeType = dto.receiptMimeType ?? upload.mimeType;
      receiptSizeBytes = upload.sizeBytes;
    }

    const created = await this.prisma.expense.create({
      data: {
        leadId: dto.leadId,
        clientId: lead.convertedClientId,
        caseId: dto.caseId ?? null,
        category: dto.category ?? 'OTHER',
        description: dto.description,
        amount: dto.amount,
        taxAmount: dto.taxAmount ?? '0',
        currency: dto.currency ?? 'CAD',
        billable: dto.billable ?? false,
        incurredAt: dto.incurredAt ? new Date(dto.incurredAt) : new Date(),
        receiptKey,
        receiptFileName: dto.receiptFileName ?? null,
        receiptMimeType,
        receiptSizeBytes,
        createdByUserId: actorUserId,
      },
    });

    return this.view(created);
  }

  /** Soft-delete (reversible) — never a hard delete. */
  async remove(id: string, _actorUserId: string) {
    const existing = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Expense not found');
    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  }

  /** Signed URL to download an expense's attached receipt. */
  async getReceiptUrl(id: string) {
    const e = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      select: { receiptKey: true, receiptFileName: true },
    });
    if (!e?.receiptKey) throw new NotFoundException('No receipt on this expense');
    const url = await this.storage.getSignedUrl(e.receiptKey);
    return { url, fileName: e.receiptFileName ?? 'expense-receipt' };
  }
}
