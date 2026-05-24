import { normalisePhone } from '../../common/phone/phone.util';
import type { MetaLeadFieldDatum } from './meta-graph.service';

export interface MappedLeadFields {
  firstName: string;
  lastName: string;
  email: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  targetCountry: string | null;
  serviceInterest: string | null;
  nationality: string | null;
  notes: string | null;
}

function pick(map: Map<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = map.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Map Meta `field_data` (the form answers) onto our Lead columns. Meta field
 * names are lowercased/underscored; standard fields are well-known, custom
 * questions get slugified names — anything unmapped is still preserved in
 * `formAnswers` JSON by the caller, so nothing is lost.
 */
export function mapMetaFields(fieldData: MetaLeadFieldDatum[] | undefined): MappedLeadFields {
  const map = new Map<string, string>();
  for (const f of fieldData ?? []) {
    if (!f?.name) continue;
    map.set(f.name.toLowerCase().trim(), (f.values ?? [])[0] ?? '');
  }

  const fullName = pick(map, ['full_name', 'name', 'your_name']);
  let firstName = pick(map, ['first_name', 'firstname']) ?? '';
  let lastName = pick(map, ['last_name', 'lastname']) ?? '';
  if (!firstName && fullName) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] ?? '';
    if (!lastName) lastName = parts.slice(1).join(' ');
  }
  if (!firstName) firstName = 'Meta';

  const email = pick(map, ['email', 'email_address', 'e-mail']);
  const phoneRaw = pick(map, [
    'phone_number', 'phone', 'mobile', 'mobile_number', 'whatsapp_number', 'contact_number',
  ]);
  const norm = phoneRaw ? normalisePhone(phoneRaw, 'PK') : null;

  const targetCountry = pick(map, [
    'country', 'target_country', 'destination', 'destination_country', 'which_country', 'preferred_country',
  ]);
  const serviceInterest = pick(map, [
    'service', 'interested_service', 'service_interest', 'visa_category', 'visa_type', 'program', 'which_service',
  ]);
  const nationality = pick(map, ['nationality', 'citizenship']);
  const city = pick(map, ['city', 'town']);
  const message = pick(map, ['message', 'notes', 'comments', 'your_message', 'how_can_we_help', 'details']);

  const notesParts = [message, city ? `City: ${city}` : null].filter(Boolean) as string[];
  if (!lastName) lastName = norm?.e164 ? norm.e164.slice(-4) : '';

  return {
    firstName,
    lastName: lastName || '—',
    email,
    phoneRaw,
    phoneE164: norm?.ok ? norm.e164 ?? null : null,
    targetCountry,
    serviceInterest,
    nationality: nationality ?? norm?.country ?? null,
    notes: notesParts.length ? notesParts.join(' · ') : null,
  };
}
