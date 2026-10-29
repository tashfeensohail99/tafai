import { DEFAULT_MASKING_CONFIG, DemoMasker, maskerFromEnv } from './masking';

const SALT = 'unit-test-salt-0123456789abcdef';
const mk = (salt = SALT) => new DemoMasker({ ...DEFAULT_MASKING_CONFIG, salt });

describe('DemoMasker — determinism', () => {
  it('same salt → same identities across instances; different salt → different', () => {
    const a = mk();
    const b = mk();
    const c = mk('another-salt-fedcba9876543210');
    expect(a.person('phone:923001234567')).toEqual(b.person('phone:923001234567'));
    expect(a.phone('+923001234567')).toEqual(b.phone('+923001234567'));
    expect(a.email('someone@gmail.com')).toEqual(b.email('someone@gmail.com'));
    expect(a.phone('+923001234567')).not.toEqual(c.phone('+923001234567'));
  });

  it('refuses a weak salt', () => {
    expect(() => new DemoMasker({ ...DEFAULT_MASKING_CONFIG, salt: 'short' })).toThrow();
    expect(() => maskerFromEnv({})).toThrow(/DEMO_MASK_SALT/);
  });
});

describe('DemoMasker — phones', () => {
  const m = mk();

  it('all storage styles of one number map to one fake number', () => {
    const styles = ['+923001234567', '923001234567', '03001234567', '3001234567', '+92 300 1234567', '0300-1234567', '00923001234567'];
    const ids = new Set(styles.map((s) => m.waId(s)));
    expect(ids.size).toBe(1);
    const fake = [...ids][0]!;
    expect(fake).toMatch(/^923\d{9}$/); // same country, still a PK mobile, same length
    expect(fake).not.toBe('923001234567');
  });

  it('keeps the input style', () => {
    expect(m.phone('+923001234567')).toMatch(/^\+923\d{9}$/);
    expect(m.phone('03001234567')).toMatch(/^03\d{9}$/);
    expect(m.phone('923001234567')).toMatch(/^923\d{9}$/);
    expect(m.phone('3001234567')).toMatch(/^3\d{9}$/);
    expect(m.phone('+92 300 1234567')).toMatch(/^\+92 3\d{2} \d{7}$/);
    expect(m.phone('0300-1234567')).toMatch(/^03\d{2}-\d{7}$/);
    expect(m.phone('00923001234567')).toMatch(/^00923\d{9}$/);
    expect(m.phone('+447700900123')).toMatch(/^\+447\d{9}$/);
    expect(m.phone('+14155552671')).toMatch(/^\+1\d{10}$/);
  });

  it('is a bijection on the national tail (no collisions across thousands of numbers)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const real = `+92300${String(1000000 + i * 7919).slice(-7)}`;
      const fake = m.waId(real)!;
      expect(seen.has(fake)).toBe(false);
      seen.add(fake);
    }
    expect(seen.size).toBe(5000);
  });

  it('never returns the real number', () => {
    for (let i = 0; i < 500; i++) {
      const real = `+92333${String(1000000 + i * 104729).slice(-7)}`;
      expect(m.phone(real)).not.toBe(real);
    }
  });

  it('leaves non-dialable placeholders alone and hashes digit-heavy junk', () => {
    expect(m.phone('meta-abc')).toBe('meta-abc');
    expect(m.phone('MANUAL-TIS-2026-00001')).toBe('MANUAL-TIS-2026-00001');
    expect(m.phone(null)).toBeNull();
    expect(m.phone('12345')).toBe('12345'); // too short to be a phone
    expect(m.phone('0000000000000000000')).toMatch(/^masked-/); // 19 digits, unparsable
  });
});

