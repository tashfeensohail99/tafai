-- Pending = "awaiting a human reply" (real WhatsApp semantics): the customer has
-- messaged more recently than the last MANUAL human reply. Bot replies, the
-- auto-ack, templates and campaigns (sentByEmployeeId IS NULL) do NOT count as a
-- reply. This replaces the SLA-clock (responseDeadlineAt) as the inbox "Pending"
-- signal so a chat can never get "stuck" pending after a sales reply.

ALTER TABLE "whatsapp"."threads"
  ADD COLUMN "lastCustomerMessageAt" TIMESTAMP(3),
  ADD COLUMN "lastHumanReplyAt"      TIMESTAMP(3),
  ADD COLUMN "awaitingReply"         BOOLEAN NOT NULL DEFAULT false;

-- Backfill the two source-of-truth timestamps from the full message history.
UPDATE "whatsapp"."threads" t SET
  "lastCustomerMessageAt" = sub.last_in,
  "lastHumanReplyAt"      = sub.last_human
FROM (
  SELECT
    m."threadId" AS tid,
    MAX(m."createdAt") FILTER (WHERE m."direction"::text = 'INBOUND') AS last_in,
    MAX(m."createdAt") FILTER (
      WHERE m."direction"::text = 'OUTBOUND' AND m."sentByEmployeeId" IS NOT NULL
    ) AS last_human
  FROM "whatsapp"."messages" m
  GROUP BY m."threadId"
) sub
WHERE t."id" = sub.tid;

-- Derive the pending flag: a customer message exists and is newer than the last
-- human reply (or no human has ever replied).
UPDATE "whatsapp"."threads" SET "awaitingReply" = (
  "lastCustomerMessageAt" IS NOT NULL
  AND ("lastHumanReplyAt" IS NULL OR "lastCustomerMessageAt" > "lastHumanReplyAt")
);

-- Index backing the inbox "Pending" tab (awaitingReply=true ordered by recency).
CREATE INDEX "threads_awaitingReply_lastMessageAt_idx"
  ON "whatsapp"."threads" ("awaitingReply", "lastMessageAt" DESC);
