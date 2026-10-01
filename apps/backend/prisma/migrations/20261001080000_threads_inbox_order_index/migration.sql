-- Composite index matching the inbox list()'s DEFAULT ORDER BY exactly
-- (awaitingReply DESC, lastHumanActivityAt DESC NULLS LAST, lastMessageAt DESC
-- NULLS LAST, createdAt DESC, id DESC) so the hottest query in the CRM is a
-- top-N index walk (EXPLAIN: 142ms seq-scan+sort -> 1.5ms) instead of sorting
-- all ~58k threads per page.
--
-- Already created CONCURRENTLY on prod on 2026-10-01 for immediate relief, so
-- IF NOT EXISTS makes this a no-op there; on a fresh database the plain build
-- is fine (small table at bootstrap). NOTE: the schema.prisma @@index entry for
-- "threads_inbox_order_idx" cannot express NULLS LAST — THIS definition is the
-- authoritative one.
CREATE INDEX IF NOT EXISTS "threads_inbox_order_idx"
  ON "whatsapp"."threads" ("awaitingReply" DESC, "lastHumanActivityAt" DESC NULLS LAST,
                           "lastMessageAt" DESC NULLS LAST, "createdAt" DESC, id DESC);
