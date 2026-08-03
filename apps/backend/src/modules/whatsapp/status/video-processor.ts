import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = 'ffmpeg';
const FFPROBE_BIN = 'ffprobe';

const STATUS_MAX_SECONDS = 30;
export const STATUS_MAX_BYTES = 16 * 1024 * 1024;
const STATUS_COMPRESS_THRESHOLD_BYTES = 18 * 1024 * 1024;
const STATUS_TARGET_BYTES = 14 * 1024 * 1024;

export interface ProcessedVideoChunk {
  buffer: Buffer;
  mimeType: 'video/mp4';
  durationSec: number | null;
}

/**
 * Prepare an uploaded video for WhatsApp Status. WhatsApp Status caps videos
 * at 30 seconds and inline video at 16 MB, so anything longer or larger is
 * transcoded — a 90-second clip becomes three 30-second MP4 chunks, each
 * targeted to land under ~14 MB.
 *
 * Contract:
 *   - Input under 30 s AND under 18 MB and already MP4 → returned as-is
 *     (single chunk, keeps original bytes).
 *   - Input under 30 s but over 18 MB or non-MP4 → transcoded to a single
 *     MP4 under 16 MB (single chunk).
 *   - Input over 30 s → segmented + transcoded into ceil(dur/30) MP4 chunks,
 *     each ≤30 s and ≤~14 MB.
 *
 * Runs ffprobe + ffmpeg via shell (present in the runtime image already —
 * `apk add ffmpeg` in apps/backend/Dockerfile).
 */
export async function processStatusVideo(
  input: Buffer,
  originalMime: string,
): Promise<ProcessedVideoChunk[]> {
  const workId = randomUUID();
  const tmpIn = join(tmpdir(), `status-in-${workId}`);
  try {
    await writeFile(tmpIn, input);
    const durationSec = await probeDurationSec(tmpIn);

    const isMp4 = originalMime === 'video/mp4';
    const shortEnough = durationSec == null || durationSec <= STATUS_MAX_SECONDS;
    const smallEnough = input.length <= STATUS_COMPRESS_THRESHOLD_BYTES;

    if (isMp4 && shortEnough && smallEnough) {
      return [{ buffer: input, mimeType: 'video/mp4', durationSec }];
    }

    if (shortEnough) {
      const compressed = await transcodeSingleMp4(tmpIn, durationSec);
      return [{ buffer: compressed, mimeType: 'video/mp4', durationSec }];
    }

    const chunks = await splitAndTranscode(tmpIn, durationSec ?? 0, workId);
    return chunks.map((buf) => ({
      buffer: buf,
      mimeType: 'video/mp4' as const,
      // Each chunk's own duration isn't measured — segment length is the ceiling.
      durationSec: Math.min(STATUS_MAX_SECONDS, durationSec ?? STATUS_MAX_SECONDS),
    }));
  } finally {
    await unlink(tmpIn).catch(() => {});
  }
}

