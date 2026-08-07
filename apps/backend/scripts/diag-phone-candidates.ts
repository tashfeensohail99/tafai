/** Proof that +92 / 0-prefixed / bare forms of one number collapse to the same
 *  candidate set — so admin search finds the lead whichever way it was typed. */
import { phoneSearchCandidates, looksLikePhoneSearch } from '../src/common/phone/phone-search.util';

for (const term of ['+923488942524', '03488942524', '923488942524', '3488942524', '+92 348 8942524']) {
  console.log(
    `${term.padEnd(18)} looksLikePhone=${looksLikePhoneSearch(term)}  ` +
      `candidates=${JSON.stringify(phoneSearchCandidates(term))}`,
  );
}