describe('DemoMasker — identities', () => {
  const m = mk();

  it('emails land on the demo domain, are deterministic and distinct, and are stable when re-masked', () => {
    const a = m.email('Ali.Khan@Gmail.com')!;
    const b = m.email('ali.khan@gmail.com')!;
    const c = m.email('other@yahoo.com')!;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.endsWith('@summit-demo.example')).toBe(true);
    expect(a).not.toMatch(/gmail/);
    expect(m.email(a)).toBe(a);
    expect(m.email('not an email')).toBe('not an email');
  });

  it('people get plausible gendered names and a stable person key', () => {
    const f = m.person('x', { gender: 'FEMALE' });
    const n = m.person('x', { gender: 'MALE' });
    expect(f.firstName).not.toBe('');
    expect(n.firstName).not.toBe('');
    expect(m.personKey({ phone: '03001234567', id: 'a' })).toBe(m.personKey({ phone: '+92 300 1234567', id: 'b' }));
    expect(m.personKey({ phone: 'meta-1', email: 'A@B.co', id: 'a' })).toBe('email:a@b.co');
    expect(m.personKey({ phone: null, email: null, id: 'zzz' })).toBe('id:zzz');
  });

  it('staff keep-list and explicit aliases are honoured', () => {
    const s = new DemoMasker({
      ...DEFAULT_MASKING_CONFIG,
      salt: SALT,
      staff: { keep: ['owner@example.com'], aliases: { 'rep@example.com': { firstName: 'Dana', lastName: 'Rep', email: 'dana@demo.example' } } },
    });
    expect(s.staff('owner@example.com', 'id1')).toBeNull();
    expect(s.staffEmail('owner@example.com', 'id1')).toBe('owner@example.com');
    expect(s.staff('rep@example.com', 'id2')).toEqual({ firstName: 'Dana', lastName: 'Rep' });
    expect(s.staffEmail('rep@example.com', 'id2')).toBe('dana@demo.example');
    const other = s.staff('someone@example.com', 'id3');
    expect(other).not.toBeNull();
    expect(s.staffEmail('someone@example.com', 'id3')).toMatch(/@summit-demo\.example$/);
  });

  it('ids, dates, addresses, secrets, file names', () => {
    expect(m.cnic('35202-1234567-1')).toMatch(/^\d{5}-\d{7}-\d$/);
    expect(m.cnic('35202-1234567-1')).not.toBe('35202-1234567-1');
    expect(m.nationalId('35202-1234567-1')).toMatch(/^\d{5}-\d{7}-\d$/);
    expect(m.passport('AB1234567')).toMatch(/^P\d{7}$/);
    const dob = m.dateOfBirth(new Date('1990-06-15T00:00:00Z'), 'k')!;
    const diffDays = Math.abs(dob.getTime() - Date.UTC(1990, 5, 15)) / 86_400_000;
    expect(diffDays).toBeLessThanOrEqual(400);
    expect(m.address('k')).toMatch(/^House \d+, .+, .+$/);
    expect(m.companyName('k')).toMatch(/\w+ \w+/);
    expect(m.secret('token', 'abc')).toMatch(/^demo-token-[0-9a-f]{24}$/);
    expect(m.fileName('passport_ali_khan.PDF')).toMatch(/^document-[0-9a-f]{6}\.pdf$/);
    expect(m.fileName('noext')).toMatch(/^document-[0-9a-f]{6}$/);
  });
});

