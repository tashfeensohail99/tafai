import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WhatsAppMetaClientFactory } from './client.factory';

/**
 * Self-healing WhatsApp CALLING configuration. On every boot this applies the
 * FULL calling block Meta needs — so "everything the calls need" is loaded
 * automatically, with no manual scripts, and any drift (Meta reset, a manual
 * dashboard edit, a newly-added channel) is corrected on the next restart.
 *
 * Applied per ACTIVE channel (calling settings live on the NUMBER, so this one
 * config serves BOTH the web CallDock and the mobile app — the clients just
 * read /ice + place/answer calls; there is nothing per-client to configure):
 *   • status=ENABLED + call_icon_visibility=DEFAULT — calling on, button shown;
 *   • callback_permission_status — Meta prompts the customer for callback
 *     permission after a missed/ended call (grants land on the
 *     call_permission_reply webhook we already ingest);
 *   • call_hours — hides the call button outside business hours so off-hours
 *     callers message instead of producing an unanswerable missed call.
 *
 * All values are env-tunable (change hours via Railway vars, no code change):
 *   WHATSAPP_CALLING_AUTOCONFIG   'off'/'false' → skip entirely (default ON)
 *   WHATSAPP_CALLBACK_PERMISSION  ENABLED (default) | DISABLED | NOT_SET
 *   WHATSAPP_CALL_HOURS           'off'/'false' → 24/7, no hours (default ON)
 *   WHATSAPP_CALL_HOURS_OPEN      'HHMM' 24h (default 0900)
 *   WHATSAPP_CALL_HOURS_CLOSE     'HHMM' 24h (default 1800)
 *   WHATSAPP_CALL_HOURS_DAYS      CSV of MONDAY..SUNDAY (default MON–SAT)
 *   WHATSAPP_CALL_HOURS_TZ        IANA tz (default Asia/Karachi)
 *
 * Setting calling config requires the number's OWN access token (only the
 * backend can decrypt it) — hence this runs here. Fully guarded; a Meta hiccup
 * logs and moves on, never blocks boot. OnApplicationBootstrap so it runs once
 * the app (DB, Meta client factory) is fully wired.
 */
@Injectable()
export class CallingBootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger(CallingBootstrapService.name);

  private static readonly ALL_DAYS = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaFactory: WhatsAppMetaClientFactory,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const off = (v: string | undefined) => v === 'off' || v === 'false';
    if (off(process.env.WHATSAPP_CALLING_AUTOCONFIG)) {
      this.log.log('calling-autoconfig: disabled (WHATSAPP_CALLING_AUTOCONFIG=off)');
      return;
    }

    const cfg = this.resolveConfig();
    this.log.log(`calling-autoconfig: applying ${JSON.stringify(cfg)} to ACTIVE channels`);

    try {
      const channels = await this.prisma.whatsAppChannel.findMany({
        where: { status: 'ACTIVE' },
      });
      if (channels.length === 0) {
        this.log.warn('calling-autoconfig: no ACTIVE channels found');
        return;
      }
      for (const channel of channels) {
        const tag = `calling-autoconfig[${channel.displayNumber}]`;
        try {
          const client = this.metaFactory.forChannel(channel);
          const res = await client.applyCallingSettings(cfg);
          this.log.log(`${tag} applied — response=${JSON.stringify(res)}`);
          // Verify so the boot log shows exactly what Meta now serves.
          const after = await client.getPhoneSettings();
          this.log.log(
            `${tag} live calling=${JSON.stringify((after as { calling?: unknown }).calling ?? null)}`,
          );
        } catch (err) {
          // Best-effort: never let a Meta error take down boot. Common causes:
          // an expired channel token, or Meta not yet supporting a field on
          // this WABA (then raise META_GRAPH_API_VERSION).
          this.log.error(`${tag} FAILED: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.log.error(`calling-autoconfig bootstrap failed: ${(err as Error).message}`);
    }
  }

  /** Build the calling config from env with the current live defaults. */
  private resolveConfig(): {
    callbackPermissionStatus: 'ENABLED' | 'DISABLED';
    callHours: {
      enabled: boolean;
      timezoneId: string;
      days: string[];
      openTime: string;
      closeTime: string;
    };
  } {
    const off = (v: string | undefined) => v === 'off' || v === 'false';

    // Meta accepts only ENABLED / DISABLED for POST (NOT_SET is a GET-only
    // state). Anything else (incl. an accidental NOT_SET) → the ENABLED default.
    const cbRaw = (process.env.WHATSAPP_CALLBACK_PERMISSION ?? 'ENABLED').toUpperCase();
    const callbackPermissionStatus: 'ENABLED' | 'DISABLED' = cbRaw === 'DISABLED' ? 'DISABLED' : 'ENABLED';

    // Always carry a valid timezone + hours so the disabled (24/7) form can send
    // Meta's required fields too. enabled=false when WHATSAPP_CALL_HOURS=off.
    const enabled = !off(process.env.WHATSAPP_CALL_HOURS);
    const openTime = this.normHHMM(process.env.WHATSAPP_CALL_HOURS_OPEN, '0900');
    const closeTime = this.normHHMM(process.env.WHATSAPP_CALL_HOURS_CLOSE, '1800');
    const days = this.resolveDays(process.env.WHATSAPP_CALL_HOURS_DAYS);
    const timezoneId = (process.env.WHATSAPP_CALL_HOURS_TZ || 'Asia/Karachi').trim();

    return { callbackPermissionStatus, callHours: { enabled, timezoneId, days, openTime, closeTime } };
  }

  /** Coerce an env time to Meta's 4-digit 24h 'HHMM' form. Accepts '0930',
   *  '930', '9:30', '09:30' — a 3-digit value is left-padded (930 → 0930) so a
   *  single-digit hour isn't silently misread as the fallback. Invalid → fallback. */
  private normHHMM(raw: string | undefined, fallback: string): string {
    let digits = (raw ?? '').replace(/[^\d]/g, '');
    if (digits.length === 3) digits = `0${digits}`; // 930 → 0930, 9:30 → 0930
    if (/^\d{4}$/.test(digits)) {
      const h = Number(digits.slice(0, 2));
      const m = Number(digits.slice(2));
      if (h <= 23 && m <= 59) return digits;
    }
    return fallback;
  }

  /** Resolve the working-days CSV; unknown tokens are dropped, empty → MON–SAT. */
  private resolveDays(raw: string | undefined): string[] {
    if (!raw || !raw.trim()) return CallingBootstrapService.ALL_DAYS.slice(0, 6);
    const wanted = raw
      .split(',')
      .map((d) => d.trim().toUpperCase())
      .filter((d) => CallingBootstrapService.ALL_DAYS.includes(d));
    // De-dupe + keep Meta's weekday order; fall back to MON–SAT if all invalid.
    const days = CallingBootstrapService.ALL_DAYS.filter((d) => wanted.includes(d));
    return days.length > 0 ? days : CallingBootstrapService.ALL_DAYS.slice(0, 6);
  }
}
