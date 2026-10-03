import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompleteResult, InitResult, PartUrl, SignPartsResponse } from './api-types.ts';
import { uploadVersionResumable } from './version-resumable.ts';
import type { VersionResumableDeps } from './version-resumable.ts';

/**
 * uploadVersionResumable drives ONE big new-version upload with injected fakes
 * (no real network, no real timers): init → PUT parts (signing any URL it does
 * not already hold) → complete-poll. It never tracks ETags — a part upload is
 * just a PUT of the slice, and the fake "server" completes from what was PUT.
 */

const EXP = new Date(Date.now() + 3600_000).toISOString();
const partUrl = (n: number): PartUrl => ({ partNumber: n, url: `https://r2/${n}`, headers: { 'x-test': '1' } });

/** A File stand-in: slice() returns the byte range so the fake PUT can assert it. */
function fakeFile(size: number, name = 'big.iso', type = 'application/octet-stream') {
  return {
    name,
    type,
    size,
    slice: (start: number, end: number) => ({ start, end, size: end - start }),
  } as unknown as File;
}

interface PutRecord {
  part: number;
  start: number;
  end: number;
}

class FakeTransport {
  puts: PutRecord[] = [];
  signCalls: number[][] = [];
  completeCalls: number[][] = [];
  completeScript: CompleteResult[];
  constructor(completeScript: CompleteResult[]) {
    this.completeScript = completeScript;
  }

  async signParts(_id: string, partNumbers: number[]): Promise<SignPartsResponse> {
    this.signCalls.push(partNumbers);
    return { parts: partNumbers.map(partUrl), urlsExpireAt: EXP };
  }

  async put(part: PartUrl, body: unknown, onProgress: (loaded: number) => void): Promise<void> {
    assert.equal(part.headers?.['x-test'], '1', 'the presigned headers are sent');
    const b = body as { start?: number; end?: number; size: number };
    const start = b.start ?? 0;
    const end = b.end ?? b.size;
    this.puts.push({ part: part.partNumber, start, end });
    onProgress((end - start) / 2); // mid-flight
    onProgress(end - start); // the whole slice landed
  }

  async complete(ids: string[]): Promise<{ results: CompleteResult[] }> {
    this.completeCalls.push([...ids].map(() => 1));
    const i = Math.min(this.completeCalls.length - 1, this.completeScript.length - 1);
    return { results: [this.completeScript[i]] };
  }
}

const noSleep = async () => undefined;
const hashOk = async () => 'a'.repeat(64);

function deps(
  init: { mode: 'proxy' } | { mode: 'direct'; maxBytes: number; result: InitResult },
  transport: FakeTransport,
  initSeq?: Array<{ mode: 'proxy' } | { mode: 'direct'; maxBytes: number; result: InitResult }>,
): VersionResumableDeps {
  let call = 0;
  return {
    initVersion: async () => {
      if (initSeq) return initSeq[Math.min(call++, initSeq.length - 1)];
      return init;
    },
    transport,
    hashFile: hashOk,
    sleep: noSleep,
  };
}

const uploadResult = (over: Partial<Extract<InitResult, { status: 'upload' }>> = {}): InitResult => ({
  index: 0,
  status: 'upload',
  uploadId: 'u1',
  strategy: 'MULTIPART',
  partSize: 10,
  partCount: 2,
  doneParts: [],
  urls: [partUrl(1)],
  urlsExpireAt: EXP,
  resumed: false,
  sessionExpiresAt: EXP,
  ...over,
});

const direct = (result: InitResult) => ({ mode: 'direct' as const, maxBytes: 2_147_483_647, result });
const completed: CompleteResult = { id: 'u1', status: 'completed', file: { id: 'file-1' } };

