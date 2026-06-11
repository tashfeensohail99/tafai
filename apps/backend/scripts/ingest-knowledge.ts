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
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { KnowledgeService } from '../src/modules/ai/knowledge.service';
import { OpenAiService } from '../src/modules/ai/openai.service';

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
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
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
