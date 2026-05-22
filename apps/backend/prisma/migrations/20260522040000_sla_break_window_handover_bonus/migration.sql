-- Mid-day break window + Mon–Fri working week + finance-handover SLA bonus.

-- New org config columns. Defaults seed Tashfeen's 12:30–14:00 lunch and a
-- 5-win handover bonus; the @default also covers any future org rows.
ALTER TABLE "core"."organizations"
  ADD COLUMN "breakStart"       TEXT    DEFAULT '12:30',
  ADD COLUMN "breakEnd"         TEXT    DEFAULT '14:00',
  ADD COLUMN "slaHandoverBonus" INTEGER NOT NULL DEFAULT 5;

-- Existing org rows were created with workingDays = Mon–Sat. The team is
-- actually Mon–Fri (Sat + Sun off), so correct existing rows. Also make sure
-- the break columns are populated on rows that pre-date the ADD COLUMN
-- default application (defensive — ADD COLUMN ... DEFAULT already backfills).
UPDATE "core"."organizations"
SET "workingDays" = ARRAY[1, 2, 3, 4, 5],
    "breakStart"  = COALESCE("breakStart", '12:30'),
    "breakEnd"    = COALESCE("breakEnd", '14:00');