test('multipart happy path: init → PUT part 1 (held url) + sign & PUT part 2 → complete → file; progress reaches 1', async () => {
  const t = new FakeTransport([completed]);
  const progress: number[] = [];
  const file = fakeFile(15); // part1 = 10 bytes, part2 = 5 bytes
  const out = await uploadVersionResumable(deps(direct(uploadResult()), t), 'F1', file, {
    onProgress: (f) => progress.push(f),
  });
  assert.deepEqual(out, { id: 'file-1' });
  assert.deepEqual(t.signCalls, [[2]], 'only the url it did not hold is signed');
  assert.deepEqual(
    t.puts,
    [
      { part: 1, start: 0, end: 10 },
      { part: 2, start: 10, end: 15 },
    ],
    'both slices PUT with the planned byte ranges',
  );
  assert.equal(progress.at(-1), 1, 'progress ends at 1');
  assert.ok(
    progress.every((p) => p >= 0 && p <= 1),
    'progress stays within 0..1',
  );
});

test('resume: doneParts:[1] → only part 2 is PUT and initial progress reflects part 1', async () => {
  const t = new FakeTransport([completed]);
  const progress: number[] = [];
  const file = fakeFile(15);
  // On a resume the server hands back the urls for the still-needed part(s).
  await uploadVersionResumable(deps(direct(uploadResult({ doneParts: [1], urls: [partUrl(2)] })), t), 'F1', file, {
    onProgress: (f) => progress.push(f),
  });
  assert.deepEqual(t.signCalls, [], 'nothing to sign — the resume url was supplied');
  assert.deepEqual(t.puts, [{ part: 2, start: 10, end: 15 }], 'only the missing part is PUT');
  assert.ok(progress[0] >= 10 / 15 - 1e-9, `initial progress counts part 1 (${progress[0]})`);
  assert.equal(progress.at(-1), 1);
});

test('missing-parts: complete says [2] → re-sign + PUT part 2 → re-complete → completed', async () => {
  const missing: CompleteResult = { id: 'u1', status: 'missing-parts', missingParts: [2] };
  const t = new FakeTransport([missing, completed]);
  // Pretend both parts were already PUT in step 3; the server lost part 2.
  const out = await uploadVersionResumable(deps(direct(uploadResult({ doneParts: [1, 2], urls: [] })), t), 'F1', fakeFile(15));
  assert.deepEqual(out, { id: 'file-1' });
  assert.deepEqual(t.signCalls, [[2]], 'the missing part is re-signed');
  assert.deepEqual(t.puts, [{ part: 2, start: 10, end: 15 }], 'the missing part is re-PUT');
  assert.equal(t.completeCalls.length, 2, 'completed only after the re-PUT');
});

test('in-progress init: no parts pushed; complete-poll retries then completes', async () => {
  const retry: CompleteResult = { id: 'u1', status: 'retry', reason: 'assembling' };
  const t = new FakeTransport([retry, completed]);
  const out = await uploadVersionResumable(
    deps(direct({ index: 0, status: 'in-progress', uploadId: 'u1' }), t),
    'F1',
    fakeFile(15),
  );
  assert.deepEqual(out, { id: 'file-1' });
  assert.deepEqual(t.puts, [], 'an in-progress session pushes no parts');
  assert.equal(t.completeCalls.length, 2, 'it polled complete twice');
});

test("init 'retry' is retried then succeeds", async () => {
  const t = new FakeTransport([completed]);
  const seq = [direct({ index: 0, status: 'retry', reason: 'busy' } as InitResult), direct(uploadResult())];
  const out = await uploadVersionResumable(deps(direct(uploadResult()), t, seq), 'F1', fakeFile(15));
  assert.deepEqual(out, { id: 'file-1' });
});

test("init 'rejected' throws its reason", async () => {
  const t = new FakeTransport([completed]);
  await assert.rejects(
    uploadVersionResumable(deps(direct({ index: 0, status: 'rejected', reason: 'Too big.' }), t), 'F1', fakeFile(15)),
    /Too big\./,
  );
});

test('proxy mode throws the storage-mode message', async () => {
  const t = new FakeTransport([completed]);
  await assert.rejects(
    uploadVersionResumable(deps({ mode: 'proxy' }, t), 'F1', fakeFile(15)),
    /not available in this storage mode/,
  );
});

test("complete 'failed' throws the reason", async () => {
  const failed: CompleteResult = { id: 'u1', status: 'failed', reason: 'Checksum mismatch.' };
  const t = new FakeTransport([failed]);
  await assert.rejects(
    uploadVersionResumable(deps(direct(uploadResult()), t), 'F1', fakeFile(15)),
    /Checksum mismatch\./,
  );
});
