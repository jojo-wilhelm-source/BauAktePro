import { describe, expect, it } from 'vitest';
import { anzeigeNo, canBePosition, proposeDeadline, roomAt } from './index';

const areas = [
  { location_id: 'bad', plan_id: 'p', page: 1, x0: 0.07, y0: 0.14, x1: 0.36, y1: 0.5 },
  { location_id: 'wohnen', plan_id: 'p', page: 1, x0: 0.36, y0: 0.14, x1: 0.91, y1: 0.86 },
  { location_id: 'nische', plan_id: 'p', page: 1, x0: 0.5, y0: 0.2, x1: 0.6, y1: 0.3 },
];

describe('roomAt', () => {
  it('findet den Raum unter dem Pin', () => {
    expect(roomAt(areas, { plan_id: 'p', page: 1, x: 0.2, y: 0.3 })).toBe('bad');
    expect(roomAt(areas, { plan_id: 'p', page: 1, x: 0.7, y: 0.6 })).toBe('wohnen');
  });
  it('kleinste Fläche gewinnt bei Überlappung', () => {
    expect(roomAt(areas, { plan_id: 'p', page: 1, x: 0.55, y: 0.25 })).toBe('nische');
  });
  it('kein Vorschlag außerhalb, auf anderem Plan oder anderer Seite', () => {
    expect(roomAt(areas, { plan_id: 'p', page: 1, x: 0.01, y: 0.01 })).toBeNull();
    expect(roomAt(areas, { plan_id: 'q', page: 1, x: 0.2, y: 0.3 })).toBeNull();
    expect(roomAt(areas, { plan_id: 'p', page: 2, x: 0.2, y: 0.3 })).toBeNull();
  });
});

describe('Mangelanzeige', () => {
  it('Nummer', () => {
    expect(anzeigeNo(3)).toBe('MA-003');
    expect(anzeigeNo(null)).toBe('Entwurf');
  });
  it('nur bestätigt zugewiesene, offene Mängel des NU werden Positionen', () => {
    const m = { status: 'zugewiesen' as const, assigned_company_id: 'nu1', assignment_confirmed: true };
    expect(canBePosition(m, 'nu1')).toBe(true);
    expect(canBePosition(m, 'nu2')).toBe(false);
    expect(canBePosition({ ...m, assignment_confirmed: false }, 'nu1')).toBe(false);
    expect(canBePosition({ ...m, status: 'abgenommen' }, 'nu1')).toBe(false);
  });
  it('Fristvorschlag: mindestens 7 Tage', () => {
    const today = new Date('2026-11-10T09:00:00Z');
    expect(proposeDeadline(['2026-10-28'], today)).toBe('2026-11-17');
    expect(proposeDeadline(['2026-12-01', null], today)).toBe('2026-12-01');
    expect(proposeDeadline([], today)).toBe('2026-11-17');
  });
});
