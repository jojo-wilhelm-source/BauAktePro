import { describe, expect, it } from 'vitest';
import { carriesOver, nextPlanIndex, nextPunktStatus, PUNKT_STATUS, punktNo, punktUeberfaellig } from './index';

describe('NU-Besprechung', () => {
  it('Status-Tipp: In Arbeit → Erledigt → Wichtig → Blockiert → Nicht fällig → In Arbeit', () => {
    expect(nextPunktStatus('in_arbeit')).toBe('erledigt');
    expect(nextPunktStatus('erledigt')).toBe('wichtig');
    expect(nextPunktStatus('nicht_faellig')).toBe('in_arbeit');
  });
  it('Folgesitzung: alle aktiven Punkte wandern mit, nur Erledigt nicht', () => {
    expect(PUNKT_STATUS.filter((s) => carriesOver(s))).toEqual(['blockiert', 'wichtig', 'in_arbeit', 'nicht_faellig']);
  });
  it('überfällig nur mit Frist in der Vergangenheit und nicht erledigt', () => {
    expect(punktUeberfaellig({ status: 'in_arbeit', due_date: '2026-11-01' }, '2026-11-12')).toBe(true);
    expect(punktUeberfaellig({ status: 'erledigt', due_date: '2026-11-01' }, '2026-11-12')).toBe(false);
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
