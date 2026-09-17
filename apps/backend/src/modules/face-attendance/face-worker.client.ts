import { Injectable, Logger } from '@nestjs/common';

export interface EmbeddedFace {
  embedding: number[]; // 512-d ArcFace, unit-normalized
  detScore: number; // detector confidence
  bbox: number[]; // [x1,y1,x2,y2]
}

/**
 * Thin HTTP client for the Python face-worker (apps/face-worker). POSTs raw
 * image bytes and gets back ArcFace 512-d embeddings. Mirrors the
 * DocumentParserClient / AttendanceClient pattern (native fetch + AbortController
 * timeout, bearer auth). Matching is NOT done here — embeddings go to pgvector on
 * the backend. Throws on transport / non-2xx so callers can record the failure.
 */
@Injectable()
export class FaceWorkerClient {
  private readonly log = new Logger(FaceWorkerClient.name);
  private readonly baseUrl = (process.env.AI_WORKER_URL ?? '').replace(/\/+$/, '');
  private readonly apiKey = process.env.AI_WORKER_API_KEY ?? '';
  private readonly timeoutMs = parseInt(process.env.AI_WORKER_TIMEOUT_MS ?? '30000', 10);

  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  /** Embed only the largest face (the person at the camera). null if no face. */
  async embedLargest(image: Buffer): Promise<EmbeddedFace | null> {
    const faces = await this.embed(image, true);
    return faces[0] ?? null;
  }

  async embed(image: Buffer, largestOnly = true): Promise<EmbeddedFace[]> {
    if (!this.configured) {
      throw new Error('Face worker not configured (AI_WORKER_URL)');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/embed?largest_only=${largestOnly}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: new Uint8Array(image),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`face worker responded ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        faces?: Array<{ embedding: number[]; det_score: number; bbox: number[] }>;
      };
      return (data.faces ?? []).map((f) => ({
        embedding: f.embedding,
        detScore: f.det_score,
        bbox: f.bbox,
      }));
    } finally {
      clearTimeout(timer);
    }
  }
}
