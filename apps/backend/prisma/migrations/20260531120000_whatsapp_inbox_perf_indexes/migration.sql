-- WhatsApp inbox performance indexes.
--
-- The inbox list + stats endpoints filter/sort on columns that previously had
-- no covering index, forcing sequential scans + in-memory sorts that got
-- slower as the thread/message volume grew. These three additive indexes fix
-- the hot paths:
--
--   1. lastMessageAt  — the default "ALL" tab orders by this with no status
--      filter, so the existing [status, lastMessageAt] composite can't serve
--      the sort. A standalone descending index does.
--
--   2. responseDeadlineAt — the /stats endpoint counts this THREE ways on
--      every load (awaiting-reply / overdue / approaching) and the inbox
--      "Pending" tab filters on it. Was a full scan each time.
--
--   3. unreadCount — feeds the stats "unread" count + the unread badge filter.
--
-- All three are CREATE INDEX IF NOT EXISTS (idempotent, additive — no data
-- change, no column change). The threads table is small enough that the brief
-- build lock is negligible.

CREATE INDEX IF NOT EXISTS "threads_lastMessageAt_idx"
  ON "whatsapp"."threads" ("lastMessageAt" DESC);

CREATE INDEX IF NOT EXISTS "threads_responseDeadlineAt_idx"
  ON "whatsapp"."threads" ("responseDeadlineAt");

CREATE INDEX IF NOT EXISTS "threads_unreadCount_idx"
  ON "whatsapp"."threads" ("unreadCount");
