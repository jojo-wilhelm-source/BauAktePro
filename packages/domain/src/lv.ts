/**
 * Leistungsverzeichnis and Preisspiegel (docs/fachkonzept/12). Positions can be pasted from Excel
 * (columns OZ, Kurztext, Menge, Einheit – tab or semicolon separated); GAEB import comes later (offene-punkte).
 */
import { z } from 'zod';

export const LvPositionInput = z.object({
  id: z.string().uuid(),
  oz: z.string().trim().min(1).max(30),
  kurztext: z.string().trim().min(1).max(500),
  langtext: z.string().max(10000).nullish(),
  menge: z.coerce.number().min(0).max(1e9),
  einheit: z.string().trim().min(1).max(20),
});
export type LvPosition = z.infer<typeof LvPositionInput>;

const deNum = (s: string) => Number(s.trim().replace(/\./g, '').replace(',', '.'));

/** Pasted rows → positions (without ids). Lines that cannot be read are reported, not dropped silently. */
export function parsePositionen(text: string): { positionen: Omit<LvPosition, 'id'>[]; fehler: string[] } {
  const positionen: Omit<LvPosition, 'id'>[] = [];
  const fehler: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const c = line.split(line.includes('\t') ? '\t' : ';').map((x) => x.trim());
    if (c.length < 4) return void fehler.push(`Zeile ${i + 1}: 4 Spalten erwartet (OZ, Kurztext, Menge, Einheit)`);
    const menge = deNum(c[2]!);
    if (i === 0 && /oz|pos/i.test(c[0]!) && !Number.isFinite(menge)) return; // header row
    if (!Number.isFinite(menge)) return void fehler.push(`Zeile ${i + 1}: Menge „${c[2]}“ ist keine Zahl`);
    positionen.push({ oz: c[0]!, kurztext: c[1]!, menge, einheit: c[3]!, langtext: c[4] || null });
  });
  return { positionen, fehler };
}

export interface PreisspiegelAngebot {
  id: string;
  company: string;
  nachlass_prozent: number;
  /** Unit prices per position id; missing = not offered. */
  preise: Record<string, number>;
  /** Offer only as PDF: total entered by the bidder. */
  summe_pdf?: number | null;
}

/** Price comparison: total per position and bidder, cheapest per position, sums after discount, ranking. */
export function preisspiegel(positionen: { id: string; menge: number }[], angebote: PreisspiegelAngebot[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const zeilen = positionen.map((p) => {
    const gp = angebote.map((a) => (a.preise[p.id] != null ? r2(a.preise[p.id]! * p.menge) : null));
    const vorhanden = gp.filter((x): x is number => x != null);
    const min = vorhanden.length ? Math.min(...vorhanden) : null;
    return { position_id: p.id, gp, guenstigster: min == null ? [] : angebote.filter((_, i) => gp[i] === min).map((a) => a.id) };
  });
  const summen = angebote.map((a, i) => {
    const fehlend = zeilen.filter((z) => z.gp[i] == null).length;
    const brutto = a.summe_pdf != null && Object.keys(a.preise).length === 0 ? a.summe_pdf : zeilen.reduce((s, z) => s + (z.gp[i] ?? 0), 0);
    const netto = r2(brutto * (1 - (a.nachlass_prozent || 0) / 100));
    return { angebot_id: a.id, company: a.company, summe: r2(brutto), nachlass_prozent: a.nachlass_prozent, summe_nach_nachlass: netto, fehlende_positionen: a.summe_pdf != null && Object.keys(a.preise).length === 0 ? 0 : fehlend };
  });
  const rang = [...summen].sort((x, y) => x.summe_nach_nachlass - y.summe_nach_nachlass).map((s) => s.angebot_id);
  return { zeilen, summen, rang, guenstigstes: rang[0] ?? null };
}
