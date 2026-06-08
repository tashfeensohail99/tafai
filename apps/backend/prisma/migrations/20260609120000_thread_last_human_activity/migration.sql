-- "Last human activity" = the most recent REAL conversation event: an inbound
-- customer message OR a manual human (rep) reply. Bot replies, the auto-ack,
-- templates and campaigns (sentByEmployeeId IS NULL) never count. The inbox
-- sorts by this so the freshest real chat is on top, while the bot's "just
-- checking in" nudges — which bump lastMessageAt — can neither push a chat up
-- nor bury a real reply that still needs answering.

ALTER TABLE "whatsapp"."threads" ADD COLUMN "lastHumanActivityAt" TIMESTAMP(3);

-- Backfill = MAX of the two existing human-activity timestamps (both already
-- maintained, neither touched by the bot). GREATEST ignores NULLs in Postgres
-- and is NULL only when both are NULL (a chat with only a bot greeting).
UPDATE "whatsapp"."threads" SET
  "lastHumanActivityAt" = GREATEST("lastCustomerMessageAt", "lastHumanReplyAt");

-- Index backing the inbox primary sort (lastHumanActivityAt DESC).
CREATE INDEX "threads_lastHumanActivityAt_idx"
  ON "whatsapp"."threads" ("lastHumanActivityAt" DESC);
