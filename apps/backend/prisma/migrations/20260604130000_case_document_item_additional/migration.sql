-- "Additional Documents": flag client/officer-uploaded extra documents that
-- aren't part of the template checklist, so they can be grouped + surfaced
-- separately on the portal and processing Documents tab.
ALTER TABLE "processing"."case_document_items"
  ADD COLUMN "isAdditional" BOOLEAN NOT NULL DEFAULT false;
