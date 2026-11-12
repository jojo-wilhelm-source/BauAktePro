import { describe, expect, it } from 'vitest';
import { banfOffen, banfTransition, BanfInput } from './bestellung';

describe('Bestellanforderung', () => {
  it('Einkauf führt weiter, Anforderer zieht nur offene zurück', () => {
    expect(banfTransition('offen', 'bestellt', 'einkauf')).toBe(true);
    expect(banfTransition('bestellt', 'geliefert', 'einkauf')).toBe(true);
    expect(banfTransition('geliefert', 'offen', 'einkauf')).toBe(false);
    expect(banfTransition('offen', 'zurueckgezogen', 'anforderer')).toBe(true);
    expect(banfTransition('in_bearbeitung', 'zurueckgezogen', 'anforderer')).toBe(false);
    expect(banfTransition('offen', 'bestellt', 'anforderer')).toBe(false);
    expect(banfOffen('angefragt')).toBe(true);
    expect(banfOffen('bestellt')).toBe(false);
  });
  it('Eingabe braucht einen Titel', () => {
    expect(BanfInput.safeParse({ id: crypto.randomUUID(), project_id: crypto.randomUUID(), titel: 'x' }).success).toBe(false);
    expect(BanfInput.parse({ id: crypto.randomUUID(), project_id: crypto.randomUUID(), titel: 'Bauzaun', positionen: [{ text: 'Zaun', menge: '20', einheit: 'St' }] }).positionen[0]?.menge).toBe(20);
  });
});
