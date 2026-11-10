import { describe, expect, it } from 'vitest';
import { carriesOver, nextPlanIndex, nextPunktStatus, punktNo } from './index';

describe('NU-Besprechung', () => {
  it('Status-Chip: Offen → In Arbeit → Erledigt → Offen, Info bleibt', () => {
    expect(nextPunktStatus('offen')).toBe('in_arbeit');
    expect(nextPunktStatus('in_arbeit')).toBe('erledigt');
    expect(nextPunktStatus('erledigt')).toBe('offen');
    expect(nextPunktStatus('info')).toBe('info');
  });
  it('Folgesitzung: nur Offen und In Arbeit wandern mit', () => {
    expect(['offen', 'in_arbeit', 'erledigt', 'info'].filter((s) => carriesOver(s as never))).toEqual(['offen', 'in_arbeit']);
  });
  it('Punktnummer', () => expect(punktNo(14)).toBe('P-014'));
});

describe('Planindex', () => {
  it('A → B, Z → AA, AZ → BA', () => {
    expect(nextPlanIndex('A')).toBe('B');
    expect(nextPlanIndex('Z')).toBe('AA');
    expect(nextPlanIndex('AZ')).toBe('BA');
    expect(nextPlanIndex('c')).toBe('D');
  });
});
