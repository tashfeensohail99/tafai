import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus, AuditAction, LeadStatus, TimelineEventType, WhatsAppThreadStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ActivityTimelineService } from '../activity-timeline/activity-timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppointmentBookingService } from './appointment-booking.service';
import {
  WhatsAppAppointmentNotifierService,
  type AppointmentConfirmationResult,
} from '../whatsapp/notifications/appointment-notifier.service';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './appointments.dto';
import {
  appointmentEnd,
  computeFreeSlots,
  intervalsOverlap,
  pktWorkingWindowUtc,
  type Interval,
} from './appointments.util';
import { RequestUser } from '../../common/types/auth.types';

// Office-hours backfill (PKT = UTC+5, no DST) — computed explicitly so it's
// correct regardless of the process timezone. Window: [09:00, 18:00) PKT.
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const OFFICE_OPEN_HOUR = 9;
const OFFICE_CLOSE_HOUR = 18;

function pktHour(d: Date): number {
  return new Date(d.getTime() + PKT_OFFSET_MS).getUTCHours();
}

/** Clamp into office hours: before open → 09:00 same PKT day; at/after close → 09:00 next PKT day. */
function clampToOfficeHoursPkt(d: Date): Date {
  const h = pktHour(d);
  if (h >= OFFICE_OPEN_HOUR && h < OFFICE_CLOSE_HOUR) return d;
  const pkt = new Date(d.getTime() + PKT_OFFSET_MS);
  let y = pkt.getUTCFullYear();
  let mo = pkt.getUTCMonth();
  let da = pkt.getUTCDate();
  if (h >= OFFICE_CLOSE_HOUR) {
    const next = new Date(Date.UTC(y, mo, da) + 24 * 60 * 60 * 1000);
    y = next.getUTCFullYear();
    mo = next.getUTCMonth();
    da = next.getUTCDate();
  }
  return new Date(Date.UTC(y, mo, da, OFFICE_OPEN_HOUR, 0, 0, 0) - PKT_OFFSET_MS);
}

function fmtPkt(d: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Karachi',
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d) + ' PKT'
  );
}

