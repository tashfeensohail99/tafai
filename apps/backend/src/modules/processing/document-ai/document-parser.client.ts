import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { ParserRequest, ParserResponse } from './document-ai.contracts';

/**
 * Thin HMAC-authenticated HTTP client for the Python document parser.
 *
 * Signs the exact request body with HMAC-SHA256 (shared DOC_PARSER_HMAC_SECRET)
 * and sends it as X-Signature — the contract the parser's app/security.py
 * enforces. Returns the parsed assessment; throws on transport / non-2xx so
 * the caller can record an errorMessage and leave the doc for human review.
 */
@Injectable()
export class DocumentParserClient {
  private readonly log = new Logger(DocumentParserClient.name);
  private readonly baseUrl = (process.env.DOC_PARSER_URL ?? '').replace(/\/+$/, '');
  private readonly secret = process.env.DOC_PARSER_HMAC_SECRET ?? '';
  private readonly timeoutMs = parseInt(process.env.DOC_PARSER_TIMEOUT_MS ?? '60000', 10);

  get configured(): boolean {
    return Boolean(this.baseUrl && this.secret);
  }

  async validate(req: ParserRequest): Promise<ParserResponse> {
    if (!this.configured) {
      throw new Error('Document parser not configured (DOC_PARSER_URL / DOC_PARSER_HMAC_SECRET)');
    }
    const body = JSON.stringify(req);
    const signature = createHmac('sha256', this.secret).update(body, 'utf8').digest('hex');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/validate-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`parser responded ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as ParserResponse;
    } finally {
      clearTimeout(timer);
    }
  }
}
