-- Per-employee WhatsApp inbox pins (pin a chat to the top of MY inbox).
-- Personal + capped at 6 in the service. See model WhatsAppThreadPin.
CREATE TABLE "whatsapp"."thread_pins" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_pins_pkey" PRIMARY KEY ("id")
);

-- One pin per (thread, employee); "my pins" lookup keys off employeeId.
CREATE UNIQUE INDEX "thread_pins_threadId_employeeId_key" ON "whatsapp"."thread_pins"("threadId", "employeeId");
CREATE INDEX "thread_pins_employeeId_idx" ON "whatsapp"."thread_pins"("employeeId");

ALTER TABLE "whatsapp"."thread_pins"
    ADD CONSTRAINT "thread_pins_threadId_fkey" FOREIGN KEY ("threadId")
    REFERENCES "whatsapp"."threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp"."thread_pins"
    ADD CONSTRAINT "thread_pins_employeeId_fkey" FOREIGN KEY ("employeeId")
    REFERENCES "core"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
