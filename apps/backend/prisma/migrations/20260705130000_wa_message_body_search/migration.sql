-- Message-content search: accelerate ILIKE '%term%' over message bodies so the
-- inbox can find chats by what was *said* (not just the contact name).
--
-- Wrapped in a DO block with an exception guard so a missing/blocked pg_trgm
-- extension can NEVER fail the deploy: the search feature works WITHOUT this
-- index (it just falls back to a sequential scan), so the trigram index is a
-- pure performance optimization, not a correctness requirement.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS "messages_body_trgm_idx"
    ON "whatsapp"."messages"
    USING gin ("body" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm body index skipped (search still works, unindexed): %', SQLERRM;
END $$;
