/**
 * One-off: shift all active appointments whose date falls on/before 31 May
 * 2026 PKT (the Eid holiday window) forward into June, then notify the
 * client on WhatsApp (best-effort, only within the 24h window) and create an
 * in-app notification for the assigned sales employee.
 *
 * Shift policy: +7 days minimum, then bump 1 day at a time until the new
 * scheduledAt is on/after 2026-06-01 00:00 Asia/Karachi. This preserves
 * the original time-of-day, and for late-May appointments preserves the
 * day-of-week too (e.g. Thu 28 May 3pm → Thu 4 Jun 3pm).
 *
 * SAFETY:
 *   - Default mode is DRY RUN — no DB writes. Pass `--apply` to execute.
 *   - Only touches status IN (SCHEDULED, CONFIRMED). Completed / cancelled /
 *     no-show / already-rescheduled appointments are left alone.
 *   - Uses a transaction per appointment so a hiccup mid-run can't leave the
 *     row half-updated.
 *
 * Run:
 *   cd apps/backend
 *   # dry run (always do this first):
 *   railway run --service backend --environment production -- \
 *     npx ts-node prisma/reschedule-eid-appointments.ts
 *   # real:
 *   railway run --service backend --environment production -- \
 *     npx ts-node prisma/reschedule-eid-appointments.ts --apply
 *
 *   Add --no-notify to skip WhatsApp + in-app notifications (DB shift only).
 */
import { randomUUID } from 'node:crypto';
import {
  AppointmentStatus,
  PrismaClient,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  Prisma,
} from '@prisma/client';
import { Queue } from 'bullmq';

const APPLY = process.argv.includes('--apply');
const SKIP_NOTIFY = process.argv.includes('--no-notify');

// 2026-06-01 00:00 Asia/Karachi (PKT = UTC+5). Anything scheduled BEFORE this
// instant gets shifted; the new date is forced to be on or after this instant.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const FLOOR = new Date(Date.UTC(2026, 5, 1, 0, 0, 0) - PKT_OFFSET_MS); // 2026-05-31T19:00Z

const DAY = 24 * 60 * 60 * 1000;
const QUEUE_NAME = 'whatsapp-outbound-message';

function computeNewDate(scheduledAt: Date): Date {
  let next = new Date(scheduledAt.getTime() + 7 * DAY);
  while (next.getTime() < FLOOR.getTime()) {
    next = new Date(next.getTime() + DAY);
  }
  return next;
}

function fmtPkt(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

function composeRescheduleMessage(
  firstName: string | null,
  oldDate: Date,
  newDate: Date,
): string {
  const greet = firstName ? `Hi ${firstName},` : 'Hi,';
  return [
    `${greet} Eid Mubarak!`,
    '',
    `Due to the Eid holidays we had to reschedule the consultation that was set for ${fmtPkt(oldDate)} PKT.`,
    `Your new slot: ${fmtPkt(newDate)} PKT.`,
    '',
    `If this new time doesn't suit, just reply here and I'll find another. — Tashfeen Immigration`,
  ].join('\n');
}

function makeOutboundQueue(): Queue | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const u = new URL(url);
  return new Queue(QUEUE_NAME, {
    connection: {
      host: u.hostname,
      port: parseInt(u.port || '6379', 10),
      ...(u.password ? { password: u.password } : {}),
      ...(u.username && u.username !== 'default' ? { username: u.username } : {}),
      // BullMQ requires this for blocking commands.
      maxRetriesPerRequest: null,
    },
  });
}

