import { describe, expect, it } from 'vitest';
import { etikettenRaster, EtikettenFormat, raumAusCode, raumLink, STANDARD_ETIKETTEN } from './etiketten';

describe('Raum-Etiketten', () => {
  it('Standard: 16 pro A4-Seite, Zellen innerhalb der Seite', () => {
    const r = etikettenRaster(STANDARD_ETIKETTEN);
    expect(r.proSeite).toBe(16);
    expect(r.passt).toBe(true);
    const last = r.zellen.at(-1)!;
    expect(last.x + r.breite).toBeLessThanOrEqual(210);
    expect(last.y + r.hoehe).toBeLessThanOrEqual(297);
  });
  it('anpassbar: 3 × 10, QR wird verkleinert, wenn die Zelle zu klein ist', () => {
    const r = etikettenRaster(EtikettenFormat.parse({ spalten: 3, zeilen: 10, qr_mm: 60 }));
    expect(r.proSeite).toBe(30);
    expect(r.qr).toBeLessThan(r.hoehe);
  });
  it('QR-Link hin und zurück; fremde Codes werden ignoriert', () => {
    const id = '0f0e0d0c-1111-4222-8333-444455556666';
    expect(raumAusCode(raumLink('https://app.example.de/', id))).toBe(id);
    expect(raumAusCode('https://example.com/irgendwas')).toBeNull();
  });
});
