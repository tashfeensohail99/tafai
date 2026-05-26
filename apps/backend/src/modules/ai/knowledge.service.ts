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
}

function cryptoRandomId(): string {
  // Node 18+ has crypto.randomUUID globally.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require('node:crypto').randomUUID();
}
