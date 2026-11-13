import { z } from 'zod';

/** Stundenzettel (docs/fachkonzept/08). */
export const ZETTEL_STATUS_LABELS = { entwurf: 'Entwurf', eingereicht: 'Eingereicht', bestaetigt: 'Bestätigt', gekuerzt: 'Gekürzt', abgelehnt: 'Abgelehnt' } as const;
export type ZettelStatus = keyof typeof ZETTEL_STATUS_LABELS;
export const BEZUG_LABELS = { hauptauftrag: 'Hauptauftrag', nachtrag: 'Nachtrag', regie: 'Regie' } as const;
export type Bezug = keyof typeof BEZUG_LABELS;
export const stundenzettelNo = (n: number | null | undefined) => (n ? `SZ-${String(n).padStart(3, '0')}` : 'Entwurf');

/** Hours from "07:00"–"15:30" minus break, rounded to quarter hours. Null if the times are incomplete or invalid. */
export function computeHours(von?: string | null, bis?: string | null, pauseMin = 0): number | null {
  const toMin = (t?: string | null) => {
    const m = t?.match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = toMin(von);
  const b = toMin(bis);
  if (a == null || b == null || b <= a) return null;
  const mins = b - a - pauseMin;
  return mins <= 0 ? 0 : Math.round((mins / 60) * 4) / 4;
}

export const ZeileInput = z.object({
  id: z.string().uuid(),
  datum: z.string().date(),
  person: z.string().trim().min(1, 'Person fehlt').max(120),
  von: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
  bis: z.string().regex(/^\d{1,2}:\d{2}$/).nullish(),
  pause_min: z.number().int().min(0).max(600).default(0),
  stunden: z.number().min(0).max(24),
  taetigkeit: z.string().trim().min(1, 'Tätigkeit fehlt').max(500),
  location_id: z.string().uuid().nullish(),
  bezug: z.enum(['hauptauftrag', 'nachtrag', 'regie']).default('hauptauftrag'),
});
export const ZettelInput = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  company_id: z.string().uuid(),
  period_from: z.string().date(),
  period_to: z.string().date(),
  note: z.string().max(2000).nullish(),
  zeilen: z.array(ZeileInput).max(500),
});

/** NU-Einreichungen (docs/fachkonzept/11). */
export const EINREICHUNG_STATUS_LABELS = {
  eingereicht: 'Eingereicht',
  in_pruefung: 'In Prüfung',
  freigegeben: 'Freigegeben',
  gf_erforderlich: 'Freigabe GF erforderlich',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
} as const;
export type EinreichungStatus = keyof typeof EINREICHUNG_STATUS_LABELS;
export const RECHNUNG_ART_LABELS = { abschlag: 'Abschlagsrechnung', teil: 'Teilrechnung', schluss: 'Schlussrechnung', regie: 'Regierechnung' } as const;
/** Freigabegrenze (B3): Nachträge bis einschließlich 50.000,00 € netto gibt die Leitung frei, darüber die Geschäftsführung. */
export const FREIGABEGRENZE_NETTO = 50_000;
export const needsGeschaeftsfuehrung = (kind: 'nachtrag' | 'rechnung', amountNet: number, grenze = FREIGABEGRENZE_NETTO) => kind === 'nachtrag' && amountNet > grenze;
export const einreichungNo = (kind: 'nachtrag' | 'rechnung', n: number) => `${kind === 'nachtrag' ? 'NT' : 'RE'}-${String(n).padStart(3, '0')}`;
