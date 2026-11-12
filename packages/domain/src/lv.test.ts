import { describe, expect, it } from 'vitest';
import { ozNummerieren, parsePositionen, preisspiegel, titelSummen } from './lv';

describe('Leistungsverzeichnis', () => {
  it('Positionen aus Excel einfügen (Tab oder Semikolon, deutsche Zahlen), Kopfzeile wird übersprungen', () => {
    const r = parsePositionen('OZ\tKurztext\tMenge\tEinheit\n01.0010\tEstrich CT-C25 50 mm\t1.250,5\tm2\n01.0020;Randdämmstreifen;800;m\nkaputt');
    expect(r.positionen).toHaveLength(2);
    expect(r.positionen[0]).toMatchObject({ oz: '01.0010', menge: 1250.5, einheit: 'm2' });
    expect(r.fehler).toHaveLength(1);
  });
  it('Preisspiegel: GP je Position, günstigster je Position, Nachlass, Rangfolge, fehlende Positionen', () => {
    const pos = [{ id: 'p1', menge: 100 }, { id: 'p2', menge: 10 }];
    const s = preisspiegel(pos, [
      { id: 'A', company: 'A', nachlass_prozent: 0, preise: { p1: 20, p2: 50 } },   // 2000 + 500 = 2500
      { id: 'B', company: 'B', nachlass_prozent: 10, preise: { p1: 22, p2: 40 } },  // 2200 + 400 = 2600 → 2340
      { id: 'C', company: 'C', nachlass_prozent: 0, preise: { p1: 18 } },           // 1800, p2 missing
      { id: 'D', company: 'D', nachlass_prozent: 0, preise: {}, summe_pdf: 2450 },  // PDF only
    ]);
    expect(s.zeilen[0]!.guenstigster).toEqual(['C']);
    expect(s.zeilen[1]!.guenstigster).toEqual(['B']);
    expect(s.summen.find((x) => x.angebot_id === 'B')!.summe_nach_nachlass).toBe(2340);
    expect(s.summen.find((x) => x.angebot_id === 'C')!.fehlende_positionen).toBe(1);
    expect(s.rang).toEqual(['C', 'B', 'D', 'A']);
  });
});

describe('LV-Gliederung', () => {
  it('OZ automatisch: Titel, Untertitel, Positionen in 10er-Schritten, Hinweistext ohne OZ', () => {
    const oz = ozNummerieren([{ art: 'titel' }, { art: 'position' }, { art: 'untertitel' }, { art: 'position' }, { art: 'text' }, { art: 'position' }, { art: 'titel' }, { art: 'position' }] as const)
      .map((z) => z.oz);
    expect(oz).toEqual(['01', '01.0010', '01.01', '01.01.0010', '', '01.01.0020', '02', '02.0010']);
  });
  it('Titelsummen je Bieter', () => {
    const z = [{ id: 't', art: 'titel' as const }, { id: 'u', art: 'untertitel' as const }, { id: 'a', art: 'position' as const }, { id: 'b', art: 'position' as const }];
    const s = titelSummen(z, new Map([['a', [100, 90]], ['b', [50, null]]]), 2);
    expect(s.get('t')).toEqual([150, 90]);
    expect(s.get('u')).toEqual([150, 90]);
  });
});
