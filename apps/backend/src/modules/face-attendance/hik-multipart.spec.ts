/**
 * The Hikvision push parser is hand-rolled byte handling against a vendor format
 * that varies by firmware, and it sits at the very front of the attendance
 * pipeline — if it mis-parses, every downstream stage silently gets nothing.
 * These tests pin the behaviours that are easy to break and expensive to notice.
 */
import {
  extractFaceEvent,
  isCaptureEvent,
  isFaceEvent,
  parseAlert,
  parseMultipart,
} from './hik-multipart';

/** Build a multipart body the way the NVR does: raw bytes, CRLF separated. */
function multipart(
  boundary: string,
  parts: { headers: string[]; data: Buffer }[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n${p.headers.join('\r\n')}\r\n\r\n`));
    chunks.push(p.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

/**
 * A stand-in JPEG that deliberately contains CRLF bytes. Real JPEG payloads
 * contain arbitrary bytes including 0x0D 0x0A, and a naive line-based parser
 * truncates on them — this makes that failure visible.
 */
function fakeJpeg(size: number, seed = 7): Buffer {
  const b = Buffer.alloc(size);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  for (let i = 3; i < size - 2; i++) b[i] = (i * seed) % 256;
  // Force a CRLF inside the payload.
  if (size > 40) {
    b[20] = 0x0d;
    b[21] = 0x0a;
  }
  b[size - 2] = 0xff;
  b[size - 1] = 0xd9;
  return b;
}

const XML_ALERT = `<?xml version="1.0" encoding="UTF-8"?>
<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <ipAddress>192.168.1.64</ipAddress>
  <macAddress>ac:cb:51:11:22:33</macAddress>
  <channelID>2</channelID>
  <dateTime>2026-07-19T09:15:30+05:00</dateTime>
  <eventType>faceCapture</eventType>
  <eventState>active</eventState>
  <uuid>c0ffee00-1111-2222-3333-444455556666</uuid>
</EventNotificationAlert>`;

describe('parseMultipart', () => {
  it('keeps binary image data byte-exact, including embedded CRLF', () => {
    const jpeg = fakeJpeg(600);
    const body = multipart('bnd123', [
      { headers: ['Content-Disposition: form-data; name="Event_Type"', 'Content-Type: application/xml'], data: Buffer.from(XML_ALERT) },
      { headers: ['Content-Disposition: form-data; name="Picture"', 'Content-Type: image/jpeg'], data: jpeg },
    ]);

    const parts = parseMultipart(body, 'multipart/form-data; boundary=bnd123');
    const img = parts.find((p) => p.contentType === 'image/jpeg');

    expect(img).toBeDefined();
    // Byte-exact: a single byte of drift corrupts the JPEG and the face never embeds.
    expect(img!.data.length).toBe(jpeg.length);
    expect(img!.data.equals(jpeg)).toBe(true);
  });

  it('handles a quoted boundary', () => {
    const body = multipart('a-b-c', [
      { headers: ['Content-Disposition: form-data; name="Event_Type"', 'Content-Type: application/xml'], data: Buffer.from(XML_ALERT) },
    ]);
    const parts = parseMultipart(body, 'multipart/form-data; boundary="a-b-c"');
    expect(parts).toHaveLength(1);
  });

  it('parses a picture part that has NO filename (the Hikvision quirk)', () => {
    const jpeg = fakeJpeg(300);
    const body = multipart('bnd', [
      // No filename= at all — this is why the parser does not use a multipart library.
      { headers: ['Content-Disposition: form-data; name="Picture"', 'Content-Type: image/jpeg'], data: jpeg },
    ]);
    const parts = parseMultipart(body, 'multipart/form-data; boundary=bnd');
    expect(parts).toHaveLength(1);
    expect(parts[0].filename).toBeUndefined();
    expect(parts[0].contentType).toBe('image/jpeg');
    expect(parts[0].data.equals(jpeg)).toBe(true);
  });

  it('returns nothing when the content-type carries no boundary', () => {
    expect(parseMultipart(Buffer.from('x'), 'multipart/form-data')).toEqual([]);
  });
});

describe('parseAlert', () => {
  it('reads the XML form', () => {
    const a = parseAlert(XML_ALERT);
    expect(a.eventType).toBe('faceCapture');
    expect(a.eventUuid).toBe('c0ffee00-1111-2222-3333-444455556666');
    expect(a.channelId).toBe('2');
    expect(a.deviceId).toBe('ac:cb:51:11:22:33');
    expect(a.capturedAt?.toISOString()).toBe('2026-07-19T04:15:30.000Z');
  });

  it('reads the JSON form, wrapped or bare', () => {
    const wrapped = parseAlert(JSON.stringify({
      EventNotificationAlert: {
        eventType: 'faceSnap', uuid: 'u-1', channelID: 3,
        macAddress: 'aa:bb', dateTime: '2026-07-19T10:00:00+05:00',
      },
    }));
    expect(wrapped.eventType).toBe('faceSnap');
    // channelID arrives as a NUMBER in JSON but must come back as a string,
    // because the channel map and allowlist are keyed by string.
    expect(wrapped.channelId).toBe('3');

    const bare = parseAlert(JSON.stringify({ eventType: 'faceCapture', dynChannelID: 5 }));
    expect(bare.eventType).toBe('faceCapture');
    expect(bare.channelId).toBe('5'); // dynChannelID fallback
  });

  it('degrades quietly on malformed input rather than throwing', () => {
    expect(parseAlert('{ not json')).toEqual({});
    expect(parseAlert('<EventNotificationAlert></EventNotificationAlert>').eventType).toBeUndefined();
    // An unparseable date must be dropped, not turned into Invalid Date.
    expect(parseAlert('<dateTime>not-a-date</dateTime>').capturedAt).toBeUndefined();
  });
});

describe('extractFaceEvent', () => {
  it('picks the LARGEST image when the NVR sends crop + full scene', () => {
    const crop = fakeJpeg(200, 3);
    const scene = fakeJpeg(1500, 11);
    const body = multipart('bnd', [
      { headers: ['Content-Disposition: form-data; name="Event_Type"', 'Content-Type: application/xml'], data: Buffer.from(XML_ALERT) },
      { headers: ['Content-Disposition: form-data; name="Picture"', 'Content-Type: image/jpeg'], data: crop },
      { headers: ['Content-Disposition: form-data; name="Picture2"', 'Content-Type: image/jpeg'], data: scene },
    ]);

    const ev = extractFaceEvent(body, 'multipart/form-data; boundary=bnd');
    // The full scene detects more reliably than a tight crop.
    expect(ev.image?.length).toBe(scene.length);
    expect(ev.eventType).toBe('faceCapture');
    expect(ev.channelId).toBe('2');
  });

  it('treats a part as an image by FILENAME when content-type is missing', () => {
    const jpeg = fakeJpeg(400);
    const body = multipart('bnd', [
      { headers: ['Content-Disposition: form-data; name="Picture"; filename="snap.jpg"'], data: jpeg },
    ]);
    const ev = extractFaceEvent(body, 'multipart/form-data; boundary=bnd');
    expect(ev.image?.equals(jpeg)).toBe(true);
  });

  it('handles a bare XML body with no picture', () => {
    const ev = extractFaceEvent(Buffer.from(XML_ALERT), 'application/xml');
    expect(ev.eventType).toBe('faceCapture');
    expect(ev.channelId).toBe('2');
    expect(ev.image).toBeUndefined();
  });
});

describe('isFaceEvent', () => {
  it('accepts the face event names Hikvision uses', () => {
    for (const t of ['faceCapture', 'faceSnap', 'faceDetection', 'FaceCapture']) {
      expect(isFaceEvent(t)).toBe(true);
    }
  });

  it('rejects everything else, so motion and heartbeats never punch', () => {
    for (const t of ['VMD', 'videoloss', 'IO', 'linedetection', undefined, '']) {
      expect(isFaceEvent(t)).toBe(false);
    }
  });
});

describe('isCaptureEvent', () => {
  // The deployed cameras (DS-2CD1343G2-LIU) have no Smart Event section at all
  // and only ever emit VMD. A face-only filter dropped every usable frame while
  // still answering 200 OK, so this widening is what makes those cameras work.
  const DEFAULTS = ['face', 'vmd', 'motion', 'linedetection', 'fielddetection'];

  it('accepts motion events from value-tier cameras', () => {
    for (const t of ['VMD', 'vmd', 'motionDetection', 'linedetection']) {
      expect(isCaptureEvent(t, DEFAULTS)).toBe(true);
    }
  });

  it('still accepts real face events', () => {
    for (const t of ['faceCapture', 'faceSnap', 'FaceDetection']) {
      expect(isCaptureEvent(t, DEFAULTS)).toBe(true);
    }
  });

  it('rejects noise that carries no useful frame', () => {
    for (const t of ['videoloss', 'IO', 'heartbeat', undefined, '']) {
      expect(isCaptureEvent(t, DEFAULTS)).toBe(false);
    }
  });

  it('can be tightened to face-only where the hardware supports it', () => {
    expect(isCaptureEvent('VMD', ['face'])).toBe(false);
    expect(isCaptureEvent('faceCapture', ['face'])).toBe(true);
  });

  it('rejects everything when the allowlist is empty, rather than passing all', () => {
    // Guards a misconfigured FACE_CAPTURE_EVENT_TYPES='' from turning the
    // filter into a firehose that embeds every frame the NVR ever sends.
    expect(isCaptureEvent('faceCapture', [])).toBe(false);
    expect(isCaptureEvent('VMD', [''])).toBe(false);
  });
});
