/**
 * Leistungsverzeichnis and Preisspiegel (docs/fachkonzept/12). Positions can be pasted from Excel
 * (columns OZ, Kurztext, Menge, Einheit – tab or semicolon separated); GAEB import comes later (offene-punkte).
 */
import { z } from 'zod';

/** Lines of an LV in the usual AVA structure: Titel › Untertitel › Position, plus Hinweistexte. */
export const LV_ARTEN = ['titel', 'untertitel', 'position', 'text'] as const;
export type LvArt = (typeof LV_ARTEN)[number];
export const LvPositionInput = z.object({
  id: z.string().uuid(),
  art: z.enum(LV_ARTEN).default('position'),
  oz: z.string().trim().max(30).default(''),
  kurztext: z.string().trim().min(1).max(500),
  langtext: z.string().max(10000).nullish(),
  menge: z.coerce.number().min(0).max(1e9).default(0),
  einheit: z.string().trim().max(20).nullish(),
}).refine((p) => p.art !== 'position' || !!p.einheit?.trim(), { message: 'Positionen brauchen eine Einheit', path: ['einheit'] });
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
    positionen.push({ art: 'position', oz: c[0]!, kurztext: c[1]!, menge, einheit: c[3]!, langtext: c[4] || null });
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

/**
 * OZ numbering as in AVA programs: Titel 01, 02 …; Untertitel 01.01; Positionen 01.01.0010, 01.01.0020 (step 10);
 * without Untertitel 01.0010. Hinweistexte get no OZ.
 */
export function ozNummerieren<T extends { art: LvArt }>(zeilen: T[]): (T & { oz: string })[] {
  let t = 0, u = 0, p = 0;
  const two = (n: number) => String(n).padStart(2, '0');
  return zeilen.map((z) => {
    if (z.art === 'titel') { t++; u = 0; p = 0; return { ...z, oz: two(t) }; }
    if (z.art === 'untertitel') { if (!t) t = 1; u++; p = 0; return { ...z, oz: `${two(t)}.${two(u)}` }; }
    if (z.art === 'text') return { ...z, oz: '' };
    p++;
    const pos = String(p * 10).padStart(4, '0');
    return { ...z, oz: t ? (u ? `${two(t)}.${two(u)}.${pos}` : `${two(t)}.${pos}`) : pos };
  });
}

/** Sum per Titel and Untertitel for each bidder (from the GP of the Preisspiegel rows). */
export function titelSummen(zeilen: { id: string; art: LvArt }[], gp: Map<string, (number | null)[]>, bieter: number) {
  const out = new Map<string, number[]>();
  let titel: string | null = null;
  let unter: string | null = null;
  for (const z of zeilen) {
    if (z.art === 'titel') { titel = z.id; unter = null; out.set(z.id, Array(bieter).fill(0)); continue; }
    if (z.art === 'untertitel') { unter = z.id; out.set(z.id, Array(bieter).fill(0)); continue; }
    if (z.art !== 'position') continue;
    const row = gp.get(z.id) ?? [];
    for (const k of [titel, unter]) if (k) out.set(k, out.get(k)!.map((v, i) => Math.round((v + (row[i] ?? 0)) * 100) / 100));
  }
  return out;
}
