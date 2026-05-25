import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type DocumentSeries = 'INV' | 'RCP' | 'SC' | 'AGR';

/**
 * Monotonic, gapless per-year document numbers (INV/RCP/SC/AGR), backed by the
 * finance.document_sequences counter. Unlike a row COUNT(), the counter never
 * decrements when a document is voided/removed — so each number is issued
 * exactly once and never re-used. The increment is a single atomic statement
 * (INSERT … ON CONFLICT … RETURNING), so it's safe under concurrency.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly prisma: PrismaService) {}

  async next(series: DocumentSeries, year: number = new Date().getUTCFullYear()): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ lastValue: number }>>`
      INSERT INTO "finance"."document_sequences" ("series", "year", "lastValue")
      VALUES (${series}, ${year}, 1)
      ON CONFLICT ("series", "year")
      DO UPDATE SET "lastValue" = "finance"."document_sequences"."lastValue" + 1
      RETURNING "lastValue"`;
    const n = Number(rows[0].lastValue);
    return `${series}-${year}-${String(n).padStart(5, '0')}`;
  }
}
