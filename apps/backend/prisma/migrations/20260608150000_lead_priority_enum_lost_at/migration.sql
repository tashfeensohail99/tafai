-- Lead.priority String -> LeadPriority enum (HOT/WARM/COLD — the field is the
-- lead "temperature"), and add Lead.lostAt.
--
-- The in-place column type change uses a defensive USING cast: it upper-cases +
-- trims the existing text and maps only the three known labels, NULLing anything
-- unexpected — so it cannot fail on dirty data. Verified prod values before
-- writing this: HOT/WARM/COLD/null only, so no real value is lost.

DO $$ BEGIN
  CREATE TYPE "crm"."LeadPriority" AS ENUM ('HOT', 'WARM', 'COLD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "crm"."leads"
  ALTER COLUMN "priority" TYPE "crm"."LeadPriority"
  USING (
    CASE UPPER(NULLIF(TRIM("priority"), ''))
      WHEN 'HOT' THEN 'HOT'
      WHEN 'WARM' THEN 'WARM'
      WHEN 'COLD' THEN 'COLD'
      ELSE NULL
    END::"crm"."LeadPriority"
  );

ALTER TABLE "crm"."leads" ADD COLUMN IF NOT EXISTS "lostAt" TIMESTAMP(3);
