/**
 * Fotodokumentation (docs/fachkonzept/16, decided 12.11.2026): photos on plans before things are closed.
 * Categories are start values (configuration later).
 */
import { z } from 'zod';

export const FOTODOKU_KATEGORIEN = ['geschlossene_wand', 'schacht', 'doppelboden', 'hohlraumdecke', 'installation', 'bestand', 'baufortschritt', 'sonstiges'] as const;
export type FotodokuKategorie = (typeof FOTODOKU_KATEGORIEN)[number];
export const FOTODOKU_LABEL: Record<FotodokuKategorie, string> = {
  geschlossene_wand: 'Wand vor dem Schließen',
  schacht: 'Schacht',
  doppelboden: 'Doppelboden',
  hohlraumdecke: 'Hohlraum-/Abhangdecke',
  installation: 'Installation (TGA)',
  bestand: 'Bestand / Vorzustand',
  baufortschritt: 'Baufortschritt',
  sonstiges: 'Sonstiges',
};

/** A 360° photo is stored equirectangular (width = 2 × height), as the Insta360 app exports it. */
export function ist360(width?: number | null, height?: number | null, xmp?: string | null): boolean {
  if (xmp && /ProjectionType["'>=\s]*equirectangular/i.test(xmp)) return true;
  if (!width || !height) return false;
  return Math.abs(width / height - 2) < 0.02 && width >= 2000;
}

export const FotodokuInput = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  plan_id: z.string().uuid().nullish(),
  pin_page: z.number().int().positive().nullish(),
  pin_x: z.number().min(0).max(1).nullish(),
  pin_y: z.number().min(0).max(1).nullish(),
  location_id: z.string().uuid().nullish(),
  gewerk_id: z.string().uuid().nullish(),
  kategorie: z.enum(FOTODOKU_KATEGORIEN).default('sonstiges'),
  titel: z.string().trim().max(200).nullish(),
  notiz: z.string().max(4000).nullish(),
  ist_360: z.boolean().optional(),
  taken_at: z.string().datetime({ offset: true }).optional(),
});
export type FotodokuInput = z.infer<typeof FotodokuInput>;
export const FotodokuPatch = FotodokuInput.omit({ id: true, project_id: true, taken_at: true }).partial().extend({ base_version: z.number().int() });
