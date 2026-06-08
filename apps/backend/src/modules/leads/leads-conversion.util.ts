import { BadRequestException } from '@nestjs/common';

/**
 * Conversion rule: a user-facing "Convert to Client" must not create a client
 * from an unverified lead. The trusted, post-agreement/payment paths (finance
 * auto-convert, processing import) pass `requireEmailVerified: false` (the
 * default) because by then the customer is already established and paying.
 *
 * Pure + throwing so it's unit-testable without a DB.
 */
export function assertConvertibleEmail(
  lead: { email: string | null; emailVerified: boolean },
  opts?: { requireEmailVerified?: boolean },
): void {
  if (!opts?.requireEmailVerified) return;
  if (!lead.email || !lead.emailVerified) {
    throw new BadRequestException(
      "This lead's email must be verified before converting to a client. Send a verification link first, " +
        'or convert via the finance flow once an agreement is signed / payment is confirmed.',
    );
  }
}
