import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OpenAiService } from './openai.service';

export interface KnowledgeMatch {
  id: string;
  type: string;
  programKey: string | null;
  queryEn: string | null;
  queryUr: string | null;
  answerEn: string;
  answerUr: string | null;
  sourceFile: string;
  /** Cosine similarity in [0,1] — higher = closer match. */
  similarity: number;
}

/** A knowledge row WITHOUT the embedding — for the admin editor list/detail. */
export interface AdminKnowledgeRow {
  id: string;
  type: string;
  programKey: string | null;
  queryEn: string | null;
  queryUr: string | null;
  answerEn: string;
  answerUr: string | null;
  sourceFile: string;
  chunkIndex: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * pgvector-backed RAG retrieval over the `ai.knowledge` table. Prisma can't
 * model `vector` columns natively so we use $queryRawUnsafe for the cosine
 * search; everything else (upsert, count) goes through Prisma normally via
 * the embedding-less metadata fields.
 */
@Injectable()
export class KnowledgeService {
  private readonly log = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openai: OpenAiService,
  ) {}

  /** Total rows in the knowledge base. Used by the admin health screen. */
  async count(): Promise<number> {
    return this.prisma.aiKnowledge.count();
  }

  /**
   * Semantic top-K search. Embeds the query, runs cosine search in pgvector,
   * returns the K nearest rows with normalized similarity. `<=>` is the
   * pgvector cosine *distance* operator (lower = closer); similarity = 1 - d.
   */
  async search(query: string, topK = 5): Promise<KnowledgeMatch[]> {
    const { embedding } = await this.openai.embed(query);
    const vec = `[${embedding.join(',')}]`;
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        type: string;
        programKey: string | null;
        queryEn: string | null;
        queryUr: string | null;
        answerEn: string;
        answerUr: string | null;
        sourceFile: string;
        distance: number;
      }>
    >(
      `SELECT id, type, "programKey", "queryEn", "queryUr", "answerEn", "answerUr", "sourceFile",
              embedding <=> $1::vector AS distance
         FROM ai.knowledge
        ORDER BY embedding <=> $1::vector ASC
        LIMIT $2`,
      vec,
      topK,
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      programKey: r.programKey,
      queryEn: r.queryEn,
      queryUr: r.queryUr,
      answerEn: r.answerEn,
      answerUr: r.answerUr,
      sourceFile: r.sourceFile,
      similarity: 1 - Number(r.distance ?? 1),
    }));
  }

  /**
   * Upsert (raw SQL — we need to set the vector column). Used by the
   * ingestion script.
   */
  async upsert(input: {
    id?: string;
    type: 'qa' | 'brochure_chunk' | 'company_profile';
    programKey: string | null;
    queryEn: string | null;
    queryUr: string | null;
    answerEn: string;
    answerUr: string | null;
    sourceFile: string;
    chunkIndex: number | null;
    embedding: number[];
  }): Promise<string> {
    const id = input.id ?? cryptoRandomId();
    const vec = `[${input.embedding.join(',')}]`;
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO ai.knowledge (id, type, "programKey", "queryEn", "queryUr", "answerEn", "answerUr", "sourceFile", "chunkIndex", embedding, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type,
         "programKey" = EXCLUDED."programKey",
         "queryEn" = EXCLUDED."queryEn",
         "queryUr" = EXCLUDED."queryUr",
         "answerEn" = EXCLUDED."answerEn",
         "answerUr" = EXCLUDED."answerUr",
         "sourceFile" = EXCLUDED."sourceFile",
         "chunkIndex" = EXCLUDED."chunkIndex",
         embedding = EXCLUDED.embedding,
         "updatedAt" = NOW()`,
      id,
      input.type,
      input.programKey,
      input.queryEn,
      input.queryUr,
      input.answerEn,
      input.answerUr,
      input.sourceFile,
      input.chunkIndex,
      vec,
    );
    return id;
  }

  // ── Admin editor (manual curation of the knowledge base) ──────────────────

  private readonly ADMIN_SELECT =
    `SELECT id, type, "programKey", "queryEn", "queryUr", "answerEn", "answerUr", "sourceFile", "chunkIndex", "createdAt", "updatedAt" FROM ai.knowledge`;

  /** List entries (metadata only — never the embedding). Optional text search. */
  async listEntries(opts: { search?: string; limit?: number } = {}): Promise<AdminKnowledgeRow[]> {
    const limit = Math.min(Math.max(opts.limit ?? 300, 1), 500);
    const q = (opts.search ?? '').trim();
    if (q) {
      return this.prisma.$queryRawUnsafe<AdminKnowledgeRow[]>(
        `${this.ADMIN_SELECT}
          WHERE "queryEn" ILIKE $1 OR "answerEn" ILIKE $1
             OR COALESCE("programKey",'') ILIKE $1 OR COALESCE("answerUr",'') ILIKE $1
          ORDER BY "updatedAt" DESC LIMIT $2`,
        `%${q}%`,
        limit,
      );
    }
    return this.prisma.$queryRawUnsafe<AdminKnowledgeRow[]>(
      `${this.ADMIN_SELECT} ORDER BY "updatedAt" DESC LIMIT $1`,
      limit,
    );
  }

  /** Single entry by id (no embedding), or null. */
  async getEntry(id: string): Promise<AdminKnowledgeRow | null> {
    const rows = await this.prisma.$queryRawUnsafe<AdminKnowledgeRow[]>(
      `${this.ADMIN_SELECT} WHERE id = $1 LIMIT 1`,
      id,
    );
    return rows[0] ?? null;
  }

  /**
   * Create/update a hand-curated Q&A entry. Embeds question + answer together
   * so an inbound message matches on either the phrasing or the answer's
   * keywords. Stamped type='qa', sourceFile='admin' to distinguish curated
   * rows from the bulk-ingested corpus.
   */
  async saveEntry(input: {
    id?: string;
    programKey?: string | null;
    queryEn: string;
    answerEn: string;
    answerUr?: string | null;
  }): Promise<string> {
    const queryEn = (input.queryEn ?? '').trim();
    const answerEn = (input.answerEn ?? '').trim();
    const { embedding } = await this.openai.embed([queryEn, answerEn].filter(Boolean).join('\n'));
    return this.upsert({
      id: input.id,
      type: 'qa',
      programKey: input.programKey?.trim() || null,
      queryEn,
      queryUr: null,
      answerEn,
      answerUr: input.answerUr?.trim() || null,
      sourceFile: 'admin',
      chunkIndex: null,
      embedding,
    });
  }

  /** Permanently delete an entry. */
  async deleteEntry(id: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(`DELETE FROM ai.knowledge WHERE id = $1`, id);
  }
}

function cryptoRandomId(): string {
  // Node 18+ has crypto.randomUUID globally.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('node:crypto').randomUUID();
}
