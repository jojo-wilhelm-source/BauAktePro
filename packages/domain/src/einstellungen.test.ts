import { describe, expect, it } from 'vitest';
import { EINSTELLUNGEN_STANDARD, eskalationsRegeln, mitStandard } from './einstellungen';
import { escalation } from './mangel';

describe('Einstellungen', () => {
  it('fehlende Werte kommen aus den Standardwerten, ungültige brechen nichts', () => {
    expect(mitStandard({ freigabe: { nachtrag_grenze_netto: 20000 } }).freigabe.nachtrag_grenze_netto).toBe(20000);
    expect(mitStandard({ freigabe: { nachtrag_grenze_netto: 20000 } }).maengel.frist_tage.normal).toBe(14);
    expect(mitStandard({ maengel: { frist_tage: { normal: -5 } } })).toEqual(EINSTELLUNGEN_STANDARD);
  });
  it('Eskalation nutzt die eingestellten Tage', () => {
    const m = { status: 'zugewiesen' as const, due_date: '2026-11-01', nachfrist_date: null, priority: 'normal' as const };
    const heute = new Date('2026-11-05T10:00:00Z');
    expect(escalation(m, heute).stage).toBe('ueberfaellig');
    expect(escalation(m, heute, eskalationsRegeln(mitStandard({ maengel: { eskalation_tage: 3 } }))).stage).toBe('an_bauleitung');
  });
});
