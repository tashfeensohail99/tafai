import { classifyAdProgram } from './ad-program';

describe('classifyAdProgram (against real Tashfeen ad names)', () => {
  const cases: Array<[string | null, ReturnType<typeof classifyAdProgram>]> = [
    ['Faizan2 c11 whatsapp message', 'C11'],
    ['Faizan1 C-11 WhatsApp Advantage+sales campaign AI On', 'C11'],
    ['Faizan3 Lahore whatsapp C11', 'C11'],
    ['Faizan4 c11 whatsapp Eshaa', 'C11'],
    ['Faizan2 JR whatsapp message', 'JR'],
    ['Faizan3 JR whatsapp Esha Lahore & ISB', 'JR'],
    ['Faizan2 Visit visa Canada Whatsapp', 'VISIT_VISA'],
    ['Faizan Visit visa Whatsapp', 'VISIT_VISA'],
    ['Faizan C10 Whatsapp', 'C10'],
    ['Test - RCIP WhatsApp campaign', 'RCIP'],
    // No program token → OTHER (never silently mis-bucketed).
    ['Faizan1 14 August Discount Ad', 'OTHER'],
    ['Faizan Lahore Ad  to WhatsApp- C', 'OTHER'],
    ['Post: "After facing three rejections, Alhamdulillah, the..."', 'OTHER'],
    ['Finland (WhatsApp) – Copy', 'OTHER'],
    ['Promoting Website: ', 'OTHER'],
    [null, 'OTHER'],
  ];

  it.each(cases)('classifies %p → %s', (name, expected) => {
    expect(classifyAdProgram(name)).toBe(expected);
  });

  it('falls back to the campaign name when the ad name is blank', () => {
    expect(classifyAdProgram(null, 'Faizan JR WhatsApp campaign')).toBe('JR');
    expect(classifyAdProgram('', 'Faizan C11 WhatsApp campaign1')).toBe('C11');
  });

  it('does not mistake substrings for program tokens', () => {
    expect(classifyAdProgram('Junior consultant outreach')).toBe('OTHER'); // "jr" not a standalone token
    expect(classifyAdProgram('abc112 promo')).toBe('OTHER'); // "c11" not a standalone token
  });
});
