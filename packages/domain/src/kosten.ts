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
export const FAHRZEUG_ARTEN = { fahrzeug: 'Fahrzeug', maschine: 'Maschine / Gerät', tankstelle: 'Mobile Tankstelle' } as const;
export type FahrzeugArt = keyof typeof FAHRZEUG_ARTEN;

/**
 * Fill-up. Vehicles need the km reading, machines the Betriebsstunden; refills of a mobile station need neither.
 * quelle_id = mobile station the diesel came from (then usually without price). Which reading is required depends
 * on the kind of the target, checked by the server (tankenPflicht).
 */
export const TankenInput = z.object({
  id: z.string().uuid(),
  fahrzeug_id: z.string().uuid(),
  datum: z.string().date(),
  liter: z.coerce.number().positive().max(10000),
  betrag_brutto: z.coerce.number().min(0).max(50000).nullish(),
  km_stand: z.coerce.number().int().min(0).nullish(),
  betriebsstunden: z.coerce.number().min(0).max(1_000_000).nullish(),
  tankstelle: z.string().max(200).nullish(),
  quelle_id: z.string().uuid().nullish(),
  project_id: z.string().uuid().nullish(),
});
export type Tanken = z.infer<typeof TankenInput>;

/** Missing required reading for the kind of target, or null if complete. */
export function tankenPflicht(art: FahrzeugArt, t: Pick<Tanken, 'km_stand' | 'betriebsstunden' | 'liter' | 'quelle_id' | 'fahrzeug_id'>): string | null {
  if (t.quelle_id && t.quelle_id === t.fahrzeug_id) return 'Die Tankstelle kann sich nicht selbst betanken';
  if (art === 'fahrzeug' && t.km_stand == null) return 'Bitte den km-Stand angeben';
  if (art === 'maschine' && t.betriebsstunden == null) return 'Bitte die Betriebsstunden angeben';
  if (art === 'tankstelle' && t.quelle_id) return 'Eine Tankstelle wird nicht aus einer anderen befüllt';
  if (art !== 'tankstelle' && t.liter > 1500) return 'Mehr als 1.500 Liter – bitte prüfen';
  return null;
}

/** Consumption of a machine in l/h between two fill-ups (Betriebsstunden). */
export function verbrauchProStunde(prevBh: number | null | undefined, cur: { betriebsstunden: number | null | undefined; liter: number }): number | null {
  if (prevBh == null || cur.betriebsstunden == null || cur.betriebsstunden <= prevBh) return null;
  return Math.round((cur.liter / (cur.betriebsstunden - prevBh)) * 10) / 10;
}

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