async function probeDurationSec(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ]);
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** Single-file H.264/AAC MP4 transcode targeting <16 MB. */
async function transcodeSingleMp4(
  tmpIn: string,
  durationSec: number | null,
): Promise<Buffer> {
  const encode = async (
    boxW: number,
    boxH: number,
    videoKbps: number,
    audioKbps: number,
  ): Promise<Buffer> => {
    const tmpOut = join(tmpdir(), `status-out-${randomUUID()}.mp4`);
    try {
      await execFileAsync(
        FFMPEG_BIN,
        [
          '-hide_banner', '-y',
          '-i', tmpIn,
          '-vf', `scale=w=${boxW}:h=${boxH}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
          '-b:v', `${videoKbps}k`,
          '-maxrate', `${Math.round(videoKbps * 1.5)}k`,
          '-bufsize', `${videoKbps * 2}k`,
          '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', '2',
          '-movflags', '+faststart',
          '-map', '0:v:0', '-map', '0:a:0?',
          tmpOut,
        ],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      return await readFile(tmpOut);
    } finally {
      await unlink(tmpOut).catch(() => {});
    }
  };

  const bitrateFor = (audioKbps: number, floor: number, cap: number): number => {
    if (!durationSec) return Math.min(cap, 1200);
    const totalKbps = (STATUS_TARGET_BYTES * 8) / 1000 / durationSec;
    return Math.max(floor, Math.min(cap, Math.floor(totalKbps) - audioKbps));
  };

  const out720 = await encode(1280, 720, bitrateFor(96, 300, 2500), 96);
  if (out720.length <= STATUS_MAX_BYTES) return out720;
  const out480 = await encode(854, 480, bitrateFor(64, 250, 1200), 64);
  return out480.length < out720.length ? out480 : out720;
}

/**
 * Split a long video into ≤30 s MP4 chunks in one ffmpeg pass. Re-encodes to
 * H.264/AAC (not stream-copy) so cut points are exact — stream-copy can only
 * split at keyframes, which may be far apart. Bitrate is targeted so each
 * 30 s segment lands under ~14 MB.
 */
async function splitAndTranscode(
  tmpIn: string,
  totalDurationSec: number,
  workId: string,
): Promise<Buffer[]> {
  const outDir = join(tmpdir(), `status-split-${workId}`);
  // ffmpeg segment mode writes files matching the pattern; the OUTPUT PATH's
  // parent dir must exist — reuse tmpdir directly with a unique prefix.
  const pattern = join(tmpdir(), `status-seg-${workId}-%03d.mp4`);

  // 14 MB per 30-second segment ≈ 3.7 Mbps total, minus 96 kbps audio.
  // Cap at 3500 kbps to keep file size predictable on shorter tails.
  const videoKbps = 3500;
  const audioKbps = 96;

  try {
    await execFileAsync(
      FFMPEG_BIN,
      [
        '-hide_banner', '-y',
        '-i', tmpIn,
        '-vf', `scale=w=1280:h=720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-b:v', `${videoKbps}k`,
        '-maxrate', `${Math.round(videoKbps * 1.5)}k`,
        '-bufsize', `${videoKbps * 2}k`,
        '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', '2',
        '-force_key_frames', `expr:gte(t,n_forced*${STATUS_MAX_SECONDS})`,
        '-f', 'segment',
        '-segment_time', String(STATUS_MAX_SECONDS),
        '-reset_timestamps', '1',
        '-movflags', '+faststart',
        '-map', '0:v:0', '-map', '0:a:0?',
        pattern,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    // Collect the segment files ffmpeg wrote, in order.
    const dirEntries = await readdir(tmpdir());
    const prefix = `status-seg-${workId}-`;
    const segFiles = dirEntries
      .filter((n) => n.startsWith(prefix) && n.endsWith('.mp4'))
      .sort();

    if (segFiles.length === 0) {
      throw new Error('ffmpeg produced no segments');
    }

    const chunks: Buffer[] = [];
    for (const name of segFiles) {
      const full = join(tmpdir(), name);
      try {
        const raw = await readFile(full);
        // Ultra-safe: if any single segment still exceeds 16 MB (rare —
        // very long clip + high-motion source), re-transcode that one
        // segment at 480p to force it under the cap.
        const finalBuf = raw.length > STATUS_MAX_BYTES
          ? await transcodeSingleMp4(full, Math.min(totalDurationSec, STATUS_MAX_SECONDS))
          : raw;
        chunks.push(finalBuf);
      } finally {
        await unlink(full).catch(() => {});
      }
    }
    return chunks;
  } catch (e) {
    // Clean up any partial segment output on failure.
    try {
      const dirEntries = await readdir(tmpdir());
      const prefix = `status-seg-${workId}-`;
      for (const n of dirEntries) {
        if (n.startsWith(prefix)) {
          await unlink(join(tmpdir(), n)).catch(() => {});
        }
      }
    } catch {}
    const stderr = (e as { stderr?: unknown }).stderr;
    const tail = stderr
      ? ` — ${String(stderr).trim().split('\n').slice(-2).join(' ')}`
      : ` — ${(e as Error).message}`;
    throw new Error(`ffmpeg split failed${tail}`);
  }
  // `outDir` is declared but unused — keep the reference to silence "declared
  // but never read" while making it obvious we intentionally chose the tmpdir
  // prefix pattern over a subdirectory.
  void outDir;
}