describe('DemoMasker — text scrubbing', () => {
  const m = mk();
  const names = [{ real: { firstName: 'Muhammad Ali', lastName: 'Qadri' }, fake: { firstName: 'Hamza', lastName: 'Baig' } }];

  it('removes phones, emails, CNICs, names and brand tokens', () => {
    const text =
      'Hi Muhammad Ali Qadri, this is Tashfeen Immigration Solutions. Call +92 300 1234567 or 0300-7654321, ' +
      'email ali.qadri@gmail.com, CNIC 35202-1234567-1. Regards, QADRI team at tashfeengroup.com. wamid.HBgMOTIzMDAxMjM0NTY3FQIAERgS';
    const out = m.scrubText(text, { names })!;
    expect(out).not.toMatch(/Qadri|QADRI|Muhammad|1234567|7654321|gmail|35202|Tashfeen|tashfeengroup|HBgMOTIz/);
    expect(out).toMatch(/Hamza Baig/);
    expect(out).toMatch(/Summit Immigration Consultants/);
    expect(out).toMatch(/HAMZA|BAIG/); // case-matched token replacement
    expect(out).toMatch(/\+92 3\d{2} \d{7}/); // phone layout preserved
    expect(out).toMatch(/@summit-demo\.example/);
    expect(out).toMatch(/wamid\.demo[0-9a-f]{24}/);
  });

  it('replaces any real full name from the global index, even with no per-row alias', () => {
    const index = new Map([
      ['fazal khan', { firstName: 'Hamza', lastName: 'Baig' }],
      ['muhammad ali qadri', { firstName: 'Usman', lastName: 'Raza' }],
      ['ali qadri', { firstName: 'Usman', lastName: 'Raza' }],
    ]);
    const out = m.scrubText('New lead assigned: Fazal Khan (Canada PR). Also MUHAMMAD ALI QADRI replied; self employed.', { nameIndex: index })!;
    expect(out).toBe('New lead assigned: Hamza Baig (Canada PR). Also USMAN RAZA replied; self employed.');
    expect(m.scrubText('Fazalkhan is not a match, nor is Fazal Khanum', { nameIndex: index })).toBe('Fazalkhan is not a match, nor is Fazal Khanum');
  });

  it('is idempotent for names, emails and brand (phones are a bijection, so only their digits move)', () => {
    const once = m.scrubText('Ali Qadri ali@x.com Tashfeen Immigration Solutions, Tashfeen', { names })!;
    const twice = m.scrubText(once, { names })!;
    expect(twice).toBe(once);
    const p1 = m.scrubText('+923001234567')!;
    const p2 = m.scrubText(p1)!;
    expect(p2).toMatch(/^\+923\d{9}$/);
    expect(p2).not.toBe('+923001234567');
  });

  it('never lets the tenant name survive in any form', () => {
    const out = m.scrubText('See www.tashfeenimmigrationsolutions.com or TashfeenImmigration, @tashfeen_official, Tashfeen Barristers & Solicitors')!;
    expect(out.toLowerCase()).not.toContain('tashfeen');
    expect(out).toContain('summit-demo.example');
    expect(out).toContain('Summit Immigration Barristers & Solicitors');
  });

  it('does not touch reference codes, uuids, years or short numbers', () => {
    const s = 'Ref TIS-2026-00123, id 4b497ef0-32f8-4c1b-9a2e-123456789abc, year 2026, qty 12345, amount 250000';
    expect(m.scrubText(s)).toBe(s);
  });

  it('masks a phone inside a message consistently with the lead phone', () => {
    const lead = m.waId('+923001234567');
    const inText = m.scrubText('my number is 03001234567')!;
    expect(inText).toContain(`0${lead!.slice(2)}`);
  });

  it('deep-scrubs JSON and strips media from Meta payloads', () => {
    const payload = {
      from: '923001234567',
      contacts: [{ profile: { name: 'Ali Qadri' }, wa_id: '923001234567' }],
      text: { body: 'Hello from Ali Qadri, +923001234567' },
      image: { id: '1234567890123456', mime_type: 'image/jpeg', sha256: 'abc', caption: 'my passport' },
      document: { id: '999', mime_type: 'application/pdf', filename: 'ali_passport.pdf' },
      location: { latitude: 31.5, longitude: 74.3, name: 'Home' },
    };
    const out = m.scrubMessagePayload(payload, { names, fakeProfileName: 'Hamza' }) as typeof payload & Record<string, unknown>;
    expect(out.from).toBe(m.waId('923001234567'));
    expect(out.contacts[0].wa_id).toBe(m.waId('923001234567'));
    expect(out.contacts[0].profile.name).toBe('Hamza');
    expect(out.text.body).not.toMatch(/Qadri|1234567/);
    expect((out.image as Record<string, unknown>).id).toBeUndefined();
    expect((out.image as Record<string, unknown>).demoPlaceholder).toBe(true);
    expect((out.image as Record<string, unknown>).caption).toBe('my passport');
    expect((out.document as Record<string, unknown>).filename).toMatch(/^document-[0-9a-f]{6}\.pdf$/);
    expect((out.location as Record<string, unknown>).latitude).toBeUndefined();
    expect(JSON.stringify(out)).not.toMatch(/1234567890123456|31\.5|74\.3/);
    const ad = m.scrubAdReferral({ source_type: 'ad', headline: 'Study in Canada', ctwa_clid: 'abc123', image_url: 'https://cdn/x.jpg', thumbnail_url: 'https://cdn/t.jpg' }) as Record<string, unknown>;
    expect(ad.headline).toBe('Study in Canada');
    expect(ad.ctwa_clid).not.toBe('abc123');
    expect(ad.image_url).toBeUndefined();
    expect(ad.thumbnail_url).toBeUndefined();
  });
});
