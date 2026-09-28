-- Databank P2: file metadata (description/tags/customFields) + a generated
-- full-text search vector and indexes. The pg_trgm index is a pure perf
-- optimization guarded so a missing extension can never fail the deploy.
ALTER TABLE "processing"."databank_files"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "customFields" JSONB;

ALTER TABLE "processing"."databank_files"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("fileName", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
    setweight(to_tsvector('simple', array_to_string("tags", ' ')), 'A')
  ) STORED;

CREATE INDEX "databank_files_search_idx"
  ON "processing"."databank_files" USING gin ("searchVector");

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "databank_files_filename_trgm_idx"
    ON "processing"."databank_files" USING gin ("fileName" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm filename index skipped (search still works, unindexed): %', SQLERRM;
END $$;
