-- Response-SLA (pause-on-customer) + auto-acknowledgement + agent SLA scoring.
--
-- Org-level config: a unified 5-minute Response-SLA target, warn-before
-- window, the breach-deterrent threshold, and the auto-ack toggle + template.
ALTER TABLE "core"."organizations"
  ADD COLUMN "slaResponseSeconds"   INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN "slaWarnBeforeSeconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "slaReassignThreshold" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "autoAckEnabled"       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autoAckTemplate"      TEXT;

-- Seed the default auto-ack copy (option A the user approved).
UPDATE "core"."organizations"
SET "autoAckTemplate" = 'Hey {firstName}! 🌟 I''m {agentName} from {businessName} — you''re in good hands. I''ve got your message and I''m right with you, give me just a moment! ✨'
WHERE "autoAckTemplate" IS NULL;

-- Thread-level rolling response clock + auto-ack bookkeeping.
ALTER TABLE "whatsapp"."threads"
  ADD COLUMN "responseDeadlineAt" TIMESTAMP(3),
  ADD COLUMN "responseDueSince"   TIMESTAMP(3),
  ADD COLUMN "responseWarned"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "responseBreached"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoAckSentAt"      TIMESTAMP(3);

-- Index the deadline so the 60s sweeper can cheaply find pending threads.
CREATE INDEX "threads_responseDeadlineAt_idx"
  ON "whatsapp"."threads" ("responseDeadlineAt");

-- Employee response-SLA tallies (score = met / (met + breached) * 100).
ALTER TABLE "core"."employees"
  ADD COLUMN "slaResponsesMet"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "slaResponsesBreached" INTEGER NOT NULL DEFAULT 0;
