import {
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { FaceAttendanceService } from './face-attendance.service';

/**
 * Hikvision NVR "alarm server" ingest endpoint. The on-site NVR is configured to
 * POST face-capture snapshots here (outbound HTTP listening mode) — we are the
 * server, the NVR is the client, so no inbound access to the NVR is needed.
 *
 * The route is deliberately SHORT (`/hik/:secret`) because some Hikvision
 * firmware caps the destination URL length (~64 chars). Auth = an unguessable
 * secret path segment (HIK_INGEST_SECRET), constant-time compared; pair it with
 * HTTPS (Railway terminates TLS) and, ideally, an NVR source-IP allowlist at the
 * edge. The raw request body is provided as a Buffer by the per-path `raw()`
 * body parser mounted in main.ts.
 */
@Controller('hik')
export class HikIngestController {
  private readonly log = new Logger('HikIngest');

  constructor(private readonly svc: FaceAttendanceService) {}

  @Post(':secret')
  @HttpCode(200)
  async ingest(@Param('secret') secret: string, @Req() req: Request): Promise<string> {
    if (!this.validSecret(secret)) throw new UnauthorizedException();

    const body: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from((req.body as Buffer | undefined) ?? []);
    const contentType = (req.headers['content-type'] as string) ?? '';

    // Never fail the NVR's POST — parse/persist errors are logged, not surfaced,
    // so the device doesn't retry-storm. Heavy work is scheduled async inside.
    try {
      const r = await this.svc.ingestNvrPush(body, contentType);
      if (r.status !== 'accepted') this.log.debug(`ingest ${r.status}`);
    } catch (e) {
      this.log.error(`ingest failed: ${(e as Error).message}`);
    }
    return 'OK';
  }

  private validSecret(secret: string): boolean {
    // Dedicated secret only — do NOT fall back to ATTENDANCE_SYNC_API_KEY
    // (keeps the camera-directory key and this ingest key independent).
    const expected = process.env.HIK_INGEST_SECRET ?? '';
    if (!expected || !secret) return false;
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
