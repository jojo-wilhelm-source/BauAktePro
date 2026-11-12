import { describe, expect, it } from 'vitest';
import { allowedTransitions, canTransition, escalation, type TransitionTarget } from './mangel';

const nuA = { role: 'nu' as const, userId: 'u-nu-a', companyId: 'c-a' };
const nuB = { role: 'nu' as const, userId: 'u-nu-b', companyId: 'c-b' };
const bl = { role: 'bauleitung' as const, userId: 'u-bl', companyId: null };
const polier = { role: 'polier' as const, userId: 'u-polier', companyId: null };

const base: TransitionTarget = { status: 'behoben_gemeldet', createdBy: 'u-polier', creatorRole: 'polier', assignedCompanyId: 'c-a' };

describe('Mangel-Statuswechsel', () => {
  it('nur Bauleitung bestätigt die Zuweisung (B1)', () => {
    const m = { ...base, status: 'neu' as const };
    expect(canTransition(bl, m, 'zugewiesen')).toBe(true);
    expect(canTransition(polier, m, 'zugewiesen')).toBe(false);
    expect(canTransition({ role: 'bauherr', userId: 'u-bh', companyId: 'c-bh' }, m, 'zugewiesen')).toBe(false);
  });
  it('nur der zugewiesene NU meldet behoben', () => {
    const m = { ...base, status: 'in_bearbeitung' as const };
    expect(canTransition(nuA, m, 'behoben_gemeldet')).toBe(true);
    expect(canTransition(nuB, m, 'behoben_gemeldet')).toBe(false);
  });
  it('Ersteller (Polier) und Bauleitung dürfen abnehmen', () => {
    expect(canTransition(polier, base, 'abgenommen')).toBe(true);
    expect(canTransition(bl, base, 'abgenommen')).toBe(true);
  });
  it('ein NU nimmt nie ab – auch nicht als Ersteller (B2)', () => {
    const m = { ...base, createdBy: 'u-nu-a', creatorRole: 'nu' as const };
    expect(canTransition(nuA, m, 'abgenommen')).toBe(false);
    expect(allowedTransitions(nuA, m)).toEqual([]);
  });
});

describe('Eskalation in der Mängeltabelle', () => {
  const today = new Date('2026-11-10T12:00:00Z');
  it('schlägt nach Fristablauf eine 2. Nachfrist vor', () => {
    const e = escalation({ status: 'zugewiesen', due_date: '2026-11-05', nachfrist_date: null, priority: 'normal' }, today);
    expect(e.stage).toBe('ueberfaellig');
    expect(e.nachfristSuggestion).toBe('2026-11-17');
  });
  it('kein neuer Vorschlag, wenn die Nachfrist schon gesetzt ist', () => {
    const e = escalation({ status: 'zugewiesen', due_date: '2026-11-01', nachfrist_date: '2026-11-08', priority: 'normal' }, today);
    expect(e.nachfristSuggestion).toBeNull();
    expect(e.label).toContain('2. Nachfrist');
  });
  it('ab 7 Tagen Stufe Bauleitung, keine Geschäftsführung mehr', () => {
    expect(escalation({ status: 'zugewiesen', due_date: '2026-11-01', nachfrist_date: null, priority: 'normal' }, today).stage).toBe('an_bauleitung');
    expect(escalation({ status: 'zugewiesen', due_date: '2026-10-20', nachfrist_date: null, priority: 'normal' }, today).stage).toBe('an_bauleitung');
  });
});
