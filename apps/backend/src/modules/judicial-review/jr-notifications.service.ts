import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';

/**
 * JR human-workflow notification suite (§11.5).
 *
 * Fires an in-app bell + email when a matter is assigned/reassigned, an artifact
 * enters counsel review, counsel requests changes, or a settlement is recorded.
 * The FATAL deadline alerts are the sweeper's job (jr-deadline-sweeper.service) —
 * this is the human-workflow layer that sits on top of the mutations.
 *
 * Design rules (mirroring the sweeper's recipient-resolution shapes):
 *   - All recipients are INTERNAL CRM users. External counsel is NEVER emailed.
 *   - Every method is fire-and-forget from the caller (`void x().catch(() => {})`)
 *     and must NEVER throw: a bad recipient logs a warn and is skipped so it can
 *     never break the mutation that produced the event.
 *   - The whole suite is silenced by JR_NOTIFY_ENABLED=false.
 */

interface Recipient {
  userId: string;
  email: string;
  name: string;
}

@Injectable()
export class JrNotificationsService {
  private readonly log = new Logger(JrNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Kill-switch shared with the sweeper — JR_NOTIFY_ENABLED=false silences all. */
  private get enabled(): boolean {
    return process.env.JR_NOTIFY_ENABLED !== 'false';
  }

  // ---------------------------------------------------------------------------
  // Public events
  // ---------------------------------------------------------------------------

  /**
   * A matter was assigned (or reassigned) to an associate. Notifies the new
   * owner only; skips entirely on a self-assign (the actor already knows).
   */
  async matterAssigned(
    matter: { id: string; matterNumber: string; styleOfCause: string | null },
    assigneeUserId: string,
    actorUserId: string,
    assignedByName: string,
  ): Promise<void> {
    if (!this.enabled) return;
    if (assigneeUserId === actorUserId) return; // self-assign — no nudge

    const recipient = await this.resolveUser(assigneeUserId);
    if (!recipient) {
      this.log.warn(
        `JR matterAssigned: assignee ${assigneeUserId} on matter ${matter.matterNumber} is inactive/missing — assignment notice reached nobody.`,
      );
      return;
    }

    await this.dispatch(recipient, {
      matterId: matter.id,
      type: 'JR_MATTER_ASSIGNED',
      title: `JR matter assigned — ${matter.matterNumber}`,
      body: `Matter ${matter.matterNumber} was assigned to you by ${assignedByName}.`,
      sendEmail: () =>
        this.email.sendJrMatterAssigned({
          to: recipient.email,
          recipientName: recipient.name,
          matterId: matter.id,
          matterNumber: matter.matterNumber,
          styleOfCause: matter.styleOfCause,
          assignedByName,
        }),
    });
  }

  /** An artifact entered COUNSEL_REVIEW — notifies the JR Head(s). */
  async artifactAwaitingCounsel(
    matter: { id: string; matterNumber: string; styleOfCause: string | null },
    artifactTitle: string,
  ): Promise<void> {
    if (!this.enabled) return;

    const heads = await this.resolveRole('jr_head');
    if (heads.length === 0) {
      this.log.warn(
        `JR artifactAwaitingCounsel: no ACTIVE jr_head — "${artifactTitle}" on matter ${matter.matterNumber} reached nobody. Assign the JR Head role.`,
      );
      return;
    }

    for (const recipient of this.dedupe(heads)) {
      await this.dispatch(recipient, {
        matterId: matter.id,
        type: 'JR_ARTIFACT_AWAITING_COUNSEL',
        title: `JR artifact awaiting counsel review — ${matter.matterNumber}`,
        body: `"${artifactTitle}" on matter ${matter.matterNumber} is awaiting counsel review.`,
        sendEmail: () =>
          this.email.sendJrArtifactAwaitingCounsel({
            to: recipient.email,
            recipientName: recipient.name,
            matterId: matter.id,
            matterNumber: matter.matterNumber,
            styleOfCause: matter.styleOfCause,
            artifactTitle,
          }),
      });
    }
  }

  /** Counsel requested changes — notifies the author + the JR Head(s). */
  async counselChangesRequested(
    matter: { id: string; matterNumber: string; styleOfCause: string | null },
    artifactTitle: string,
    authorUserId: string | null,
  ): Promise<void> {
    if (!this.enabled) return;

    const recipients: Recipient[] = [];
    if (authorUserId) {
      const author = await this.resolveUser(authorUserId);
      if (author) recipients.push(author);
    }
    recipients.push(...(await this.resolveRole('jr_head')));

    const deduped = this.dedupe(recipients);
    if (deduped.length === 0) {
      this.log.warn(
        `JR counselChangesRequested: no author + no ACTIVE jr_head — "${artifactTitle}" on matter ${matter.matterNumber} reached nobody.`,
      );
      return;
    }

    for (const recipient of deduped) {
      await this.dispatch(recipient, {
        matterId: matter.id,
        type: 'JR_COUNSEL_CHANGES_REQUESTED',
        title: `JR counsel requested changes — ${matter.matterNumber}`,
        body: `Counsel requested changes on "${artifactTitle}" (matter ${matter.matterNumber}).`,
        sendEmail: () =>
          this.email.sendJrCounselChangesRequested({
            to: recipient.email,
            recipientName: recipient.name,
            matterId: matter.id,
            matterNumber: matter.matterNumber,
            styleOfCause: matter.styleOfCause,
            artifactTitle,
          }),
      });
    }
  }

  /** A settlement was recorded — notifies the JR Head(s) + assigned associate. */
  async settlementRecorded(matter: {
    id: string;
    matterNumber: string;
    styleOfCause: string | null;
    assignedAssociateUserId: string | null;
    additionalSubmissionsDueAt: Date | null;
  }): Promise<void> {
    if (!this.enabled) return;

    const recipients: Recipient[] = [...(await this.resolveRole('jr_head'))];
    if (matter.assignedAssociateUserId) {
      const assoc = await this.resolveUser(matter.assignedAssociateUserId);
      if (assoc) recipients.push(assoc);
    }

    const deduped = this.dedupe(recipients);
    if (deduped.length === 0) {
      this.log.warn(
        `JR settlementRecorded: no ACTIVE jr_head + no assigned associate — matter ${matter.matterNumber} settlement notice reached nobody.`,
      );
      return;
    }

    const dueLabel = matter.additionalSubmissionsDueAt
      ? matter.additionalSubmissionsDueAt.toISOString().slice(0, 10)
      : '—';

    for (const recipient of deduped) {
      await this.dispatch(recipient, {
        matterId: matter.id,
        type: 'JR_SETTLEMENT_RECORDED',
        title: `JR settlement recorded — ${matter.matterNumber}`,
        body: `A settlement was recorded on matter ${matter.matterNumber}. Additional submissions due: ${dueLabel}.`,
        sendEmail: () =>
          this.email.sendJrSettlementRecorded({
            to: recipient.email,
            recipientName: recipient.name,
            matterId: matter.id,
            matterNumber: matter.matterNumber,
            styleOfCause: matter.styleOfCause,
            additionalSubmissionsDueLabel: dueLabel,
          }),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Dispatch + recipient resolution (mirrors the sweeper's shapes)
  // ---------------------------------------------------------------------------

  /**
   * Fire BOTH channels (bell + email) to one recipient, wrapped so one bad
   * recipient never aborts the rest and never throws to the caller.
   */
  private async dispatch(
    recipient: Recipient,
    opts: {
      matterId: string;
      type: string;
      title: string;
      body: string;
      sendEmail: () => Promise<boolean>;
    },
  ): Promise<void> {
    try {
      await this.notifications.create({
        userId: recipient.userId,
        type: opts.type,
        title: opts.title,
        body: opts.body,
        link: `/jr/matters/${opts.matterId}`,
      });
      await opts.sendEmail();
    } catch (e) {
      this.log.warn(
        `JR notification to ${recipient.userId} failed (${opts.type}): ${(e as Error).message}`,
      );
    }
  }

  /** Dedupe a recipient list by userId, preserving first-seen order. */
  private dedupe(recipients: Recipient[]): Recipient[] {
    const seen = new Map<string, Recipient>();
    for (const r of recipients) if (!seen.has(r.userId)) seen.set(r.userId, r);
    return [...seen.values()];
  }

  private async resolveRole(name: string): Promise<Recipient[]> {
    const users = await this.prisma.userAccount.findMany({
      where: { status: 'ACTIVE', deletedAt: null, userRoles: { some: { role: { name } } } },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return users.map((u) => this.toRecipient(u));
  }

  private async resolveUser(userId: string): Promise<Recipient | null> {
    const u = await this.prisma.userAccount.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return u && u.status === 'ACTIVE' && !u.deletedAt ? this.toRecipient(u) : null;
  }

  private toRecipient(u: {
    id: string;
    email: string;
    employee: { firstName: string; lastName: string } | null;
  }): Recipient {
    return {
      userId: u.id,
      email: u.email,
      name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() || u.email : u.email,
    };
  }
}
