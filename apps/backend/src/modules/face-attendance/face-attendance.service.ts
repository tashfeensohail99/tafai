import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  AttendanceStatus,
  FaceCaptureStatus,
  Prisma,
  PunchDirection,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FaceWorkerClient } from './face-worker.client';
import { extractFaceEvent, isFaceEvent } from './hik-multipart';

const PKT_OFFSET_MS = 5 * 3600 * 1000; // Asia/Karachi, no DST
type Db = Prisma.TransactionClient;

/**
 * Online face-recognition attendance driven by the on-site Hikvision NVR.
 *
 * The NVR captures a face on human-detection and pushes the snapshot to our
 * ingest endpoint. We embed it via the Python face-worker (InsightFace ArcFace,
 * 512-d, the SAME model as the Summit box), match the nearest enrolled employee
 * by cosine distance (`<=>`) in pgvector, then collapse the several captures the
 * NVR fires per person-pass into ONE punch and roll the day's punches into
 * `core.attendance_records` with the same policy as the camera bridge so the
 * existing payroll engine consumes it unchanged.
 *
 * Concurrency: each capture is processed independently (async), so punch
 * creation runs inside a per-employee Postgres advisory-lock transaction and the
 * "same person still in view" decision is anchored on the last SEEN capture (not
 * the last punch), with the punch id propagated across a presence — this makes
 * a burst produce exactly one punch and a lingering person not flip-flop.
 *
 * The `embedding` column is a pgvector type Prisma can't map, so vector
 * inserts/queries use raw SQL with a `$N::vector` cast (mirrors knowledge.service).
 */
