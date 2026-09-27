import { StorageService, isNoSuchUploadError } from './storage.service';

/**
 * Offline tests for the multipart primitives (Databank Phase 1). Dummy
 * credentials; no network — presigning is local SigV4, and `s3.send` is
 * replaced with a jest mock for the list/complete/abort calls.
 */
const ENV_KEYS = [
  'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY', 'STORAGE_ENDPOINT', 'STORAGE_BUCKET',
  'SUPABASE_STORAGE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
] as const;
let saved: Record<string, string | undefined>;

function s3Service(): StorageService {
  process.env.STORAGE_ACCESS_KEY = 'AKIAFAKE';
  process.env.STORAGE_SECRET_KEY = 'fakesecret';
  process.env.STORAGE_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
  process.env.STORAGE_BUCKET = 'test-bucket';
  delete process.env.SUPABASE_STORAGE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  return new StorageService();
}
const mockSend = (svc: StorageService, impl: (cmd: { input: Record<string, unknown> }) => unknown) => {
  const send = jest.fn(async (cmd: { input: Record<string, unknown> }) => impl(cmd));
  (svc as unknown as { s3: { send: typeof send } }).s3 = { send };
  return send;
};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('StorageService multipart primitives', () => {
  it('presigns an UploadPart URL carrying partNumber + uploadId and NO checksum params', async () => {
    const svc = s3Service();
    const url = new URL(await svc.presignUploadPart('databank/clients/c1/u.bin', 'upload-123', 7));
    expect(url.pathname).toBe('/test-bucket/databank/clients/c1/u.bin');
    expect(url.searchParams.get('partNumber')).toBe('7');
    expect(url.searchParams.get('uploadId')).toBe('upload-123');
    const checksumParams = [...url.searchParams.keys()].filter((k) => /checksum/i.test(k));
    expect(checksumParams).toEqual([]); // a browser can't satisfy them (see #412)
  });

  it('follows ListParts pagination and keeps ETags verbatim (quotes included)', async () => {
    const svc = s3Service();
    const send = mockSend(svc, (cmd) =>
      cmd.input.PartNumberMarker === undefined
        ? {
            IsTruncated: true,
            NextPartNumberMarker: '2',
            Parts: [
              { PartNumber: 1, ETag: '"a1"', Size: 8 },
              { PartNumber: 2, ETag: '"a2"', Size: 8 },
            ],
          }
        : { IsTruncated: false, Parts: [{ PartNumber: 3, ETag: '"a3"', Size: 3 }] },
    );

    const parts = await svc.listAllParts('k', 'u');

    expect(parts).toEqual([
      { partNumber: 1, etag: '"a1"', sizeBytes: 8 },
      { partNumber: 2, etag: '"a2"', sizeBytes: 8 },
      { partNumber: 3, etag: '"a3"', sizeBytes: 3 },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input).toMatchObject({ Key: 'k', UploadId: 'u', PartNumberMarker: '2' });
  });

  it('continues from the last listed part when a truncated page has no marker', async () => {
    const svc = s3Service();
    const send = mockSend(svc, (cmd) =>
      cmd.input.PartNumberMarker === undefined
        ? { IsTruncated: true, Parts: [{ PartNumber: 1, ETag: '"a1"', Size: 8 }, { PartNumber: 2, ETag: '"a2"', Size: 8 }] }
        : { IsTruncated: false, Parts: [{ PartNumber: 3, ETag: '"a3"', Size: 3 }] },
    );
    const parts = await svc.listAllParts('k', 'u');
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(send.mock.calls[1][0].input).toMatchObject({ PartNumberMarker: '2' });
  });

  it('throws instead of returning a SHORT part list when pagination stops advancing', async () => {
    const svc = s3Service();
    // Always "truncated" and the marker never moves past 2 → must not loop or
    // silently return 2 parts (callers would treat parts 3..N as missing forever).
    mockSend(svc, () => ({
      IsTruncated: true,
      NextPartNumberMarker: '2',
      Parts: [{ PartNumber: 1, ETag: '"a1"', Size: 8 }, { PartNumber: 2, ETag: '"a2"', Size: 8 }],
    }));
    await expect(svc.listAllParts('k', 'u')).rejects.toThrow(/did not advance/);
  });

  it('completes with parts sorted by number and ETags exactly as given', async () => {
    const svc = s3Service();
    const send = mockSend(svc, () => ({}));
    await svc.completeMultipartUpload('k', 'u', [
      { partNumber: 3, etag: '"c"' },
      { partNumber: 1, etag: '"a"' },
      { partNumber: 2, etag: '"b"' },
    ]);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'k',
      UploadId: 'u',
      MultipartUpload: {
        Parts: [
          { PartNumber: 1, ETag: '"a"' },
          { PartNumber: 2, ETag: '"b"' },
          { PartNumber: 3, ETag: '"c"' },
        ],
      },
    });
  });

  it('treats NoSuchUpload on abort as success and rethrows anything else', async () => {
    const svc = s3Service();
    const gone = Object.assign(new Error('gone'), { name: 'NoSuchUpload' });
    mockSend(svc, () => {
      throw gone;
    });
    await expect(svc.abortMultipartUpload('k', 'u')).resolves.toBeUndefined();

    const boom = Object.assign(new Error('boom'), { name: 'InternalError' });
    mockSend(svc, () => {
      throw boom;
    });
    await expect(svc.abortMultipartUpload('k', 'u')).rejects.toThrow('boom');
  });

  it('recognises NoSuchUpload by name or by S3 error code', () => {
    expect(isNoSuchUploadError(Object.assign(new Error('x'), { name: 'NoSuchUpload' }))).toBe(true);
    expect(isNoSuchUploadError({ Code: 'NoSuchUpload' })).toBe(true);
    expect(isNoSuchUploadError(new Error('other'))).toBe(false);
    expect(isNoSuchUploadError(undefined)).toBe(false);
  });

  it('lists in-progress uploads across pages', async () => {
    const svc = s3Service();
    const send = mockSend(svc, (cmd) =>
      cmd.input.KeyMarker === undefined
        ? {
            IsTruncated: true,
            NextKeyMarker: 'databank/b',
            NextUploadIdMarker: 'u2',
            Uploads: [{ Key: 'databank/a', UploadId: 'u1', Initiated: new Date('2026-09-01') }],
          }
        : { IsTruncated: false, Uploads: [{ Key: 'databank/c', UploadId: 'u3' }] },
    );
    const ups = await svc.listMultipartUploads('databank/');
    expect(ups.map((u) => u.uploadId)).toEqual(['u1', 'u3']);
    expect(send.mock.calls[0][0].input).toMatchObject({ Prefix: 'databank/' });
    expect(send.mock.calls[1][0].input).toMatchObject({ KeyMarker: 'databank/b', UploadIdMarker: 'u2' });
  });

  it('refuses multipart in non-S3 (dev) storage modes', async () => {
    delete process.env.STORAGE_ACCESS_KEY;
    delete process.env.STORAGE_SECRET_KEY;
    delete process.env.SUPABASE_STORAGE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const svc = new StorageService(); // local mode
    expect(svc.supportsDirectUpload).toBe(false);
    await expect(svc.createMultipartUpload('k', 'application/pdf')).rejects.toThrow(/S3\/R2 storage mode/);
  });
});
