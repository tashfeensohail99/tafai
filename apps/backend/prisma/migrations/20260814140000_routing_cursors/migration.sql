-- Per-desk round-robin cursors.
--
-- Organization.rrCursorEmployeeId is a SINGLE round-robin pointer shared by
-- every pool and every channel. For a small ad sub-team (e.g. the Lahore desk)
-- that pointer keeps landing "past" the desk, so the pick collapses to the same
-- lowest-id member and the rest are starved. This table gives each ad sub-team
-- its OWN cursor, keyed by a stable hash of the desk's eligible membership, so
-- each desk rotates person-to-person on its own. The default (non-ad) pool
-- keeps using Organization.rrCursorEmployeeId.
--
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS "crm"."routing_cursors" (
    "poolKey" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "routing_cursors_pkey" PRIMARY KEY ("poolKey")
);
