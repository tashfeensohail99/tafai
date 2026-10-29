/**
 * Shared "is this a personal name?" filter used by BOTH the masker's global
 * name index and the leak checker, so the two always agree on what counts as
 * a name. Production lead rows contain junk such as firstName="Self"
 * lastName="Employed" or "Visit"/"Visa"; treating those as names would make
 * the masker rewrite ordinary prose and the checker flag it.
 */
export const NAME_STOPWORDS: ReadonlySet<string> = new Set((
  // function words
  'the and for you your yours our ours can could would should will shall with this that these those what when where which who ' +
  'whom why how are was were been being have has had does did doing not but yet nor also any all some more most many much such ' +
  'very just from into onto over under about after before again against between through during without within because until ' +
  'while here there then than too only own same other another each every both few new old good bad best better first last next ' +
  'one two three four five six seven eight nine ten hello dear sir madam mister miss mrs thanks thank please okay yes none null ' +
  'unknown test demo sample customer client lead contact user admin agent name full first second ' +
  // immigration / business vocabulary seen in lead rows
  'visa visit visitor visiting immigration immigrant migrate migration canada canadian australia australian america american ' +
  'usa uk united kingdom states europe germany italy portugal malta poland romania turkey dubai uae qatar saudi oman kuwait ' +
  'bahrain pakistan pakistani lahore karachi islamabad rawalpindi faisalabad multan peshawar sialkot gujranwala quetta london ' +
  'study student students work worker working permit permits job jobs family spouse wife husband child children parent parents ' +
  'business investor investment skilled express entry pnp lmia ielts pte toefl bank statement statements passport cnic ' +
  'consultation consult appointment office call calls phone number email whatsapp message fee fees price cost pay payment ' +
  'process processing case file documents document apply application applied applicant form forms eligibility eligible ' +
  'law firm lawyer legal company group solutions services service consultant consultants free info information details detail ' +
  'interested interest want need help support time today tomorrow week month year morning evening night day days send sent ' +
  'get got give take make made like know wants needs ask asked tell told self employed employee employer unemployed retired ' +
  'high commission embassy consulate recent recently policy policies healthcare health care medical doctor nurse engineer ' +
  'teacher driver real estate property advance advanced advocate manager director officer executive senior junior assistant ' +
  'marketing sales finance accounts account hr it web tech software developer designer online offline mobile home house ' +
  'resident residence residency permanent temporary citizen citizenship tourist tourism travel trip ticket flight hotel ' +
  'university college school degree diploma bachelor master phd course courses education training scholarship ' +
  'january february march april may june july august september october november december monday tuesday wednesday ' +
  'thursday friday saturday sunday'
).split(/\s+/).filter(Boolean));

/**
 * Honorifics / name particles that precede a personal name in South-Asian
 * usage. They are not names themselves: keys are emitted with AND without
 * them, and a span made of particles + pool tokens is never a leak.
 */
export const NAME_PARTICLES: ReadonlySet<string> = new Set(
  'muhammad mohammad mohammed mohd md abdul abdur hafiz syed sayed mian sardar haji hajji sahib sab bhai baba chaudhry ch rana malik mirza khawaja sheikh shaikh dr mr mrs ms miss'.split(' '),
);

export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z؀-ۿ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isNameToken(t: string): boolean {
  return t.length >= 3 && /^[a-z؀-ۿ]+$/.test(t) && !NAME_STOPWORDS.has(t);
}

/**
 * Normalised full-name keys for a real person, or [] when the pair does not
 * look like a personal name. "Muhammad Ali Qadri" yields both
 * "muhammad ali qadri" and "ali qadri".
 */
export function personalNameKeys(firstName: string | null | undefined, lastName: string | null | undefined): string[] {
  const f = normName(String(firstName ?? ''));
  const l = normName(String(lastName ?? ''));
  if (!f || !l || f.length + l.length < 6) return [];
  const parts = f.split(' ');
  if (!parts.every(isNameToken) || !isNameToken(l)) return [];
  if (parts.length === 1 && parts[0] === l) return [];
  const keys = new Set<string>([`${f} ${l}`]);
  if (parts.length > 1) keys.add(`${parts[parts.length - 1]} ${l}`);
  // Without leading particles: "abdul hanan jutt" → also "hanan jutt".
  const core = [...parts];
  while (core.length > 1 && NAME_PARTICLES.has(core[0])) core.shift();
  if (core.length && !(core.length === 1 && NAME_PARTICLES.has(core[0]))) keys.add(`${core.join(' ')} ${l}`);
  return [...keys];
}