@Injectable()
export class FaceAttendanceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FaceAttendance');
  // This codebase drives periodic work with setInterval, not @nestjs/schedule.
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  // ArcFace embeddings are unit vectors; cosine similarity in [−1,1]. Summit's
  // box accepts a match at sim ≥ 0.40 — mirror it. Tune with FACE_MIN_COSINE.
  private readonly minCosine = parseFloat(process.env.FACE_MIN_COSINE ?? '0.40');
  // A gap in sightings ≥ this ends a "presence": the next sighting is a new
  // pass and toggles IN/OUT. Continuous sightings closer than this are one
  // presence and never re-punch. Tune with FACE_PRESENCE_GAP_SEC.
  private readonly presenceGapSec = parseInt(
    process.env.FACE_PRESENCE_GAP_SEC ?? process.env.FACE_PUNCH_DEBOUNCE_SEC ?? '30',
    10,
  );
  // "Multiple pictures for accuracy": confirming captures needed within the
  // burst window before a NEW presence commits a punch. Default 1 (never drops a
  // real pass); raise to reject single-frame false accepts (small risk of
  // dropping a very brief pass — see FACE_BURST_WINDOW_SEC).
  private readonly requireVotes = Math.max(1, parseInt(process.env.FACE_REQUIRE_VOTES ?? '1', 10));
  private readonly burstWindowSec = parseInt(process.env.FACE_BURST_WINDOW_SEC ?? '10', 10);
  // Reject an NVR capture time that is off from server time by more than this
  // (clock drift / missing offset) and fall back to server time, so a bad NVR
  // clock can't file attendance on the wrong day.
  private readonly maxClockSkewSec = parseInt(process.env.FACE_MAX_CLOCK_SKEW_SEC ?? '3600', 10);
  // Optional per-NVR-channel mapping — for a door with a dedicated entry camera
  // and exit camera, direction comes from the CHANNEL (not IN/OUT alternation),
  // and each channel can pin the branch. JSON keyed by channelId, e.g.
  //   {"1":{"direction":"IN","branchId":"<id>"},"2":{"direction":"OUT","branchId":"<id>"}}
  private channelMap: Record<string, { direction?: 'IN' | 'OUT'; branchId?: string }> = {};
  // When true, ONLY channels present in channelMap produce attendance — the
  // "choose N cameras out of the NVR's many" guard. Other channels are still
  // counted (so they show up in the pick-list) but never create a punch.
  private readonly onlyMappedChannels = process.env.FACE_ONLY_MAPPED_CHANNELS === 'true';
  // Live registry of every NVR channel seen pushing (auto-detect, for setup).
  private readonly channelSeen = new Map<string, { count: number; lastSeen: Date }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly worker: FaceWorkerClient,
    private readonly storage: StorageService,
  ) {
    try {
      this.channelMap = JSON.parse(process.env.FACE_CHANNEL_MAP ?? '{}');
    } catch {
      this.log.warn('FACE_CHANNEL_MAP is not valid JSON — ignoring (falling back to IN/OUT alternation)');
    }
  }

  /** Fixed direction + branch for an NVR channel, if configured (entry/exit cams). */
  private channelConfig(channelId: string | null): { direction?: PunchDirection; branchId?: string } {
    const c = channelId ? this.channelMap[channelId] : undefined;
    if (!c) return {};
    const direction =
      c.direction === 'IN' ? PunchDirection.IN : c.direction === 'OUT' ? PunchDirection.OUT : undefined;
    return { direction, branchId: c.branchId };
  }

  private noteChannel(channelId: string | null | undefined, at: Date): void {
    if (!channelId) return;
    const s = this.channelSeen.get(channelId) ?? { count: 0, lastSeen: at };
    s.count += 1;
    s.lastSeen = at;
    this.channelSeen.set(channelId, s);
  }

  /** NVR channels (cameras) seen pushing + their configured role — for setup. */
  listChannels() {
    const channels = [...this.channelSeen.entries()]
      .map(([channelId, s]) => {
        const cfg = this.channelMap[channelId];
        return {
          channelId,
          captures: s.count,
          lastSeen: s.lastSeen,
          chosen: Boolean(cfg),
          direction: cfg?.direction ?? null,
          branchId: cfg?.branchId ?? null,
          producesAttendance: !this.onlyMappedChannels || Boolean(cfg),
        };
      })
      .sort((a, b) => b.captures - a.captures);
    return { onlyMappedChannels: this.onlyMappedChannels, channels };
  }

  onModuleInit(): void {
    // Recover any captures left PENDING by a crash/restart shortly after boot,
    // then keep sweeping periodically (setInterval, matching the codebase).
    setTimeout(() => void this.sweepPending().catch(() => undefined), 30_000);
    this.sweepTimer = setInterval(() => {
      void this.sweepPending().catch((e) => this.log.warn(`sweep failed: ${(e as Error).message}`));
    }, 120_000);
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  // ── PKT day helpers (mirror AttendanceService) ────────────────────────────
  private pktYmd(instant: Date): string {
    return new Date(instant.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
  }
  private dateOnly(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
  }
  private pktDayBounds(ymd: string): { start: Date; end: Date } {
    const start = new Date(`${ymd}T00:00:00.000+05:00`);
    return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
  }
  /** 09:00 PKT + 20-min grace → PRESENT/LATE + lateMin (same policy as the bridge). */
  private statusFromCheckIn(checkIn: Date): { status: AttendanceStatus; lateMin: number } {
    const pkt = new Date(checkIn.getTime() + PKT_OFFSET_MS);
    const minutes = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
    const lateMin = Math.max(0, minutes - 9 * 60);
    return { status: lateMin > 20 ? AttendanceStatus.LATE : AttendanceStatus.PRESENT, lateMin };
  }
  private vec(d: number[]): string {
    return `[${d.join(',')}]`;
  }
  private assert512(d: number[]): void {
    if (!Array.isArray(d) || d.length !== 512 || d.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      throw new BadRequestException('embedding must be exactly 512 finite numbers');
    }
  }
  /** Trust the NVR's capture time only if it's close to server time. */
  private clampCaptureTime(capturedAt?: Date): Date {
    const now = new Date();
    if (!capturedAt || Number.isNaN(capturedAt.getTime())) return now;
    if (Math.abs(capturedAt.getTime() - now.getTime()) > this.maxClockSkewSec * 1000) {
      this.log.warn(
        `NVR capturedAt ${capturedAt.toISOString()} is far from server time — using server time`,
      );
      return now;
    }
    return capturedAt;
  }

  // ── enrollment ────────────────────────────────────────────────────────────
  /** Store one 512-d embedding sample for an employee. */
  async enroll(employeeId: string, embedding: number[], createdByUserId: string, quality?: number) {
    this.assert512(embedding);
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    const id = randomUUID();
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO core.face_enrollments (id, "employeeId", embedding, "modelVersion", quality, "createdByUserId", "createdAt")
       VALUES ($1, $2, $3::vector, 'insightface-buffalo_l-512', $4, $5, NOW())`,
      id,
      employeeId,
      this.vec(embedding),
      quality ?? null,
      createdByUserId,
    );
    const samples = await this.prisma.faceEnrollment.count({ where: { employeeId } });
    this.log.log(`face enrolled: employee=${employeeId} sample#${samples} by ${createdByUserId}`);
    return { id, employeeId, samples };
  }

  /** Enroll from an uploaded photo: worker embeds the largest face, we store it. */
  async enrollFromImage(employeeId: string, image: Buffer, createdByUserId: string) {
    const face = await this.worker.embedLargest(image);
    if (!face) {
      throw new BadRequestException('No face detected — use a clear, front-facing, well-lit photo.');
    }
    return this.enroll(employeeId, face.embedding, createdByUserId, face.detScore);
  }

  // ── recognition (nearest cosine among active employees) ───────────────────
  async recognize(embedding: number[]): Promise<{ employeeId: string; similarity: number } | null> {
    this.assert512(embedding);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ employeeId: string; distance: number }>>(
      `SELECT fe."employeeId", MIN(fe.embedding <=> $1::vector) AS distance
         FROM core.face_enrollments fe
         JOIN core.employees e ON e.id = fe."employeeId"
        WHERE e."deletedAt" IS NULL AND e."isActive" = true
        GROUP BY fe."employeeId"
        ORDER BY distance ASC
        LIMIT 1`,
      this.vec(embedding),
    );
    if (!rows.length) return null;
    // pgvector cosine distance = 1 − cosine similarity.
    return { employeeId: rows[0].employeeId, similarity: 1 - Number(rows[0].distance) };
  }

  /** Admin test: embed an image + return the best match (no punch recorded). */
  async identifyFromImage(image: Buffer) {
    const face = await this.worker.embedLargest(image);
    if (!face) return { matched: false as const, reason: 'no_face' as const };
    const match = await this.recognize(face.embedding);
    if (!match || match.similarity < this.minCosine) {
      return { matched: false as const, reason: 'unknown' as const, similarity: match?.similarity ?? null };
    }
    const emp = await this.prisma.employee.findFirst({
      where: { id: match.employeeId, deletedAt: null },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    return {
      matched: true as const,
      employeeId: match.employeeId,
      name: emp ? `${emp.firstName} ${emp.lastName}`.trim() : match.employeeId,
      code: emp?.employeeCode ?? null,
      similarity: Math.round(match.similarity * 1000) / 1000,
    };
  }

  // ── NVR ingest (fast path — parse, persist, schedule async processing) ─────
  /**
   * Handle one raw Hikvision alarm-server push. Kept fast so we can reply 200 to
   * the NVR promptly: parse → dedup → create a PENDING event → store image →
   * schedule async embedding/matching.
   */
  async ingestNvrPush(
    body: Buffer,
    contentType: string,
  ): Promise<{ status: 'ignored' | 'duplicate' | 'accepted'; eventId?: string }> {
    const ev = extractFaceEvent(body, contentType);
    if (!isFaceEvent(ev.eventType) || !ev.image || ev.image.length < 512) {
      return { status: 'ignored' };
    }
    const capturedAt = this.clampCaptureTime(ev.capturedAt);

    // Auto-detect: remember every channel we see, so the admin can pick cameras.
    this.noteChannel(ev.channelId, capturedAt);
    // Camera allowlist: when locked to chosen cameras, drop every other channel
    // (they're still counted above so they appear in the pick-list).
    if (this.onlyMappedChannels && !(ev.channelId && this.channelMap[ev.channelId])) {
      return { status: 'ignored' };
    }

    // Dedup on the NVR's event uuid (the unique index also guards races).
    if (ev.eventUuid) {
      const dupe = await this.prisma.faceCaptureEvent.findUnique({
        where: { eventUuid: ev.eventUuid },
        select: { id: true },
      });
      if (dupe) return { status: 'duplicate', eventId: dupe.id };
    }

    // Create the event row FIRST, so a concurrent-duplicate (P2002) can't leave
    // an orphaned upload behind.
    let event: { id: string };
    try {
      event = await this.prisma.faceCaptureEvent.create({
        data: {
          eventUuid: ev.eventUuid ?? null,
          channelId: ev.channelId ?? null,
          deviceId: ev.deviceId ?? null,
          source: 'NVR',
          capturedAt,
          status: FaceCaptureStatus.PENDING,
        },
        select: { id: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { status: 'duplicate' };
      throw e;
    }

    // Persist the JPEG for audit + restart recovery (best-effort).
    try {
      const up = await this.storage.upload(ev.image, 'image/jpeg', 'attendance-faces', 'capture.jpg');
      await this.prisma.faceCaptureEvent.update({
        where: { id: event.id },
        data: { imageObjectKey: up.key },
      });
    } catch (e) {
      this.log.warn(`capture image upload failed (continuing): ${(e as Error).message}`);
    }

    // Fire-and-forget: embed + match + punch off the request path ("delayed but
    // still gets the attendance done"). The sweeper recovers anything left PENDING.
    const image = ev.image;
    const id = event.id;
    setImmediate(() => {
      void this.processCapture(id, image).catch((err) =>
        this.log.error(`processCapture ${id} failed: ${(err as Error).message}`),
      );
    });

    return { status: 'accepted', eventId: event.id };
  }

  // ── NVR processing (embed → match → burst-aggregate → punch) ───────────────
  async processCapture(eventId: string, image: Buffer): Promise<void> {
    const event = await this.prisma.faceCaptureEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== FaceCaptureStatus.PENDING) return;

    try {
      const face = await this.worker.embedLargest(image);
      if (!face) {
        await this.finishEvent(eventId, { status: FaceCaptureStatus.UNMATCHED });
        return;
      }
      const match = await this.recognize(face.embedding);
      if (!match || match.similarity < this.minCosine) {
        await this.finishEvent(eventId, {
          status: FaceCaptureStatus.UNMATCHED,
          detScore: face.detScore,
          similarity: match?.similarity ?? null,
        });
        return;
      }
      // Record the match first so it counts as a confirming vote for aggregation.
      await this.finishEvent(eventId, {
        status: FaceCaptureStatus.MATCHED,
        matchedEmployeeId: match.employeeId,
        similarity: match.similarity,
        detScore: face.detScore,
      });
      await this.aggregateAndPunch(
        { id: eventId, capturedAt: event.capturedAt, channelId: event.channelId },
        match.employeeId,
        match.similarity,
      );
    } catch (e) {
      await this.finishEvent(eventId, {
        status: FaceCaptureStatus.ERROR,
        error: (e as Error).message.slice(0, 300),
      });
    }
  }

  private async finishEvent(
    id: string,
    data: {
      status: FaceCaptureStatus;
      matchedEmployeeId?: string | null;
      similarity?: number | null;
      detScore?: number | null;
      error?: string | null;
    },
  ): Promise<void> {
    await this.prisma.faceCaptureEvent.update({
      where: { id },
      data: { ...data, processedAt: new Date() },
    });
  }

  /**
   * Turn a confirmed match into at most one punch per person-pass. Runs inside a
   * per-employee advisory-lock transaction so concurrent captures of the same
   * person in one NVR burst can't each create a punch (TOCTOU race). Continuity
   * is anchored on the last SEEN capture (not the last punch): while the person
   * keeps being captured within `presenceGapSec`, the punch id is propagated
   * across their captures and no new punch is created; only a real gap in
   * sightings starts a new presence and toggles IN/OUT.
   */
  private async aggregateAndPunch(
    event: { id: string; capturedAt: Date; channelId: string | null },
    employeeId: string,
    similarity: number,
  ): Promise<void> {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!emp) return;

    const capturedAt = event.capturedAt;
    const ymd = this.pktYmd(capturedAt);
    const { start, end } = this.pktDayBounds(ymd);

    await this.prisma.$transaction(
      async (tx) => {
        // Serialize all punch decisions for THIS employee.
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `att:${employeeId}`);

        // Prior sightings within the continuity window (the last SEEN captures).
        const seenFrom = new Date(capturedAt.getTime() - this.presenceGapSec * 1000);
        const recentSeen = await tx.faceCaptureEvent.findMany({
          where: {
            matchedEmployeeId: employeeId,
            status: FaceCaptureStatus.MATCHED,
            id: { not: event.id },
            capturedAt: { gte: seenFrom, lte: capturedAt },
          },
          orderBy: { capturedAt: 'desc' },
          select: { punchId: true },
        });
        const continuous = recentSeen.length > 0;
        const presencePunchId = recentSeen.find((s) => s.punchId)?.punchId ?? null;

        // Same continuous presence that already punched → confirm only. Propagate
        // the punch id so the marker never ages out while the person stays in view,
        // and keep the punch's best similarity.
        if (continuous && presencePunchId) {
          await tx.faceCaptureEvent.update({ where: { id: event.id }, data: { punchId: presencePunchId } });
          const p = await tx.attendancePunch.findUnique({
            where: { id: presencePunchId },
            select: { id: true, similarity: true },
          });
          if (p && similarity > (p.similarity ?? 0)) {
            await tx.attendancePunch.update({ where: { id: p.id }, data: { similarity } });
          }
          return;
        }

        // New presence (or mid-presence not yet punched): require N confirming
        // captures in the burst window before committing.
        const voteFrom = new Date(capturedAt.getTime() - this.burstWindowSec * 1000);
        const votes = await tx.faceCaptureEvent.count({
          where: {
            matchedEmployeeId: employeeId,
            status: FaceCaptureStatus.MATCHED,
            capturedAt: { gte: voteFrom, lte: capturedAt },
          },
        });
        if (votes < this.requireVotes) return; // wait for more confirming frames

        // Direction: from the camera (dedicated entry/exit channels) when the
        // channel is configured; otherwise alternate from the day's last punch.
        const cfg = this.channelConfig(event.channelId);
        let direction = cfg.direction;
        if (!direction) {
          const last = await tx.attendancePunch.findFirst({
            where: { employeeId, punchedAt: { gte: start, lt: end } },
            orderBy: { punchedAt: 'desc' },
            select: { direction: true },
          });
          direction = !last || last.direction === PunchDirection.OUT ? PunchDirection.IN : PunchDirection.OUT;
        }

        const punch = await tx.attendancePunch.create({
          data: {
            employeeId,
            punchedAt: capturedAt,
            direction,
            source: 'NVR',
            branchId: cfg.branchId ?? emp.branchId ?? null,
            kioskId: event.channelId ?? null, // NVR channel, reusing the column
            similarity,
          },
          select: { id: true },
        });
        await tx.faceCaptureEvent.update({ where: { id: event.id }, data: { punchId: punch.id } });
        await this.recomputeDay(tx, employeeId, ymd);
        this.log.log(`punch ${direction} employee=${employeeId} sim=${similarity.toFixed(3)} votes=${votes} (NVR)`);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Reprocess captures left PENDING by a crash/restart (image still in storage).
   * Runs periodically + once shortly after boot. Only touches events older than a
   * minute so it doesn't collide with the in-flight setImmediate path.
   */
  async sweepPending(): Promise<void> {
    const stale = await this.prisma.faceCaptureEvent.findMany({
      where: {
        status: FaceCaptureStatus.PENDING,
        imageObjectKey: { not: null },
        createdAt: { lt: new Date(Date.now() - 60_000) },
      },
      orderBy: { capturedAt: 'asc' },
      take: 25,
      select: { id: true, imageObjectKey: true },
    });
    if (!stale.length) return;
    this.log.log(`sweeping ${stale.length} PENDING capture(s)`);
    for (const e of stale) {
      try {
        const { bytes } = await this.storage.download(e.imageObjectKey as string);
        await this.processCapture(e.id, bytes);
      } catch (err) {
        this.log.warn(`sweep reprocess ${e.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Roll the day's punches into the AttendanceRecord (first→checkIn, last→checkOut,
   * grossPresenceMin, 09:00-grace status) so the payroll engine has real inputs.
   * Never clobbers a manual override. `db` is the surrounding transaction client.
   */
  private async recomputeDay(db: Db, employeeId: string, ymd: string): Promise<void> {
    const { start, end } = this.pktDayBounds(ymd);
    const punches = await db.attendancePunch.findMany({
      where: { employeeId, punchedAt: { gte: start, lt: end } },
      orderBy: { punchedAt: 'asc' },
      select: { punchedAt: true },
    });
    if (!punches.length) return;

    const date = this.dateOnly(ymd);
    const existing = await db.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId, date } },
      select: { isOverride: true },
    });
    if (existing?.isOverride) return;

    const checkIn = punches[0].punchedAt;
    const lastPunch = punches[punches.length - 1].punchedAt;
    const checkOut = lastPunch.getTime() > checkIn.getTime() ? lastPunch : null;
    const { status, lateMin } = this.statusFromCheckIn(checkIn);
    const grossPresenceMin = checkOut
      ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000))
      : 0;
    const notes = `NVR face attendance (${punches.length} punch${punches.length === 1 ? '' : 'es'})`;

    await db.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: {
        employeeId,
        date,
        checkInAt: checkIn,
        checkOutAt: checkOut,
        status,
        notes,
        isOverride: false,
        source: 'NVR',
        lateMin,
        grossPresenceMin,
      },
      update: {
        checkInAt: checkIn,
        checkOutAt: checkOut,
        status,
        notes,
        isOverride: false,
        source: 'NVR',
        lateMin,
        grossPresenceMin,
      },
    });
  }

  // ── admin: enrollment management ──────────────────────────────────────────
  /** Every active employee + how many face samples they have (for the enroll UI). */
  async listEnrolled() {
    const emps = await this.prisma.employee.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const grouped = await this.prisma.faceEnrollment.groupBy({
      by: ['employeeId'],
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.employeeId, g._count._all]));
    return emps.map((e) => ({
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      code: e.employeeCode ?? null,
      samples: counts.get(e.id) ?? 0,
    }));
  }

  async clearEnrollments(employeeId: string) {
    const res = await this.prisma.faceEnrollment.deleteMany({ where: { employeeId } });
    this.log.log(`cleared ${res.count} face sample(s) for employee=${employeeId}`);
    return { employeeId, removed: res.count };
  }
}
