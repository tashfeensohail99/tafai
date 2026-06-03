-- WhatsApp template department routing.
-- Tag each template with the department(s) allowed to pick it in the inbox
-- composer. Empty array = shared (visible to everyone). This is our own
-- metadata; Meta has no such concept, so the template-sync job preserves it.

CREATE TYPE "whatsapp"."WhatsAppTemplateDepartment" AS ENUM ('SALES', 'FINANCE', 'PROCESSING');

ALTER TABLE "whatsapp"."templates"
  ADD COLUMN "departments" "whatsapp"."WhatsAppTemplateDepartment"[] NOT NULL
  DEFAULT ARRAY[]::"whatsapp"."WhatsAppTemplateDepartment"[];
