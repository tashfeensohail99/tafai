-- Quick replies: saved chat snippets for the WhatsApp composer. Distinct from
-- Meta templates (pre-approved forms for outside the 24h window) — these are
-- ordinary session text a rep inserts into the typing box. ownerUserId NULL
-- means team-wide (admin-managed); otherwise the snippet is personal.

CREATE TABLE "crm"."quick_replies" (
  "id"          TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "ownerUserId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "quick_replies_ownerUserId_idx" ON "crm"."quick_replies" ("ownerUserId");
