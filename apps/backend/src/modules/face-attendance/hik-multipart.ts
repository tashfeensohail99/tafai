/**
 * Parser for Hikvision NVR "alarm server" face-capture pushes.
 *
 * The NVR POSTs either:
 *  - multipart/form-data: an `EventNotificationAlert` part (XML or JSON) + one or
 *    more `image/*` parts (the face crop / full scene), OR
 *  - a bare text/xml | text/json body (event without a picture).
 *
 * We parse the multipart body OURSELVES from the raw Buffer and classify parts by
 * Content-Type (image/* = picture, xml|json = metadata) rather than relying on a
 * multipart library's file/field heuristic — Hikvision frequently omits the
 * `filename` on the binary picture part, which makes libraries mis-handle it.
 */

export interface HikPart {
  name?: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

export interface HikFaceEvent {
  eventType?: string;
  eventUuid?: string;
  channelId?: string;
  deviceId?: string;
  capturedAt?: Date;
  image?: Buffer;
}

const CRLFCRLF = Buffer.from('\r\n\r\n');

export function parseMultipart(body: Buffer, contentType: string): HikPart[] {
  const bm = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!bm) return [];
  const boundary = (bm[1] ?? bm[2]).trim();
  const delim = Buffer.from(`--${boundary}`);
  const parts: HikPart[] = [];

  let idx = body.indexOf(delim);
  if (idx < 0) return [];
  idx += delim.length;

  while (idx < body.length) {
    // Closing delimiter "--boundary--"
    if (body[idx] === 0x2d && body[idx + 1] === 0x2d) break;
    // Skip the CRLF after the boundary line
    if (body[idx] === 0x0d && body[idx + 1] === 0x0a) idx += 2;

    const headerEnd = body.indexOf(CRLFCRLF, idx);
    if (headerEnd < 0) break;
    const headerText = body.subarray(idx, headerEnd).toString('utf8');
    const bodyStart = headerEnd + CRLFCRLF.length;

    let next = body.indexOf(delim, bodyStart);
    if (next < 0) next = body.length;
    // The part body ends before the CRLF that precedes the next boundary.
    let bodyEnd = next;
    if (bodyEnd - 2 >= bodyStart && body[bodyEnd - 2] === 0x0d && body[bodyEnd - 1] === 0x0a) {
      bodyEnd -= 2;
    }

    const cd = /content-disposition:[^\r\n]*/i.exec(headerText)?.[0] ?? '';
    parts.push({
      data: body.subarray(bodyStart, bodyEnd),
      name: /name="?([^";]+)"?/i.exec(cd)?.[1]?.trim(),
      filename: /filename="?([^";]+)"?/i.exec(cd)?.[1]?.trim(),
      contentType: /content-type:\s*([^\r\n;]+)/i.exec(headerText)?.[1]?.trim(),
    });

    idx = next + delim.length;
  }
  return parts;
}

/** Extract the fields we need from an EventNotificationAlert (XML or JSON). */
export function parseAlert(text: string): Omit<HikFaceEvent, 'image'> {
  const t = text.trim();
  if (t.startsWith('{')) {
    try {
      const raw = JSON.parse(t) as Record<string, unknown>;
      const a = (raw.EventNotificationAlert ?? raw) as Record<string, unknown>;
      const s = (v: unknown): string | undefined =>
        v === undefined || v === null ? undefined : String(v);
      return {
        eventType: s(a.eventType),
        eventUuid: s(a.uuid),
        channelId: s(a.channelID ?? a.channelId ?? a.dynChannelID),
        deviceId: s(a.macAddress ?? a.deviceID ?? a.deviceId),
        capturedAt: parseDate(s(a.dateTime)),
      };
    } catch {
      return {};
    }
  }
  // XML — targeted tag extraction (namespace-agnostic).
  const tag = (name: string): string | undefined => {
    const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i').exec(text);
    return m ? m[1].trim() : undefined;
  };
  return {
    eventType: tag('eventType'),
    eventUuid: tag('uuid'),
    channelId: tag('channelID') ?? tag('dynChannelID'),
    deviceId: tag('macAddress') ?? tag('deviceID'),
    capturedAt: parseDate(tag('dateTime')),
  };
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Parse a full Hikvision push (raw Buffer + its Content-Type) into the face event
 * fields + the largest image part. Handles both the multipart and bare-body forms.
 */
export function extractFaceEvent(body: Buffer, contentType: string): HikFaceEvent {
  const ct = (contentType || '').toLowerCase();
  const out: HikFaceEvent = {};

  if (ct.includes('multipart/')) {
    let image: Buffer | undefined;
    let metaText: string | undefined;
    for (const p of parseMultipart(body, contentType)) {
      const pct = (p.contentType ?? '').toLowerCase();
      const isImg = pct.startsWith('image/') || /\.(jpe?g|png)$/i.test(p.filename ?? '');
      if (isImg) {
        // Prefer the largest image (full scene tends to beat a tight crop for detection).
        if (!image || p.data.length > image.length) image = p.data;
      } else if (pct.includes('xml') || pct.includes('json') || p.name === 'Event_Type') {
        metaText = p.data.toString('utf8');
      }
    }
    if (metaText) Object.assign(out, parseAlert(metaText));
    out.image = image;
  } else {
    // Bare text/xml or text/json body — no picture.
    Object.assign(out, parseAlert(body.toString('utf8')));
  }
  return out;
}

/** Is this a face-capture event we should act on (vs. motion, heartbeat, test)? */
export function isFaceEvent(eventType?: string): boolean {
  const t = (eventType ?? '').toLowerCase();
  return t.includes('face'); // faceCapture, faceSnap, faceDetection, ...
}
