-- Enable the pgvector extension on Supabase (idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

-- Dedicated `ai` schema so the bot's tables don't clutter the core/crm/finance
-- namespaces. Prisma's multi-schema is already in use.
CREATE SCHEMA IF NOT EXISTS "ai";

-- ─── Knowledge base for the RAG bot ─────────────────────────────────────────
-- One row per indexed unit (Q&A pair OR brochure chunk). `embedding` is a
-- 1536-dim vector from OpenAI text-embedding-3-small.
CREATE TABLE "ai"."knowledge" (
  "id"            TEXT PRIMARY KEY,
  "type"          TEXT NOT NULL,           -- 'qa' | 'brochure_chunk' | 'company_profile'
  "programKey"    TEXT,                    -- 'C11' | 'ICT' | 'SUV' | 'EB2_NIW' | 'RCIP' | 'LMIA' | 'JR' | 'E2' | 'VISIT' | NULL
  "queryEn"       TEXT,                    -- the English question (for 'qa') OR the search text for chunks
  "queryUr"       TEXT,                    -- Roman Urdu question if available
  "answerEn"      TEXT NOT NULL,           -- the canonical content fed to GPT as context
  "answerUr"      TEXT,                    -- Roman Urdu answer if available
  "sourceFile"    TEXT NOT NULL,           -- e.g. 'AI QUESTION & ANSWER (PART-2).xlsx' / 'Visit visa Brochure.pdf'
  "chunkIndex"    INTEGER,                 -- which chunk within a multi-chunk source
  "embedding"     vector(1536) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ai_knowledge_type_idx"        ON "ai"."knowledge" ("type");
CREATE INDEX "ai_knowledge_program_idx"     ON "ai"."knowledge" ("programKey");
-- IVFFlat cosine index for fast top-K retrieval. Build with lists=100 (default
-- works well up to ~10k rows; bump if corpus grows past that).
CREATE INDEX "ai_knowledge_embedding_idx"   ON "ai"."knowledge"
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- ─── AI suggestions in SHADOW mode ──────────────────────────────────────────
-- When business hours are open AND a sales agent is online, the bot writes
-- here instead of sending — sales sees the suggestion above the composer.
CREATE TABLE "ai"."suggestions" (
  "id"                  TEXT PRIMARY KEY,
  "threadId"            TEXT NOT NULL,
  "inboundMessageId"    TEXT NOT NULL,
  "suggestedReply"      TEXT NOT NULL,
  "language"            TEXT NOT NULL,            -- 'en' | 'ur_roman' | 'ur' | 'other'
  "topMatchType"        TEXT,                     -- 'qa' / 'brochure_chunk' / etc
  "topMatchSourceFile"  TEXT,
  "topMatchSimilarity"  DOUBLE PRECISION,
  "retrievedDocIds"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"              TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | USED | EDITED | REJECTED | EXPIRED
  "usedByUserId"        TEXT,
  "usedAt"              TIMESTAMP(3),
  "model"               TEXT NOT NULL,            -- e.g. 'gpt-4o-mini'
  "inputTokens"         INTEGER,
  "outputTokens"        INTEGER,
  "latencyMs"           INTEGER,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ai_suggestions_thread_idx" ON "ai"."suggestions" ("threadId", "createdAt" DESC);
CREATE INDEX "ai_suggestions_status_idx" ON "ai"."suggestions" ("status");

-- ─── AI run log (every dispatch, auto OR shadow) ────────────────────────────
-- Audit trail + cost tracking. One row per inbound message the bot saw.
CREATE TABLE "ai"."runs" (
  "id"                  TEXT PRIMARY KEY,
  "threadId"            TEXT NOT NULL,
  "inboundMessageId"    TEXT NOT NULL UNIQUE,
  "mode"                TEXT NOT NULL,            -- AUTO | SHADOW | SKIPPED
  "skipReason"          TEXT,                     -- when mode=SKIPPED
  "language"            TEXT,
  "model"               TEXT,
  "inputTokens"         INTEGER,
  "outputTokens"        INTEGER,
  "totalLatencyMs"      INTEGER,
  "topMatchSimilarity"  DOUBLE PRECISION,
  "outboundMessageId"   TEXT,                     -- when mode=AUTO and we sent
  "suggestionId"        TEXT,                     -- when mode=SHADOW
  "error"               TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ai_runs_thread_idx" ON "ai"."runs" ("threadId", "createdAt" DESC);
CREATE INDEX "ai_runs_mode_idx"   ON "ai"."runs" ("mode", "createdAt" DESC);
