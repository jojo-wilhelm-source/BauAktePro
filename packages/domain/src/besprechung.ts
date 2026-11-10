import { z } from 'zod';
import type { MangelStatus } from './mangel';

/** NU-Besprechung (docs/fachkonzept/09): status of a Punkt, colours as on the plan pins. */
export const PUNKT_STATUS = ['offen', 'in_arbeit', 'erledigt', 'info'] as const;
export type PunktStatus = (typeof PUNKT_STATUS)[number];
export const PUNKT_STATUS_LABELS: Record<PunktStatus, string> = { offen: 'Offen', in_arbeit: 'In Arbeit', erledigt: 'Erledigt', info: 'Info' };

/** Pin/status tones shared by Mängel and Punkte (docs/fachkonzept/03): red open, orange in progress, green done, blue info. */
export type Tone = 'red' | 'orange' | 'green' | 'blue' | 'gray';
export const PUNKT_TONE: Record<PunktStatus, Tone> = { offen: 'red', in_arbeit: 'orange', erledigt: 'green', info: 'blue' };
export const MANGEL_TONE: Record<MangelStatus, Tone> = {
  neu: 'red',
  zugewiesen: 'red',
  nicht_behoben: 'red',
  strittig: 'red',
  in_bearbeitung: 'orange',
  behoben_gemeldet: 'orange',
  abgenommen: 'green',
};

export const punktNo = (n: number | null | undefined) => (n ? `P-${String(n).padStart(3, '0')}` : 'neu');
export const besprechungNo = (n: number | null | undefined) => (n ? `Nr. ${n}` : 'Entwurf');

/** Tapping the status chip in the meeting: Offen → In Arbeit → Erledigt → Offen. Info stays Info. */
export function nextPunktStatus(s: PunktStatus): PunktStatus {
  return s === 'offen' ? 'in_arbeit' : s === 'in_arbeit' ? 'erledigt' : s === 'erledigt' ? 'offen' : 'info';
}

/** "Folgesitzung vorbereiten": open and running Punkte move on, done ones are archived. ANNAHME: Info is not carried automatically. */
export function carriesOver(s: PunktStatus) {
  return s === 'offen' || s === 'in_arbeit';
}

export const PunktCreate = z.object({
  id: z.string().uuid(),
  besprechung_id: z.string().uuid(),
  location_id: z.string().uuid().nullish(),
  gewerk_id: z.string().uuid().nullish(),
  text: z.string().trim().min(1, 'Text fehlt').max(4000),
  responsible_company_id: z.string().uuid().nullish(),
  support_company_ids: z.array(z.string().uuid()).default([]),
  status: z.enum(PUNKT_STATUS).default('offen'),
  due_date: z.string().date().nullish(),
  internal: z.boolean().default(false),
});
export const PunktPatch = PunktCreate.omit({ id: true, besprechung_id: true })
  .extend({ plan_id: z.string().uuid().nullish(), pin_page: z.number().int().positive().nullish(), pin_x: z.number().min(0).max(1).nullish(), pin_y: z.number().min(0).max(1).nullish() })
  .partial();

export const BesprechungCreate = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  kind: z.enum(['nu', 'bau']).default('nu'),
  title: z.string().trim().min(1).max(200).default('NU-Besprechung'),
  held_at: z.string().datetime({ offset: true }),
  place: z.string().max(200).nullish(),
  company_ids: z.array(z.string().uuid()).default([]),
  /** Previous meeting: its open Punkte are carried over. */
  previous_id: z.string().uuid().nullish(),
});

/** Plan index sequence: A → B … Z → AA (docs/fachkonzept/03). */
export function nextPlanIndex(i: string): string {
  const s = i.toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return 'A';
  const chars = s.split('');
  let k = chars.length - 1;
  while (k >= 0 && chars[k] === 'Z') chars[k--] = 'A';
  if (k < 0) return `A${chars.join('')}`;
  chars[k] = String.fromCharCode(chars[k]!.charCodeAt(0) + 1);
  return chars.join('');
}

export const PLAN_REVISION_LABELS = { zur_pruefung: 'Zur Prüfung', freigegeben: 'Freigegeben', abgelehnt: 'Abgelehnt', ersetzt: 'Ersetzt' } as const;
export type PlanRevisionStatus = keyof typeof PLAN_REVISION_LABELS;
