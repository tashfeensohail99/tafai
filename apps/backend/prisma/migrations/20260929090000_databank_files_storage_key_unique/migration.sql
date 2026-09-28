-- A storage object backs at most ONE databank file row. commitDirectUpload
-- relies on it: two overlapping commits of one key (a retried commit whose
-- first reply was lost while the server was still recording it) can no longer
-- both insert — the second gets the first one's row.
--
-- Replaces the plain index from 20260928120000. Checked on production before
-- merging (read-only): no storageKey was held by more than one row.
DROP INDEX IF EXISTS "processing"."databank_files_storageKey_idx";

CREATE UNIQUE INDEX "databank_files_storageKey_key" ON "processing"."databank_files"("storageKey");