async function main() {
  const prisma = new PrismaClient();
  const outboundQueue = APPLY && !SKIP_NOTIFY ? makeOutboundQueue() : null;

  const affected = await prisma.appointment.findMany({
    where: {
      scheduledAt: { lt: FLOOR },
      status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
    },
    orderBy: { scheduledAt: 'asc' },
    select: {
      id: true,
      title: true,
      appointmentType: true,
      scheduledAt: true,
      status: true,
      assignedEmployeeId: true,
      leadId: true,
      clientId: true,
      lead: { select: { firstName: true, lastName: true, phone: true } },
      client: { select: { firstName: true, lastName: true, phone: true } },
    },
  });

  console.log(
    `\n  Eid reschedule — found ${affected.length} active appointment(s) with scheduledAt < 1 Jun 2026 PKT.`,
  );
  console.log(`  Mode: ${APPLY ? 'APPLY (DB writes ON)' : 'DRY RUN (no writes)'}`);
  console.log(`  Notifications: ${APPLY && !SKIP_NOTIFY ? 'enabled (best-effort)' : 'OFF'}\n`);

  let shifted = 0;
  let waSent = 0;
  let waSkipped = 0;
  let notif = 0;

  for (const a of affected) {
    const oldDate = a.scheduledAt;
    const newDate = computeNewDate(oldDate);
    const personName =
      (a.client?.firstName || a.client?.lastName)
        ? `${a.client?.firstName ?? ''} ${a.client?.lastName ?? ''}`.trim()
        : (a.lead?.firstName || a.lead?.lastName)
        ? `${a.lead?.firstName ?? ''} ${a.lead?.lastName ?? ''}`.trim()
        : '(no person)';

    console.log(
      `   • ${a.id.slice(0, 8)}  ${personName.padEnd(28)}  ${fmtPkt(oldDate)}  →  ${fmtPkt(newDate)}`,
    );

    if (!APPLY) continue;

    // Live: update + (best-effort) notify in a single transaction per row.
    // The WhatsApp queue.add is outside the tx because BullMQ doesn't enrol
    // in Prisma transactions — the row update is the source of truth.
    let waMessageId: string | null = null;
    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: a.id },
        data: { scheduledAt: newDate },
      });

      if (SKIP_NOTIFY) return;

      // Client WhatsApp — only if there's an active thread AND the 24h window
      // is still open. Outside the window, skip with a log so the agent knows
      // to send a template manually.
      const phone = a.lead?.phone ?? a.client?.phone ?? null;
      if (phone) {
        const thread = await tx.whatsAppThread.findFirst({
          where: {
            ...(a.leadId ? { leadId: a.leadId } : {}),
            ...(!a.leadId && a.clientId ? { clientId: a.clientId } : {}),
          },
          orderBy: { lastMessageAt: 'desc' },
          select: {
            id: true,
            channelId: true,
            leadId: true,
            clientId: true,
            windowExpiresAt: true,
          },
        });
        const windowOpen =
          !!thread?.windowExpiresAt && thread.windowExpiresAt.getTime() > Date.now();
        if (thread && windowOpen) {
          const firstName = a.lead?.firstName ?? a.client?.firstName ?? null;
          const body = composeRescheduleMessage(firstName, oldDate, newDate);
          const msg = await tx.whatsAppMessage.create({
            data: {
              threadId: thread.id,
              channelId: thread.channelId,
              leadId: thread.leadId,
              clientId: thread.clientId,
              direction: WhatsAppMessageDirection.OUTBOUND,
              type: WhatsAppMessageType.TEXT,
              status: WhatsAppMessageStatus.QUEUED,
              body,
              idempotencyKey: randomUUID(),
              payload: {
                source: 'eid_reschedule_script',
                appointmentId: a.id,
              } as unknown as Prisma.InputJsonValue,
            },
            select: { id: true },
          });
          waMessageId = msg.id;
        }
      }

      // Sales employee in-app notification. assignedEmployeeId → Employee.userId.
      if (a.assignedEmployeeId) {
        const emp = await tx.employee.findUnique({
          where: { id: a.assignedEmployeeId },
          select: { userId: true },
        });
        if (emp?.userId) {
          await tx.notification.create({
            data: {
              userId: emp.userId,
              type: 'APPOINTMENT_RESCHEDULED',
              title: `Eid reschedule: ${personName}`,
              body: `${a.appointmentType.toLowerCase().replace(/_/g, ' ')} moved from ${fmtPkt(oldDate)} → ${fmtPkt(newDate)} PKT.`,
              link: `/sales/appointments?focusId=${a.id}`,
            },
          });
          notif++;
        }
      }
    });
    shifted++;

    // Enqueue the WhatsApp send AFTER the transaction commits (the worker
    // expects the message row to exist when it picks the job up).
    if (waMessageId && outboundQueue) {
      try {
        await outboundQueue.add(
          'send',
          { messageId: waMessageId },
          { jobId: waMessageId },
        );
        waSent++;
      } catch (e) {
        console.log(`     [enqueue failed for ${waMessageId}: ${String(e)}]`);
        waSkipped++;
      }
    } else if (!SKIP_NOTIFY) {
      waSkipped++;
    }
  }

  console.log();
  console.log(`  Summary:`);
  console.log(`    Found:             ${affected.length}`);
  console.log(`    Shifted in DB:     ${APPLY ? shifted : 0}`);
  console.log(`    WhatsApp enqueued: ${APPLY && !SKIP_NOTIFY ? waSent : 0}`);
  console.log(`    WhatsApp skipped:  ${APPLY && !SKIP_NOTIFY ? waSkipped : 0}  (no thread / window closed / no phone)`);
  console.log(`    In-app notifs:     ${APPLY && !SKIP_NOTIFY ? notif : 0}`);
  console.log();
  if (!APPLY) {
    console.log(`  This was a DRY RUN. Re-run with --apply to execute.`);
  }

  if (outboundQueue) await outboundQueue.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
