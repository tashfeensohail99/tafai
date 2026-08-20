/**
 * Unit tests for JrNotificationsService — the JR human-workflow notification
 * suite (§11.5). Uses jest.fn() mocks for PrismaService, EmailService and
 * NotificationsService — no real database or SMTP.
 *
 * Covers:
 *   (a) JR_NOTIFY_ENABLED='false' silences everything.
 *   (b) matterAssigned to a resolvable assignee fires BOTH bell + email once.
 *   (c) matterAssigned where assignee === actor (self-assign) sends nothing.
 *   (d) artifactAwaitingCounsel with zero heads warns and sends nothing.
 *   (e) recipients are deduped (an author who is also a head gets ONE email).
 */

import { Logger } from '@nestjs/common';
import { JrNotificationsService } from './jr-notifications.service';

const MATTER = { id: 'matter-1', matterNumber: 'JR-2026-00001', styleOfCause: 'X v MCI' };

function activeUser(id: string, first = 'Ada', last = 'Lovelace') {
  return {
    id,
    email: `${id}@tashfeengroup.com`,
    status: 'ACTIVE' as const,
    deletedAt: null as Date | null,
    employee: { firstName: first, lastName: last },
  };
}

function build() {
  const prismaMock = {
    userAccount: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const emailMock = {
    sendJrMatterAssigned: jest.fn().mockResolvedValue(true),
    sendJrArtifactAwaitingCounsel: jest.fn().mockResolvedValue(true),
    sendJrCounselChangesRequested: jest.fn().mockResolvedValue(true),
    sendJrSettlementRecorded: jest.fn().mockResolvedValue(true),
  };
  const notificationsMock = { create: jest.fn().mockResolvedValue(undefined) };

  const service = new JrNotificationsService(
    prismaMock as any,
    emailMock as any,
    notificationsMock as any,
  );
  return { service, prismaMock, emailMock, notificationsMock };
}

describe('JrNotificationsService (§11.5)', () => {
  const originalFlag = process.env.JR_NOTIFY_ENABLED;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.JR_NOTIFY_ENABLED;
    else process.env.JR_NOTIFY_ENABLED = originalFlag;
    jest.restoreAllMocks();
  });

  it('(a) sends NOTHING when JR_NOTIFY_ENABLED=false', async () => {
    process.env.JR_NOTIFY_ENABLED = 'false';
    const { service, prismaMock, emailMock, notificationsMock } = build();

    await service.matterAssigned(MATTER, 'assignee-1', 'actor-9', 'The JR Head');
    await service.artifactAwaitingCounsel(MATTER, 'ALJR');
    await service.counselChangesRequested(MATTER, 'ALJR', 'author-1');
    await service.settlementRecorded({
      ...MATTER,
      assignedAssociateUserId: 'assoc-1',
      additionalSubmissionsDueAt: null,
    });

    expect(prismaMock.userAccount.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.userAccount.findMany).not.toHaveBeenCalled();
    expect(notificationsMock.create).not.toHaveBeenCalled();
    expect(emailMock.sendJrMatterAssigned).not.toHaveBeenCalled();
    expect(emailMock.sendJrArtifactAwaitingCounsel).not.toHaveBeenCalled();
    expect(emailMock.sendJrCounselChangesRequested).not.toHaveBeenCalled();
    expect(emailMock.sendJrSettlementRecorded).not.toHaveBeenCalled();
  });

  it('(b) matterAssigned to a resolvable assignee fires bell + email once', async () => {
    process.env.JR_NOTIFY_ENABLED = 'true';
    const { service, prismaMock, emailMock, notificationsMock } = build();
    prismaMock.userAccount.findUnique.mockResolvedValue(activeUser('assignee-1'));

    await service.matterAssigned(MATTER, 'assignee-1', 'actor-9', 'The JR Head');

    expect(notificationsMock.create).toHaveBeenCalledTimes(1);
    expect(notificationsMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'assignee-1',
        type: 'JR_MATTER_ASSIGNED',
        link: '/jr/matters/matter-1',
      }),
    );
    expect(emailMock.sendJrMatterAssigned).toHaveBeenCalledTimes(1);
    expect(emailMock.sendJrMatterAssigned).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'assignee-1@tashfeengroup.com',
        matterId: 'matter-1',
        assignedByName: 'The JR Head',
      }),
    );
  });

  it('(c) matterAssigned where assignee === actor sends nothing (self-assign)', async () => {
    process.env.JR_NOTIFY_ENABLED = 'true';
    const { service, prismaMock, emailMock, notificationsMock } = build();

    await service.matterAssigned(MATTER, 'same-user', 'same-user', 'Self');

    expect(prismaMock.userAccount.findUnique).not.toHaveBeenCalled();
    expect(notificationsMock.create).not.toHaveBeenCalled();
    expect(emailMock.sendJrMatterAssigned).not.toHaveBeenCalled();
  });

  it('(d) artifactAwaitingCounsel with zero heads warns and sends nothing', async () => {
    process.env.JR_NOTIFY_ENABLED = 'true';
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, prismaMock, emailMock, notificationsMock } = build();
    prismaMock.userAccount.findMany.mockResolvedValue([]); // no jr_head

    await service.artifactAwaitingCounsel(MATTER, 'ALJR');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(notificationsMock.create).not.toHaveBeenCalled();
    expect(emailMock.sendJrArtifactAwaitingCounsel).not.toHaveBeenCalled();
  });

  it('(e) dedupes an author who is also a head — one email, one bell', async () => {
    process.env.JR_NOTIFY_ENABLED = 'true';
    const { service, prismaMock, emailMock, notificationsMock } = build();
    // The author resolves to u-1 …
    prismaMock.userAccount.findUnique.mockResolvedValue(activeUser('u-1'));
    // … and u-1 is ALSO the (only) jr_head.
    prismaMock.userAccount.findMany.mockResolvedValue([
      { id: 'u-1', email: 'u-1@tashfeengroup.com', employee: { firstName: 'Ada', lastName: 'Lovelace' } },
    ]);

    await service.counselChangesRequested(MATTER, 'Memorandum', 'u-1');

    expect(notificationsMock.create).toHaveBeenCalledTimes(1);
    expect(emailMock.sendJrCounselChangesRequested).toHaveBeenCalledTimes(1);
  });
});
