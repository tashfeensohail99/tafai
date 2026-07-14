/**
 * Flip a runtime behavior flag on the published mobile manifest (app/latest.json,
 * served verbatim by GET /public/app/info). The app reads these at runtime, so
 * this changes app behavior WITHOUT a rebuild / forced update.
 *
 * Prefer the admin portal (Admin → Settings → Mobile App) for day-to-day flips;
 * this CLI is the fallback / for use from `railway run`.
 *
 * Currently supports the lead-detail WhatsApp button mode:
 *   railway run npx tsx scripts/set-mobile-flag.ts personal   # rep's own WhatsApp (campaign)
 *   railway run npx tsx scripts/set-mobile-flag.ts crm        # in-app CRM inbox (default/permanent)
 *
 * Read-modify-write: preserves version/size/etc., only touches leadWhatsappMode.
 */
import { StorageService } from '../src/modules/storage/storage.service';
import { APP_INFO_KEY } from '../src/modules/public-downloads/public-downloads.controller';

async function main() {
  const mode = (process.argv[2] ?? '').toLowerCase();
  if (mode !== 'personal' && mode !== 'crm') {
    throw new Error("usage: set-mobile-flag.ts <personal|crm>");
  }
  const storage = new StorageService();

  const { bytes } = await storage.download(APP_INFO_KEY);
  const info = JSON.parse(bytes.toString('utf-8')) as Record<string, unknown>;
  const before = info.leadWhatsappMode ?? '(unset → app default: crm)';
  info.leadWhatsappMode = mode;

  await storage.uploadAt(
    APP_INFO_KEY,
    Buffer.from(JSON.stringify(info, null, 2)),
    'application/json',
  );
  console.log(`leadWhatsappMode: ${before} -> ${mode}`);
  console.log('Live now on GET /public/app/info. Apps pick it up on next lead-detail open (no update needed).');
}

void main();
