import { describe, expect, it } from 'vitest';
import { isPlausibleSignature, Signature, TagesberichtInput, wochentag } from './bautagebuch';

describe('Unterschrift', () => {
  it('ein Punkt ist keine Unterschrift, ein Schriftzug schon', () => {
    const dot = Signature.parse({ w: 300, h: 100, strokes: [[[0.5, 0.5], [0.501, 0.5]]] });
    expect(isPlausibleSignature(dot)).toBe(false);
    const name = Signature.parse({ w: 300, h: 100, strokes: [[[0.1, 0.5], [0.3, 0.2], [0.5, 0.7], [0.8, 0.4]]] });
    expect(isPlausibleSignature(name)).toBe(true);
  });
});
describe('Tagesbericht', () => {
  it('Wochentag und Standardwerte', () => {
    expect(wochentag('2026-11-12')).toBe('Donnerstag');
    const t = TagesberichtInput.parse({ id: crypto.randomUUID(), project_id: crypto.randomUUID(), datum: '2026-11-12' });
    expect(t.personal).toEqual([]);
  });
});
