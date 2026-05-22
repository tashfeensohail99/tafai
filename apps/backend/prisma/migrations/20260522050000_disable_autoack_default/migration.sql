-- Auto-acknowledgement disabled by default (ops decision). Flip the column
-- default off, and turn it off on every existing org row. Re-enabling later
-- is a single UPDATE ... SET "autoAckEnabled" = true (the feature code stays).
ALTER TABLE "core"."organizations" ALTER COLUMN "autoAckEnabled" SET DEFAULT false;
UPDATE "core"."organizations" SET "autoAckEnabled" = false;
