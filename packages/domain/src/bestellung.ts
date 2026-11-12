/**
 * Bestellanforderung (purchase request) from the site to the Einkauf (docs/fachkonzept/12, decided 12.11.2026):
 * offen → in_bearbeitung → angefragt (LV / Anfrage) → bestellt → geliefert; the Einkauf may also reject,
 * the requester may withdraw while it is still open. Start values; the chain is configuration later.
 */
import { z } from 'zod';

export const BANF_STATUS = ['offen', 'in_bearbeitung', 'angefragt', 'bestellt', 'geliefert', 'abgelehnt', 'zurueckgezogen'] as const;
export type BanfStatus = (typeof BANF_STATUS)[number];

export const BANF_LABEL: Record<BanfStatus, string> = {
  offen: 'Neu',
  in_bearbeitung: 'In Bearbeitung',
  angefragt: 'Angebote angefragt',
  bestellt: 'Bestellt',
  geliefert: 'Geliefert',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
};
export const BANF_TONE: Record<BanfStatus, 'red' | 'orange' | 'blue' | 'green' | 'gray' | 'yellow'> = {
  offen: 'orange', in_bearbeitung: 'blue', angefragt: 'yellow', bestellt: 'blue', geliefert: 'green', abgelehnt: 'gray', zurueckgezogen: 'gray',
};

/** Who does what: Einkauf / Leitung move the request on, the requester only withdraws. */
const EINKAUF: Record<BanfStatus, BanfStatus[]> = {
  offen: ['in_bearbeitung', 'angefragt', 'bestellt', 'abgelehnt'],
  in_bearbeitung: ['angefragt', 'bestellt', 'abgelehnt', 'offen'],
  angefragt: ['bestellt', 'in_bearbeitung', 'abgelehnt'],
  bestellt: ['geliefert', 'in_bearbeitung'],
  geliefert: ['bestellt'],
  abgelehnt: ['offen'],
  zurueckgezogen: [],
};

export function banfTransition(from: BanfStatus, to: BanfStatus, rolle: 'einkauf' | 'anforderer'): boolean {
  if (rolle === 'anforderer') return from === 'offen' && to === 'zurueckgezogen';
  return EINKAUF[from].includes(to);
}

/** Still waiting for the Einkauf (counts in the portal and the badge). */
export const banfOffen = (s: BanfStatus) => s === 'offen' || s === 'in_bearbeitung' || s === 'angefragt';

export const BanfPosition = z.object({
  text: z.string().trim().min(1).max(500),
  menge: z.coerce.number().min(0).max(1e9).nullish(),
  einheit: z.string().trim().max(20).nullish(),
});
export const BanfInput = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  titel: z.string().trim().min(2, 'Bitte kurz beschreiben, was gebraucht wird').max(200),
  beschreibung: z.string().max(5000).nullish(),
  positionen: z.array(BanfPosition).max(200).default([]),
  location_id: z.string().uuid().nullish(),
  gewerk_id: z.string().uuid().nullish(),
  benoetigt_am: z.string().date().nullish(),
  dringend: z.boolean().default(false),
});
export type BanfInput = z.infer<typeof BanfInput>;
