/**
 * Scan the demo database for production identifiers. Exit code 1 on any hit.
 *
 *   npm run demo:leak-check
 *   node dist/modules/demo/cli/leak-check.js
 *
 * Env: DEMO_SYNC_SOURCE_DATABASE_URL (read-only prod), DATABASE_URL (demo),
 * DEMO_LIVE_PHONE_NUMBER_IDS (rows under those channels are skipped),
 * DEMO_STAFF_KEEP (real staff emails deliberately kept).
 */
import { demoLivePhoneNumberIds } from '../../../common/demo-mode';
import { DemoLeakChecker } from '../leak-check';
import { poolFromUrl } from '../sync/engine';

async function main(): Promise<void> {
  const sourceUrl = process.env.DEMO_SYNC_SOURCE_DATABASE_URL;
  const targetUrl = process.env.DEMO_SYNC_TARGET_DATABASE_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!sourceUrl || !targetUrl) throw new Error('DEMO_SYNC_SOURCE_DATABASE_URL and DATABASE_URL are required');
  if (sourceUrl === targetUrl) throw new Error('source and target are the same database — refusing');
  const source = poolFromUrl(sourceUrl, { max: 2, readOnly: true, statementTimeoutMs: 600_000 });
  const target = poolFromUrl(targetUrl, { max: 2 });
  const checker = new DemoLeakChecker(source, target, {
    livePhoneNumberIds: demoLivePhoneNumberIds(),
    allowEmails: (process.env.DEMO_STAFF_KEEP ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    maxFindings: Number(process.env.DEMO_LEAK_MAX_FINDINGS ?? 200),
    log: (m) => console.log(`[leak-check] ${m}`),
  });
  const report = await checker.run();
  await source.end();
  await target.end();
  console.log(
    `\nscanned ${report.scannedTables} tables / ${report.scannedRows} rows / ${report.scannedValues} values in ${report.ms}ms ` +
      `against ${report.realPhones} phone forms, ${report.realEmails} emails, ${report.realNames} names (${report.ambiguousNamesSkipped} ambiguous names skipped)`,
  );
  if (report.ok) {
    console.log('LEAK CHECK PASSED — no production identifier found in the demo database.');
    process.exit(0);
  }
  console.error(`\nLEAK CHECK FAILED — ${report.findings.length}${report.truncated ? '+' : ''} finding(s):`);
  for (const f of report.findings) console.error(`  ${f.kind.padEnd(11)} ${f.table}.${f.column} pk=${f.pk} match=${f.match}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
