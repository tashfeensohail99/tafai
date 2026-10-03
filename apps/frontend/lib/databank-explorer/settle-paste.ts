/**
 * Settle a batch of clipboard paste jobs WITHOUT ever rejecting.
 *
 * A paste can involve several files/folders; one dead source (its row was
 * deleted/moved after it went on the clipboard → a 404) must not abort the
 * whole paste, and the caller's `finally` (the tree reload) must always run.
 * So every job is caught: a 404 / "not found" is classified `gone` (the UI
 * prunes it from the clipboard), anything else is a transient failure the UI
 * reports but keeps.
 */

export type PasteJob = { id: string; name: string; go: () => Promise<void> };
export type Settled = {
  succeeded: string[];
  failed: Array<{ id: string; name: string; gone: boolean }>;
};

export async function settlePaste(
  jobs: PasteJob[],
  run: (j: PasteJob) => Promise<void>,
  limit = 4,
): Promise<Settled> {
  const succeeded: string[] = [];
  const failed: Array<{ id: string; name: string; gone: boolean }> = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const j = jobs[cursor];
      cursor += 1;
      try {
        await run(j);
        succeeded.push(j.id);
      } catch (e) {
        const err = e as { status?: number; message?: string } | undefined;
        const gone = err?.status === 404 || /not found/i.test(err?.message ?? '');
        failed.push({ id: j.id, name: j.name, gone });
      }
    }
  }

  const workers = Math.max(1, Math.min(limit, jobs.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return { succeeded, failed };
}
