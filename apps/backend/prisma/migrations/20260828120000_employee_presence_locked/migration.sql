-- "Pause new leads" switch for a sales rep. When true the employee is pinned
-- OFFLINE and excluded from every NEW-lead round-robin pool, while keeping the
-- leads already assigned to them. Additive, defaults false → no existing rep is
-- affected until an admin flips it.
ALTER TABLE "core"."employees"
  ADD COLUMN "presenceLocked" BOOLEAN NOT NULL DEFAULT false;
