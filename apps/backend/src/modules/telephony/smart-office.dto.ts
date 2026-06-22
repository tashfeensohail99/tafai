import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Phone-ish charset: digits, +, spaces, hyphens, parentheses. Rejects junk/binary early. */
const PHONE_CHARS = /^[0-9+()\s-]+$/;

/**
 * Request body Telenor Smart Office POSTs on every inbound call.
 * Per the agreed scope only `a_party_number` + `b_party_number` are sent;
 * `call_id` is optional (echoed back when present). Unknown extra fields are
 * stripped by the route's ValidationPipe rather than rejected.
 */
export class ResolveCallDto {
  /** Caller MSISDN (A-party). Local or international format; we normalise it. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(PHONE_CHARS, { message: 'a_party_number must be a phone number' })
  a_party_number!: string;

  /** Master number the customer dialled (B-party). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(PHONE_CHARS, { message: 'b_party_number must be a phone number' })
  b_party_number?: string;

  /** Smart Office call reference, echoed back in the response. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  call_id?: string;
}

/** Response contract expected by Smart Office. `null`, never text, for no-match. */
export interface SmartOfficeResolveResponse {
  matched: boolean;
  agent_extension: string | null;
  agent_name?: string;
  call_id: string | null;
}
