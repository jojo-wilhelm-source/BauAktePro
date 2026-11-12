import { describe, expect, it } from 'vitest';
import { kmWarnung, kostenPrognose, nettoAusBrutto, verbrauch } from './index';

describe('Einkauf', () => {
  it('Netto aus Brutto', () => {
    expect(nettoAusBrutto(119, 19)).toBe(100);
    expect(nettoAusBrutto(84.9, 19)).toBe(71.34);
    expect(nettoAusBrutto(10, 0)).toBe(10);
  });
});

describe('Fahrtenbuch', () => {
  it('Verbrauch zwischen zwei Tankvorgängen', () => {
    expect(verbrauch({ km_stand: 47740 }, { km_stand: 48262, liter: 61.2 })).toBe(11.7);
    expect(verbrauch(undefined, { km_stand: 100, liter: 40 })).toBeNull();
  });
  it('warnt bei Lücke oder Rücksprung, sperrt nicht', () => {
    expect(kmWarnung(48262, 48262)).toBeNull();
    expect(kmWarnung(48262, 48300)).toContain('Lücke von 38 km');
    expect(kmWarnung(48262, 48200)).toContain('unter dem letzten Ende');
  });
});

describe('Kosten', () => {
  it('Prognose, Abweichung, Ampel', () => {
    const r = kostenPrognose({ budget: 95000, auftrag: 86500, nachtraegeBeauftragt: 4850, nachtraegeOffen: 6000, abgerechnet: 30000, rechnungenOffen: 0, einkaeufe: 178.4 });
    expect(r.prognose).toBe(91528.4);
    expect(r.ampel).toBe('rot'); // with open Nachträge above budget
    expect(r.restAuftrag).toBe(61350);
    expect(kostenPrognose({ budget: null, auftrag: 1, nachtraegeBeauftragt: 0, nachtraegeOffen: 0, abgerechnet: 0, rechnungenOffen: 0, einkaeufe: 0 }).ampel).toBe('grau');
  });
});

import { besprechungIcs } from './besprechung';
describe('besprechungIcs', () => {
  it('erzeugt einen Kalendereintrag in UTC mit maskierten Sonderzeichen', () => {
    const ics = besprechungIcs({ uid: 'x', title: 'Baubesprechung, Haus A; Nr. 3', start: new Date('2026-11-19T08:00:00Z'), place: 'Container' });
    expect(ics).toContain('DTSTART:20261119T080000Z');
    expect(ics).toContain('DTEND:20261119T090000Z');
    expect(ics).toContain('SUMMARY:Baubesprechung\\, Haus A\\; Nr. 3');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});

import { tankenPflicht, verbrauchProStunde } from './kosten';
describe('Maschinen und mobile Tankstelle', () => {
  const base = { liter: 80, fahrzeug_id: 'a', quelle_id: null };
  it('Pflichtangaben je Art', () => {
    expect(tankenPflicht('fahrzeug', { ...base, km_stand: null, betriebsstunden: null })).toMatch(/km-Stand/);
    expect(tankenPflicht('maschine', { ...base, km_stand: null, betriebsstunden: null })).toMatch(/Betriebsstunden/);
    expect(tankenPflicht('maschine', { ...base, km_stand: null, betriebsstunden: 1234.5, quelle_id: 't' })).toBeNull();
    expect(tankenPflicht('tankstelle', { ...base, liter: 1000, km_stand: null, betriebsstunden: null })).toBeNull();
    expect(tankenPflicht('tankstelle', { ...base, km_stand: null, betriebsstunden: null, quelle_id: 'x' })).toMatch(/Tankstelle/);
  });
  it('Verbrauch l/h', () => {
    expect(verbrauchProStunde(1200, { betriebsstunden: 1210, liter: 95 })).toBe(9.5);
    expect(verbrauchProStunde(null, { betriebsstunden: 1210, liter: 95 })).toBeNull();
  });
});
