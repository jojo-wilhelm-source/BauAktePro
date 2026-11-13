/**
 * Company settings (decided 13.11.2026): values the IT administrator can change instead of having them fixed in code.
 * Stored as one jsonb document per company; every missing key falls back to the defaults here (start values from the
 * Fachkonzept). Only add keys here – the UI and the API read this schema.
 */
import { z } from 'zod';
import { FREIGABEGRENZE_NETTO } from './stunden';
import { FOTODOKU_KATEGORIEN, FOTODOKU_LABEL } from './fotodoku';

const Tage = z.coerce.number().int().min(0).max(365);
const Prio = z.object({ kritisch: Tage, normal: Tage, gering: Tage });

export const Einstellungen = z.object({
  maengel: z.object({
    /** Default deadline in days after recording, per priority. */
    frist_tage: Prio,
    /** Suggested Nachfrist when a deadline has passed. */
    nachfrist_tage: Prio,
    /** Days before the deadline from which it shows "bald fällig". */
    vorwarnung_tage: Tage,
    /** Days overdue after which the Bauleitung is alerted. */
    eskalation_tage: Tage,
  }),
  freigabe: z.object({
    /** Nachträge above this net amount need an additional approval. */
    nachtrag_grenze_netto: z.coerce.number().min(0).max(1e9),
  }),
  benachrichtigung: z.object({
    bestellung_mail: z.boolean(),
    status_mail: z.boolean(),
    angebot_mail: z.boolean(),
  }),
  fotodoku: z.object({
    kategorien: z.record(z.enum(FOTODOKU_KATEGORIEN), z.object({ label: z.string().trim().min(1).max(60), aktiv: z.boolean() })),
  }),
  anzeige: z.object({
    /** Name shown in the browser tab and mails, e.g. "WHB Bau Akte". */
    app_name: z.string().trim().min(1).max(60),
  }),
});
export type Einstellungen = z.infer<typeof Einstellungen>;

export const EINSTELLUNGEN_STANDARD: Einstellungen = {
  maengel: { frist_tage: { kritisch: 3, normal: 14, gering: 28 }, nachfrist_tage: { kritisch: 3, normal: 7, gering: 7 }, vorwarnung_tage: 2, eskalation_tage: 7 },
  freigabe: { nachtrag_grenze_netto: FREIGABEGRENZE_NETTO },
  benachrichtigung: { bestellung_mail: true, status_mail: true, angebot_mail: true },
  fotodoku: { kategorien: Object.fromEntries(FOTODOKU_KATEGORIEN.map((k) => [k, { label: FOTODOKU_LABEL[k], aktiv: true }])) as Einstellungen['fotodoku']['kategorien'] },
  anzeige: { app_name: 'Bau Akte Pro' },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? merge(base[k], v) : v;
  return out;
}

/** Stored values over the defaults; invalid stored values fall back to the default (never break the app). */
export function mitStandard(werte: unknown): Einstellungen {
  const r = Einstellungen.safeParse(merge(EINSTELLUNGEN_STANDARD, werte ?? {}));
  return r.success ? r.data : EINSTELLUNGEN_STANDARD;
}

/** Escalation thresholds for escalation() from the settings. */
export const eskalationsRegeln = (e: Einstellungen) => ({ vorwarnung_tage: e.maengel.vorwarnung_tage, eskalation_tage: e.maengel.eskalation_tage, nachfrist_tage: e.maengel.nachfrist_tage });
