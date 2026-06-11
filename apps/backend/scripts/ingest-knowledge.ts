/**
 * One-off knowledge-base ingestion: loads Q&A pairs from
 * scripts/knowledge-import.json into ai.knowledge with embeddings, through
 * the same KnowledgeService/OpenAiService path the admin editor uses (the
 * OpenAI key comes from the encrypted api-keys store, same as production).
 *
 * Run against production:  railway run npx ts-node -T scripts/ingest-knowledge.ts
 *
 * Idempotent: each entry's id is derived from a hash of its question, so
 * re-running updates rows instead of duplicating them.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import appConfig from '../src/config/app.config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { WhatsAppCryptoService } from '../src/modules/whatsapp/crypto/crypto.service';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service';
import { KnowledgeService } from '../src/modules/ai/knowledge.service';
import { OpenAiService } from '../src/modules/ai/openai.service';

/**
 * Minimal module: only the four services ingestion needs. The full AppModule
 * can't boot outside Railway — its BullMQ queues wait forever for
 * redis.railway.internal, which only resolves inside Railway's network.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [appConfig] })],
  providers: [
    PrismaService,
    WhatsAppCryptoService,
    ApiKeysService,
    OpenAiService,
    KnowledgeService,
  ],
})
class IngestModule {}

// The deployed app monopolizes the session-mode pooler (its connection_limit
// equals the pooler's entire pool_size), so any second client gets
// EMAXCONNSESSION. Route this script through the transaction-mode pooler
// (port 6543) with a single connection instead — fine for plain queries.
if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  u.port = '6543';
  u.search = '?pgbouncer=true&connection_limit=1';
  process.env.DATABASE_URL = u.toString();
}

interface ImportRow {
  queryEn: string;
  answerEn: string;
  answerUr: string | null;
  source: string;
}

function stableId(queryEn: string): string {
  const h = createHash('sha1').update(queryEn.toLowerCase().replace(/\W+/g, '')).digest('hex');
  return `xlsx-${h.slice(0, 32)}`;
}

async function main() {
  const rows: ImportRow[] = JSON.parse(
    readFileSync(join(__dirname, 'knowledge-import.json'), 'utf-8'),
  );
  const app = await NestFactory.createApplicationContext(IngestModule, {
    logger: ['error', 'warn'],
  });
  const knowledge = app.get(KnowledgeService);
  const openai = app.get(OpenAiService);

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const { embedding } = await openai.embed(
        [row.queryEn, row.answerEn].filter(Boolean).join('\n'),
      );
      await knowledge.upsert({
        id: stableId(row.queryEn),
        type: 'qa',
        programKey: null,
        queryEn: row.queryEn,
        queryUr: null,
        answerEn: row.answerEn,
        answerUr: row.answerUr,
        sourceFile: row.source,
        chunkIndex: null,
        embedding,
      });
      ok++;
      console.log(`[${ok}/${rows.length}] ${row.queryEn.slice(0, 60)}`);
    } catch (e) {
      failed++;
      console.error(`FAILED: ${row.queryEn.slice(0, 60)} — ${(e as Error).message}`);
    }
  }
  console.log(`\nDone: ${ok} ingested, ${failed} failed, ${rows.length} total.`);
  await app.close();
  process.exit(failed > 0 ? 1 : 0);
}

void main();
