import { BadRequestException } from '@nestjs/common';
import { assertConvertibleEmail } from './leads-conversion.util';

describe('assertConvertibleEmail (conversion email-verify gate)', () => {
  it('is a no-op for the trusted paths (requireEmailVerified falsey)', () => {
    expect(() => assertConvertibleEmail({ email: null, emailVerified: false })).not.toThrow();
    expect(() =>
      assertConvertibleEmail({ email: 'a@b.c', emailVerified: false }, { requireEmailVerified: false }),
    ).not.toThrow();
  });

  it('blocks an unverified email on the user-facing path', () => {
    expect(() =>
      assertConvertibleEmail({ email: 'a@b.c', emailVerified: false }, { requireEmailVerified: true }),
    ).toThrow(BadRequestException);
  });

  it('blocks a lead with no email on the user-facing path', () => {
    expect(() =>
      assertConvertibleEmail({ email: null, emailVerified: false }, { requireEmailVerified: true }),
    ).toThrow(BadRequestException);
  });

  it('allows a verified email on the user-facing path', () => {
    expect(() =>
      assertConvertibleEmail({ email: 'a@b.c', emailVerified: true }, { requireEmailVerified: true }),
    ).not.toThrow();
  });
});
