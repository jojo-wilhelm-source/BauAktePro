import { z } from 'zod';

/** Baustellen-Einkäufe (docs/fachkonzept/14). */
export const ZAHLUNGSART_LABELS = { firmenkarte: 'Firmenkarte', bar: 'Bar (Kasse)', privat: 'Privat ausgelegt' } as const;
export type Zahlungsart = keyof typeof ZAHLUNGSART_LABELS;
export const EINKAUF_STATUS_LABELS = { eingereicht: 'Eingereicht', freigegeben: 'Freigegeben', abgelehnt: 'Abgelehnt' } as const;
export type EinkaufStatus = keyof typeof EINKAUF_STATUS_LABELS;

/** Net from gross, rounded to cents. */
export const nettoAusBrutto = (brutto: number, mwst: number) => Math.round((brutto / (1 + mwst / 100)) * 100) / 100;

export const EinkaufInput = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  gekauft_von: z.string().trim().min(1).max(120),
  datum: z.string().date(),
  haendler: z.string().trim().min(1, 'Händler fehlt').max(200),
  betrag_brutto: z.coerce.number().min(0).max(1_000_000),
  mwst_satz: z.coerce.number().refine((v) => v === 0 || v === 7 || v === 19, 'MwSt 0, 7 oder 19 %').default(19),
  gewerk_id: z.string().uuid().nullish(),
  zweck: z.string().trim().min(1, 'Zweck fehlt').max(500),
  zahlungsart: z.enum(['firmenkarte', 'bar', 'privat']).default('firmenkarte'),
});

/** Fahrtenbuch (docs/fachkonzept/14): simple, not a tax logbook. */
export const FahrtInput = z.object({
  id: z.string().uuid(),
  fahrzeug_id: z.string().uuid(),
  datum: z.string().date(),
  km_start: z.coerce.number().int().min(0),
  km_ende: z.coerce.number().int().min(0),
  project_id: z.string().uuid().nullish(),
  zweck: z.string().trim().min(1, 'Zweck fehlt').max(300),
}).refine((f) => f.km_ende >= f.km_start, { message: 'km-Stand Ende liegt vor dem Start', path: ['km_ende'] });
export const TankenInput = z.object({
  id: z.string().uuid(),
  fahrzeug_id: z.string().uuid(),
  datum: z.string().date(),
  liter: z.coerce.number().positive().max(500),
  betrag_brutto: z.coerce.number().min(0).max(5000),
  km_stand: z.coerce.number().int().min(0),
  tankstelle: z.string().max(200).nullish(),
  project_id: z.string().uuid().nullish(),
});

/** Consumption between two fill-ups (l/100 km): litres of the later one over the distance. Null if not computable. */
export function verbrauch(prev: { km_stand: number } | undefined, cur: { km_stand: number; liter: number }): number | null {
  if (!prev || cur.km_stand <= prev.km_stand) return null;
  return Math.round((cur.liter / (cur.km_stand - prev.km_stand)) * 1000) / 10;
}

/** Gaps/rollbacks in the odometer: warning, never a block. */
export function kmWarnung(lastEnde: number | null, start: number): string | null {
  if (lastEnde == null) return null;
  if (start < lastEnde) return `km-Stand ${start} liegt unter dem letzten Ende (${lastEnde})`;
  if (start > lastEnde) return `Lücke von ${start - lastEnde} km seit der letzten Fahrt`;
  return null;
}

/** Cost overview per Gewerk (docs/fachkonzept/11): Prognose = Auftrag + beauftragte Nachträge + Einkäufe. */
export interface KostenZeile {
  budget: number | null;
  auftrag: number;
  nachtraegeBeauftragt: number;
  nachtraegeOffen: number;
  abgerechnet: number;
  rechnungenOffen: number;
  einkaeufe: number;
}
export function kostenPrognose(z: KostenZeile) {
  const prognose = z.auftrag + z.nachtraegeBeauftragt + z.einkaeufe;
  const mitOffenen = prognose + z.nachtraegeOffen;
  return {
    prognose,
    mitOffenen,
    abweichung: z.budget == null ? null : prognose - z.budget,
    restAuftrag: z.auftrag + z.nachtraegeBeauftragt - z.abgerechnet,
    ampel: z.budget == null ? ('grau' as const) : mitOffenen > z.budget ? ('rot' as const) : prognose > z.budget * 0.95 ? ('gelb' as const) : ('gruen' as const),
  };
}
