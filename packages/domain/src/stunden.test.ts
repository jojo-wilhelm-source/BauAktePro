import { describe, expect, it } from 'vitest';
import { computeHours, needsGeschaeftsfuehrung } from './index';

describe('Stundenzettel', () => {
  it('berechnet Stunden abzüglich Pause, auf Viertelstunden', () => {
    expect(computeHours('07:00', '15:30', 30)).toBe(8);
    expect(computeHours('07:10', '12:00', 0)).toBe(4.75);
    expect(computeHours('15:00', '07:00', 0)).toBeNull();
    expect(computeHours('07:00', null)).toBeNull();
  });
});

describe('Freigabegrenze', () => {
  it('Nachtrag bis einschließlich 50.000 € netto: Leitung, darüber GF; Rechnungen nicht betroffen', () => {
    expect(needsGeschaeftsfuehrung('nachtrag', 50_000)).toBe(false);
    expect(needsGeschaeftsfuehrung('nachtrag', 50_000.01)).toBe(true);
    expect(needsGeschaeftsfuehrung('rechnung', 90_000)).toBe(false);
  });
});
