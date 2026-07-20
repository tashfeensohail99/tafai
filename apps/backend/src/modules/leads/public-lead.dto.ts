import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Payload for the public website enquiry form.
 *
 * This is the ONLY unauthenticated write path into the leads table, so it is
 * deliberately narrow: a fixed set of short, validated fields and nothing that
 * lets a caller choose an assignee, a status, a branch or a source. Everything
 * that decides where the lead goes is set server-side.
 *
 * SPAM DEFENCES, and why they are in the DTO rather than a guard:
 *
 *  - `company` is a HONEYPOT. It is rendered hidden and off-screen, so a human
 *    never sees it and never fills it. Bots fill every input they find. The
 *    field must therefore be EMPTY; a non-empty value means a bot. It is named
 *    `company` rather than `honeypot` precisely so it looks worth filling.
 *
 *  - `elapsedMs` is a TIMING FLOOR — milliseconds between the form rendering
 *    and submission. A person cannot read six fields and type a real enquiry in
 *    under three seconds; scripted posts routinely arrive in under one.
 *
 * Both are cheap, need no third-party service, and cost a real user nothing.
 * Neither is sufficient alone, which is why the endpoint is also throttled.
 */
export class CreateWebsiteLeadDto {
  @IsString()
  @Length(1, 80)
  firstName!: string;

  @IsString()
  @Length(1, 80)
  lastName!: string;

  /**
   * Loose on purpose. This audience writes numbers as +92…, 0092…, 03xx… and
   * with spaces or dashes. Rejecting a real enquiry over formatting costs far
   * more than storing a number a rep has to tidy, so we only require that it
   * plausibly IS a phone number.
   */
  @IsString()
  @Matches(/^[+\d][\d\s()\-.]{6,24}$/, {
    message: 'phone must be a plausible phone number',
  })
  phone!: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(160)
  email?: string;

  /** Which destination they are asking about. Free text, but bounded. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  targetCountry?: string;

  /** Which route or service. Free text, but bounded. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  serviceInterest?: string;

  /** Their own description of their situation. */
  @IsOptional()
  @IsString()
  @MaxLength(1200)
  message?: string;

  /** HONEYPOT — must be absent or empty. See class docblock. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  /** Milliseconds the form was on screen before submission. See class docblock. */
  @IsOptional()
  @IsInt()
  @Min(0)
  elapsedMs?: number;

  /**
   * Which page the enquiry came from, so a rep can see what the person was
   * reading. Constrained to a known set — never reflected into a link, and
   * never used to build a URL.
   */
  @IsOptional()
  @IsIn([
    'home',
    'work-permit',
    'visit-visa',
    'refused',
    'express-entry',
    'pnp',
    'study',
    'family',
    'tools',
    'fees',
    'contact',
    'other',
  ])
  page?: string;
}