@Injectable()
export class AppointmentsService {
  private readonly log = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly activityTimeline: ActivityTimelineService,
    private readonly notifications: NotificationsService,
    private readonly whatsappNotifier: WhatsAppAppointmentNotifierService,
    private readonly booking: AppointmentBookingService,
  ) {}

  /**
   * One-off cleanup: find future, active appointments scheduled outside office
   * hours (9 AM–6 PM PKT) and shift them in. apply=false previews (read-only);
   * apply=true performs the shift. Returns the full affected list either way so
   * the team can confirm the new times with each client (no auto-messaging).
   */
  async reshiftOutOfHours(apply: boolean, user: RequestUser) {
    const now = new Date();
    const appts = await this.prisma.appointment.findMany({
      where: {
        status: {
          in: [
            AppointmentStatus.SCHEDULED,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.RESCHEDULED,
          ],
        },
        scheduledAt: { gte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true,
        title: true,
        appointmentType: true,
        status: true,
        scheduledAt: true,
        lead: { select: { firstName: true, lastName: true, phone: true } },
        client: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    const items = appts
      .filter((a) => {
        const h = pktHour(a.scheduledAt);
        return h < OFFICE_OPEN_HOUR || h >= OFFICE_CLOSE_HOUR;
      })
      .map((a) => {
        const newAt = clampToOfficeHoursPkt(a.scheduledAt);
        const who =
          (a.lead ? `${a.lead.firstName ?? ''} ${a.lead.lastName ?? ''}`.trim() : '') ||
          (a.client ? `${a.client.firstName ?? ''} ${a.client.lastName ?? ''}`.trim() : '') ||
          a.title;
        return {
          id: a.id,
          who,
          phone: a.lead?.phone ?? a.client?.phone ?? null,
          appointmentType: a.appointmentType,
          status: a.status,
          currentAt: a.scheduledAt.toISOString(),
          currentPkt: fmtPkt(a.scheduledAt),
          newAt: newAt.toISOString(),
          newPkt: fmtPkt(newAt),
        };
      });

    if (apply && items.length > 0) {
      await this.prisma.$transaction(
        items.map((x) =>
          this.prisma.appointment.update({
            where: { id: x.id },
            data: { scheduledAt: new Date(x.newAt) },
          }),
        ),
      );
      this.log.log(
        `reshiftOutOfHours: ${items.length} appointment(s) moved into office hours by user ${user.id}`,
      );
    }

    return { applied: apply, count: items.length, items };
  }

  async findAllAccessible(query: ListAppointmentsQueryDto, user: RequestUser) {
    const canViewAll = user.permissions.includes('appointments.view_all');
    const assignedEmployeeId = canViewAll
      ? undefined
      : await this.findEmployeeIdByUserId(user.id);

    if (!canViewAll && !assignedEmployeeId) {
      return [];
    }

    const rows = await this.prisma.appointment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.caseId ? { caseId: query.caseId } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(!canViewAll ? { assignedEmployeeId } : {}),
        ...(query.scheduledFrom || query.scheduledTo
          ? {
              scheduledAt: {
                ...(query.scheduledFrom ? { gte: new Date(query.scheduledFrom) } : {}),
                ...(query.scheduledTo ? { lte: new Date(query.scheduledTo) } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { appointmentType: { contains: query.search, mode: 'insensitive' } },
                { location: { contains: query.search, mode: 'insensitive' } },
                {
                  lead: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
                {
                  client: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        case: { select: { id: true, caseNumber: true, status: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    // Appointment has no `assignedEmployee` Prisma relation — resolve the
    // assignee names in one extra query and merge them onto each row so the
    // admin list can show "Assigned to".
    const empIds = [
      ...new Set(rows.map((r) => r.assignedEmployeeId).filter((x): x is string => !!x)),
    ];
    const emps = empIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: empIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const empById = new Map(emps.map((e) => [e.id, e]));
    return rows.map((r) => ({
      ...r,
      assignedEmployee: r.assignedEmployeeId ? empById.get(r.assignedEmployeeId) ?? null : null,
    }));
  }

  /**
   * Admin overview for the appointments dashboard — counts over upcoming
   * (future, active) appointments: timeframe windows, by-status, per-salesperson
   * load, unassigned, and how many fall outside office hours. Computed from one
   * query (small working set) so there's no aggregation plumbing.
   */
  async getAdminOverview() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const future = await this.prisma.appointment.findMany({
      where: {
        status: {
          in: [
            AppointmentStatus.SCHEDULED,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.RESCHEDULED,
          ],
        },
        scheduledAt: { gte: now },
      },
      select: {
        scheduledAt: true,
        status: true,
        assignedEmployeeId: true,
      },
    });

    const byStatus: Record<string, number> = {};
    const countById = new Map<string, number>();
    let unassigned = 0;
    let next24 = 0;
    let next7 = 0;
    let outsideHours = 0;

    for (const a of future) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      if (a.scheduledAt <= in24h) next24++;
      if (a.scheduledAt <= in7d) next7++;
      const h = pktHour(a.scheduledAt);
      if (h < OFFICE_OPEN_HOUR || h >= OFFICE_CLOSE_HOUR) outsideHours++;
      if (!a.assignedEmployeeId) {
        unassigned++;
      } else {
        countById.set(a.assignedEmployeeId, (countById.get(a.assignedEmployeeId) ?? 0) + 1);
      }
    }

    // Appointment has no assignedEmployee relation — resolve names separately.
    const emps = countById.size
      ? await this.prisma.employee.findMany({
          where: { id: { in: [...countById.keys()] } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const nameById = new Map(
      emps.map((e) => [e.id, `${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() || 'Unknown']),
    );
    const byEmployee = [...countById.entries()]
      .map(([id, count]) => ({ name: nameById.get(id) ?? 'Unknown', count }))
      .sort((a, b) => b.count - a.count);

    return {
      total: future.length,
      next24,
      next7,
      outsideHours,
      unassigned,
      byStatus,
      byEmployee,
    };
  }

  async findByIdAccessible(id: string, user: RequestUser) {
    const canViewAll = user.permissions.includes('appointments.view_all');
    const assignedEmployeeId = canViewAll
      ? undefined
      : await this.findEmployeeIdByUserId(user.id);

    if (!canViewAll && !assignedEmployeeId) {
      throw new NotFoundException('Appointment not found');
    }

    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id,
        ...(!canViewAll ? { assignedEmployeeId } : {}),
      },
      include: {
        lead: true,
        client: true,
        case: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  async findAll(query: ListAppointmentsQueryDto) {
    return this.prisma.appointment.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.caseId ? { caseId: query.caseId } : {}),
        ...(query.assignedEmployeeId ? { assignedEmployeeId: query.assignedEmployeeId } : {}),
        ...(query.scheduledFrom || query.scheduledTo
          ? {
              scheduledAt: {
                ...(query.scheduledFrom ? { gte: new Date(query.scheduledFrom) } : {}),
                ...(query.scheduledTo ? { lte: new Date(query.scheduledTo) } : {}),
              },
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' } },
                { appointmentType: { contains: query.search, mode: 'insensitive' } },
                { location: { contains: query.search, mode: 'insensitive' } },
                {
                  lead: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
                {
                  client: {
                    OR: [
                      { firstName: { contains: query.search, mode: 'insensitive' } },
                      { lastName: { contains: query.search, mode: 'insensitive' } },
                      { phone: { contains: query.search, mode: 'insensitive' } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        client: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        case: { select: { id: true, caseNumber: true, status: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async findById(id: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        lead: true,
        client: true,
        case: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return appointment;
  }

  async create(dto: CreateAppointmentDto, actorUserId: string) {
    const owner = await this.resolveOwner(dto.leadId, dto.clientId, dto.caseId);

    // Double-booking guard via the shared booking engine (the same engine the
    // WhatsApp bot uses): if the appointment lands on an agent, REJECT a time
    // that overlaps one of their existing active appointments — the thrown 409
    // carries `suggestedAt` (the next free slot) so the UI can offer it. The
    // row-lock inside the engine makes the check+insert atomic, closing the
    // race the old standalone guard had. Unassigned appointments skip the check.
    const effectiveEmployeeId = dto.assignedEmployeeId ?? owner.assignedEmployeeId ?? null;
    const durationMinutes = dto.durationMinutes ?? 30;
    const { result: created } = await this.booking.withResolvedSlot({
      employeeId: effectiveEmployeeId,
      desiredAt: new Date(dto.scheduledAt),
      durationMinutes,
      conflict: 'reject',
      clamp: clampToOfficeHoursPkt,
      run: (bookedAt, tx) =>
        tx.appointment.create({
          data: {
            leadId: owner.leadId,
            clientId: owner.clientId,
            caseId: owner.caseId,
            assignedEmployeeId: effectiveEmployeeId,
            createdByUserId: actorUserId,
            title: dto.title,
            appointmentType: dto.appointmentType,
            scheduledAt: bookedAt,
            durationMinutes,
            location: dto.location,
            meetingLink: dto.meetingLink,
            notes: dto.notes,
          },
          include: {
            lead: { select: { id: true, firstName: true, lastName: true, phone: true } },
            client: { select: { id: true, firstName: true, lastName: true, phone: true } },
            case: { select: { id: true, caseNumber: true } },
          },
        }),
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.APPOINTMENT_CREATED,
      entityType: 'Appointment',
      entityId: created.id,
      newValues: {
        leadId: created.leadId,
        clientId: created.clientId,
        caseId: created.caseId,
        title: created.title,
        appointmentType: created.appointmentType,
        scheduledAt: created.scheduledAt,
      },
    });

    await this.recordTimeline(
      created.leadId,
      created.clientId,
      created.caseId,
      TimelineEventType.APPOINTMENT_SCHEDULED,
      `Appointment scheduled: ${created.title}`,
      actorUserId,
    );

    // Bell notification to the agent the appointment is assigned to —
    // unless they ARE the creator (no point notifying yourself). Best-
    // effort; never blocks creation.
    if (created.assignedEmployeeId) {
      try {
        const assignee = await this.prisma.employee.findUnique({
          where: { id: created.assignedEmployeeId },
          select: { firstName: true, user: { select: { id: true } } },
        });
        if (assignee?.user?.id && assignee.user.id !== actorUserId) {
          const who =
            created.lead?.firstName ||
            created.client?.firstName ||
            'a lead';
          await this.notifications.create({
            userId: assignee.user.id,
            type: 'APPOINTMENT_BOOKED',
            title: `New appointment: ${created.title}`,
            body: `With ${who} on ${formatBellWhen(created.scheduledAt)}`,
            link: '/sales/appointments',
          });
        }
      } catch (err) {
        this.log.warn({ err: (err as Error).message }, 'bell notification on appointment create failed');
      }
    }

    let whatsappConfirmation: AppointmentConfirmationResult | null = null;
    if (dto.sendWhatsAppConfirmation) {
      try {
        whatsappConfirmation = await this.whatsappNotifier.sendConfirmationFor(
          created.id,
          actorUserId,
        );
      } catch (err) {
        // Notifier is best-effort — appointment creation must never fail
        // because of WhatsApp send issues.
        this.log.warn(
          { appointmentId: created.id, err: (err as Error).message },
          'whatsapp confirmation send failed',
        );
        whatsappConfirmation = { sent: false, reason: 'no_thread' };
      }
    }

    // If this appointment was created from a bot-captured AppointmentRequest,
    // flip the request to CONFIRMED + link the appointment so the chat-panel
    // banner clears and we don't keep nagging sales about an already-actioned
    // request. Best-effort: a stale appointmentRequestId shouldn't break the
    // create, so we updateMany (silently no-ops if the id doesn't exist).
    if (dto.appointmentRequestId) {
      await this.prisma.appointmentRequest.updateMany({
        where: { id: dto.appointmentRequestId, status: 'PENDING' },
        data: {
          status: 'CONFIRMED',
          linkedAppointmentId: created.id,
          closedAt: new Date(),
          closedByUserId: actorUserId,
        },
      });
    }

    // Post-booking (manual): mirror the bot's auto-book sub-flow — proactively
    // ask the lead for their email so we can verify it + request WhatsApp call
    // permission. The client's email reply is handled by the orchestrator's
    // ASK_EMAIL branch (saves the email, fires the verification link, then sends
    // the call-permission request) — so email then permission stay separate, in
    // order, identical to the bot. Fires only when the rep chose to message via
    // WhatsApp, the lead has an OPEN window, and we don't already hold a verified
    // email (no re-asking). Best-effort — never fails the booking.
    if (dto.sendWhatsAppConfirmation && created.leadId) {
      try {
        const lead = await this.prisma.lead.findUnique({
          where: { id: created.leadId },
          select: { emailVerifiedAt: true },
        });
        if (!lead?.emailVerifiedAt) {
          const thread = await this.prisma.whatsAppThread.findFirst({
            where: {
              leadId: created.leadId,
              status: { in: [WhatsAppThreadStatus.OPEN, WhatsAppThreadStatus.PENDING] },
            },
            orderBy: { lastMessageAt: 'desc' },
            select: { id: true, windowExpiresAt: true },
          });
          const windowOpen =
            !!thread?.windowExpiresAt && thread.windowExpiresAt.getTime() > Date.now();
          if (thread && windowOpen) {
            await this.whatsappNotifier.sendBotText(
              thread.id,
              "To send your appointment confirmation and document checklist, what's the best email address for you? 📧",
            );
            await this.prisma.whatsAppThread.update({
              where: { id: thread.id },
              data: { aiState: 'ASK_EMAIL' },
            });
          }
        }
      } catch (err) {
        this.log.warn(
          { appointmentId: created.id, err: (err as Error).message },
          'manual-booking email-ask failed',
        );
      }
    }

    return { ...created, whatsappConfirmation };
  }

  async update(id: string, dto: UpdateAppointmentDto, actorUserId: string) {
    const existing = await this.findById(id);

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        assignedEmployeeId: dto.assignedEmployeeId,
        title: dto.title,
        appointmentType: dto.appointmentType,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        durationMinutes: dto.durationMinutes,
        location: dto.location,
        meetingLink: dto.meetingLink,
        notes: dto.notes,
        status: dto.status,
        completedAt: dto.status === AppointmentStatus.COMPLETED ? new Date() : undefined,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: dto.status === AppointmentStatus.CANCELLED ? AuditAction.APPOINTMENT_CANCELLED : AuditAction.APPOINTMENT_UPDATED,
      entityType: 'Appointment',
      entityId: updated.id,
      oldValues: {
        status: existing.status,
        scheduledAt: existing.scheduledAt,
        assignedEmployeeId: existing.assignedEmployeeId,
      },
      newValues: dto,
    });

    // Timeline events for every appointment-status transition so the lead
    // profile reflects the lifecycle, not just completions.
    if (dto.status && dto.status !== existing.status) {
      if (dto.status === AppointmentStatus.COMPLETED) {
        await this.recordTimeline(updated.leadId, updated.clientId, updated.caseId, TimelineEventType.APPOINTMENT_COMPLETED, `Appointment completed: ${updated.title}`, actorUserId);
      } else if (dto.status === AppointmentStatus.CANCELLED) {
        await this.recordTimeline(updated.leadId, updated.clientId, updated.caseId, TimelineEventType.APPOINTMENT_CANCELLED, `Appointment cancelled: ${updated.title}`, actorUserId);
      } else if (dto.status === AppointmentStatus.NO_SHOW) {
        await this.recordTimeline(updated.leadId, updated.clientId, updated.caseId, TimelineEventType.APPOINTMENT_NO_SHOW, `Customer no-show: ${updated.title}`, actorUserId);
      }
    }

    // Reschedule — scheduledAt moved without a status change to CANCELLED.
    // Compare timestamps via getTime() so a Date and an ISO string with the
    // same instant don't false-positive as "rescheduled".
    if (
      dto.scheduledAt &&
      new Date(dto.scheduledAt).getTime() !== new Date(existing.scheduledAt).getTime() &&
      dto.status !== AppointmentStatus.CANCELLED
    ) {
      await this.recordTimeline(
        updated.leadId,
        updated.clientId,
        updated.caseId,
        TimelineEventType.APPOINTMENT_RESCHEDULED,
        `Appointment rescheduled: ${updated.title} → ${new Date(dto.scheduledAt).toLocaleString()}`,
        actorUserId,
      );
    }

    return this.findById(id);
  }

  // Double-booking detection now lives in the shared AppointmentBookingService
  // (resolveSlot) — the same engine the WhatsApp bot uses. create() and
  // reschedule() above delegate to it, so there is one conflict authority for
  // the whole platform.

  /**
   * Move an appointment to a new time (and optionally duration), rejecting a
   * double-booking. Re-arms the durable reminder for the new slot by clearing
   * reminderSentAt and dropping any pending reminder job so the dispatcher
   * re-materialises it.
   */
  async reschedule(id: string, dto: RescheduleAppointmentDto, actorUserId: string) {
    const existing = await this.findById(id);
    const reschedulable: AppointmentStatus[] = [
      AppointmentStatus.SCHEDULED,
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.RESCHEDULED,
    ];
    if (!reschedulable.includes(existing.status)) {
      throw new BadRequestException(
        `Cannot reschedule a ${existing.status.toLowerCase()} appointment.`,
      );
    }

    const newStart = new Date(dto.scheduledAt);
    const newDuration = dto.durationMinutes ?? existing.durationMinutes;
    // Re-time through the shared booking engine: REJECT (with a suggested next
    // slot in the 409) if the new time double-books the agent — atomically under
    // the rep row-lock, excluding this appointment from its own busy set.
    // Unassigned appointments skip the conflict check.
    await this.booking.withResolvedSlot({
      employeeId: existing.assignedEmployeeId,
      desiredAt: newStart,
      durationMinutes: newDuration,
      conflict: 'reject',
      clamp: clampToOfficeHoursPkt,
      excludeAppointmentId: id,
      run: (bookedAt, tx) =>
        tx.appointment.update({
          where: { id },
          data: {
            scheduledAt: bookedAt,
            durationMinutes: newDuration,
            status: AppointmentStatus.SCHEDULED,
            reminderSentAt: null, // re-arm the durable reminder for the new time
          },
        }),
    });
    // Drop the stale pending reminder so the dispatcher recreates it at the new time.
    await this.prisma.reminderJob
      .deleteMany({ where: { appointmentId: id, status: 'PENDING' } })
      .catch(() => undefined);

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.APPOINTMENT_UPDATED,
      entityType: 'Appointment',
      entityId: id,
      oldValues: { scheduledAt: existing.scheduledAt, durationMinutes: existing.durationMinutes },
      newValues: { scheduledAt: newStart, durationMinutes: newDuration },
    });
    await this.recordTimeline(
      existing.leadId,
      existing.clientId,
      existing.caseId,
      TimelineEventType.APPOINTMENT_RESCHEDULED,
      `Appointment rescheduled: ${existing.title} → ${formatBellWhen(newStart)}`,
      actorUserId,
    );

    // Tell the customer about the new time on WhatsApp — automatically, every
    // reschedule. The notifier itself enforces the 24h customer-service
    // window (skips silently when it's closed) and never throws, so a
    // WhatsApp hiccup can never break the reschedule.
    try {
      const result = await this.whatsappNotifier.sendConfirmationFor(id, actorUserId, {
        kind: 'rescheduled',
      });
      if (!result.sent) {
        this.log.debug(
          { appointmentId: id, reason: result.reason },
          'reschedule WhatsApp notice skipped',
        );
      }
    } catch (err) {
      this.log.warn(
        { appointmentId: id, err: (err as Error).message },
        'reschedule WhatsApp notice failed',
      );
    }

    return this.findById(id);
  }

  /**
   * Free/busy for an agent on a PKT calendar day. Returns the office-hours
   * window, the agent's busy intervals, and the open 30-minute slots — enough
   * for the booking UI to offer conflict-free times.
   */
  async getAvailability(employeeId: string, dateStr: string) {
    const window = pktWorkingWindowUtc(dateStr);
    // Pad the lower bound so a long appointment starting before 09:00 is caught.
    const fetchFrom = new Date(window.start.getTime() - 12 * 60 * 60_000);
    const appts = await this.prisma.appointment.findMany({
      where: {
        assignedEmployeeId: employeeId,
        status: { in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED] },
        scheduledAt: { gte: fetchFrom, lt: window.end },
      },
      select: { id: true, title: true, scheduledAt: true, durationMinutes: true },
      orderBy: { scheduledAt: 'asc' },
    });

    const busy: Interval[] = appts
      .map((a) => ({ start: a.scheduledAt, end: appointmentEnd(a.scheduledAt, a.durationMinutes) }))
      .filter((b) => intervalsOverlap(b.start, b.end, window.start, window.end));
    const freeSlots = computeFreeSlots(window.start, window.end, busy);

    return {
      employeeId,
      date: dateStr,
      workStart: window.start.toISOString(),
      workEnd: window.end.toISOString(),
      busy: appts.map((a) => ({
        id: a.id,
        title: a.title,
        start: a.scheduledAt.toISOString(),
        end: appointmentEnd(a.scheduledAt, a.durationMinutes).toISOString(),
      })),
      freeSlots: freeSlots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
      })),
    };
  }

  async cancel(id: string, dto: CancelAppointmentDto, actorUserId: string) {
    const appointment = await this.findById(id);

    await this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: dto.cancellationReason,
      },
    });

    await this.auditLog.log({
      actorUserId,
      action: AuditAction.APPOINTMENT_CANCELLED,
      entityType: 'Appointment',
      entityId: id,
      oldValues: { status: appointment.status },
      newValues: { status: AppointmentStatus.CANCELLED, cancellationReason: dto.cancellationReason },
    });

    await this.recordTimeline(
      appointment.leadId,
      appointment.clientId,
      appointment.caseId,
      TimelineEventType.APPOINTMENT_CANCELLED,
      `Appointment cancelled: ${appointment.title}${dto.cancellationReason ? ` (${dto.cancellationReason})` : ''}`,
      actorUserId,
    );

    return this.findById(id);
  }

  private async resolveOwner(leadId?: string, clientId?: string, caseId?: string) {
    if (!leadId && !clientId && !caseId) {
      throw new BadRequestException('A lead, client, or case must be selected for the appointment');
    }

    if (leadId && clientId) {
      throw new BadRequestException('Appointments must target either a lead or a client, not both');
    }

    if (leadId) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId, deletedAt: null },
        select: { id: true, status: true, convertedClientId: true, assignedEmployeeId: true },
      });

      if (!lead) {
        throw new NotFoundException('Lead not found');
      }

      if (lead.convertedClientId || lead.status === LeadStatus.CONVERTED) {
        throw new BadRequestException('Converted leads should be handled from the client workflow');
      }

      return {
        leadId: lead.id,
        clientId: undefined,
        caseId: undefined,
        assignedEmployeeId: lead.assignedEmployeeId,
      };
    }

    if (caseId) {
      const record = await this.prisma.case.findUnique({
        where: { id: caseId, deletedAt: null },
        select: { id: true, clientId: true, assignedEmployeeId: true },
      });

      if (!record) {
        throw new NotFoundException('Case not found');
      }

      return {
        leadId: undefined,
        clientId: clientId ?? record.clientId,
        caseId: record.id,
        assignedEmployeeId: record.assignedEmployeeId,
      };
    }

    const client = await this.prisma.client.findUnique({
      where: { id: clientId, deletedAt: null },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    return {
      leadId: undefined,
      clientId: client.id,
      caseId: undefined,
      assignedEmployeeId: undefined,
    };
  }

  async generateIcs(user: RequestUser): Promise<string> {
    const canViewAll = user.permissions.includes('appointments.view_all');
    const assignedEmployeeId = canViewAll
      ? undefined
      : await this.findEmployeeIdByUserId(user.id);

    if (!canViewAll && !assignedEmployeeId) {
      return this.buildIcs([]);
    }

    const rows = await this.prisma.appointment.findMany({
      where: {
        ...(!canViewAll ? { assignedEmployeeId } : {}),
        status: { notIn: ['CANCELLED'] as any },
      },
      include: {
        lead: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    return this.buildIcs(rows);
  }

  private buildIcs(
    rows: Array<{
      id: string;
      title: string;
      scheduledAt: Date;
      durationMinutes: number;
      location?: string | null;
      meetingLink?: string | null;
      notes?: string | null;
      status: string;
      lead?: { firstName: string; lastName: string } | null;
      client?: { firstName: string; lastName: string } | null;
    }>,
  ): string {
    const escape = (s: string) =>
      s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

    const fmtDt = (d: Date) =>
      d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

    const foldLine = (line: string): string => {
      const chunks: string[] = [];
      while (line.length > 75) {
        chunks.push(line.slice(0, 75));
        line = ' ' + line.slice(75);
      }
      chunks.push(line);
      return chunks.join('\r\n');
    };

    const now = fmtDt(new Date());

    const events = rows.map((r) => {
      const start = new Date(r.scheduledAt);
      const end = new Date(start.getTime() + r.durationMinutes * 60_000);
      const contact = r.client ?? r.lead;
      const summary = contact
        ? `${contact.firstName} ${contact.lastName} — ${r.title}`
        : r.title;
      const descParts: string[] = [];
      if (r.meetingLink) descParts.push(`Meeting link: ${r.meetingLink}`);
      if (r.notes) descParts.push(r.notes);
      const desc = descParts.join('\\n');

      const lines = [
        'BEGIN:VEVENT',
        foldLine(`UID:${r.id}@tafsheen.app`),
        `DTSTAMP:${now}`,
        `DTSTART:${fmtDt(start)}`,
        `DTEND:${fmtDt(end)}`,
        foldLine(`SUMMARY:${escape(summary)}`),
      ];
      if (r.location) lines.push(foldLine(`LOCATION:${escape(r.location)}`));
      if (r.meetingLink) lines.push(foldLine(`URL:${escape(r.meetingLink)}`));
      if (desc) lines.push(foldLine(`DESCRIPTION:${escape(desc)}`));
      lines.push(`STATUS:${r.status === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED'}`);
      lines.push('END:VEVENT');
      return lines.join('\r\n');
    });

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Tafsheen//Appointments//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Tafsheen Appointments',
      'X-WR-TIMEZONE:Asia/Karachi',
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');
  }

  private async findEmployeeIdByUserId(userId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        userId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    return employee?.id ?? null;
  }

  private async recordTimeline(
    leadId: string | null,
    clientId: string | null,
    caseId: string | null,
    eventType: TimelineEventType,
    description: string,
    actorUserId: string,
  ) {
    if (leadId) {
      await this.activityTimeline.record({
        entityType: 'Lead',
        entityId: leadId,
        leadId,
        eventType,
        description,
        actorUserId,
      });
    }

    if (clientId) {
      await this.activityTimeline.record({
        entityType: caseId ? 'Case' : 'Client',
        entityId: caseId ?? clientId,
        clientId,
        caseId: caseId ?? undefined,
        eventType,
        description,
        actorUserId,
      });
    }
  }
}

/**
 * Asia/Karachi-localized timestamp used in the bell notification body
 * ("With Asad on Mon, 02 Jun · 10:00 AM PKT"). Kept simple so it reads
 * well at one-line length.
 */
function formatBellWhen(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d) + ' PKT';
}