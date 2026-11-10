import { describe, expect, it } from 'vitest';
import { ordnerBaum, sortMaengel, type MangelKey } from './mangel-liste';

const m = (number: number, company: string | null, created_at: string, extra: Partial<MangelKey> = {}): MangelKey => ({
  number, company, created_at, due: null, location: 'Bad', gewerk: 'Fliesen', status: 'zugewiesen', ...extra,
});
const list = [
  m(1, 'Fliesen Fuchs', '2026-10-20T08:00:00Z'),
  m(2, 'Elektro Blitz', '2026-11-03T08:00:00Z'),
  m(3, null, '2026-11-09T08:00:00Z'),
  m(4, 'Elektro Blitz', '2026-10-01T08:00:00Z', { location: 'Küche' }),
];
const id = (x: MangelKey) => x;

describe('sortMaengel', () => {
  it('nach Firma (ohne Firma zuletzt, innerhalb nach Nummer)', () => {
    expect(sortMaengel(list, 'firma', id).map((x) => x.number)).toEqual([2, 4, 1, 3]);
  });
  it('nach Datum neueste und älteste zuerst', () => {
    expect(sortMaengel(list, 'datum_neu', id).map((x) => x.number)).toEqual([3, 2, 1, 4]);
    expect(sortMaengel(list, 'datum_alt', id).map((x) => x.number)).toEqual([4, 1, 2, 3]);
  });
});

describe('ordnerBaum', () => {
  it('Firma › Monat als Unterordner, neuester Monat zuerst', () => {
    const tree = ordnerBaum(sortMaengel(list, 'nummer', id), ['firma', 'monat'], id);
    expect(tree.map((f) => [f.label, f.count])).toEqual([['Elektro Blitz', 2], ['Fliesen Fuchs', 1], ['Ohne Firma', 1]]);
    expect(tree[0]!.children.map((f) => f.label)).toEqual(['November 2026', 'Oktober 2026']);
    expect(tree[0]!.children[1]!.items.map((x) => x.number)).toEqual([4]);
    expect(tree[0]!.items).toEqual([]);
  });
});
