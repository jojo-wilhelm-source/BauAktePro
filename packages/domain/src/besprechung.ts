import { z } from 'zod';
import type { MangelStatus } from './mangel';

/**
 * NU-Besprechung (docs/fachkonzept/09, concept of the user "NU-Besprechung_Konzept_5", 12.11.2026):
 * BLOCKIERT (red), WICHTIG (orange), IN ARBEIT (yellow), ERLEDIGT / FREIGEMELDET (green), NICHT FÄLLIG (grey);
 * "überfällig" is shown on top when the due date has passed.
 */
export const PUNKT_STATUS = ['blockiert', 'wichtig', 'in_arbeit', 'erledigt', 'nicht_faellig'] as const;
export type PunktStatus = (typeof PUNKT_STATUS)[number];
export const PUNKT_STATUS_LABELS: Record<PunktStatus, string> = {
  blockiert: 'Blockiert', wichtig: 'Wichtig', in_arbeit: 'In Arbeit', erledigt: 'Erledigt / freigemeldet', nicht_faellig: 'Nicht fällig',
};
export const PUNKT_STATUS_ICON: Record<PunktStatus, string> = { blockiert: '🟥', wichtig: '🟧', in_arbeit: '🟨', erledigt: '🟩', nicht_faellig: '⬜' };
/** Ortes of the meeting place as in the concept. */
export const BESPRECHUNG_FORMATE = ['Baustelle', 'Baucontainer', 'MS Teams', 'Telefonisch'] as const;
export const punktUeberfaellig = (p: { status: PunktStatus; due_date?: string | null }, today = new Date().toISOString().slice(0, 10)) =>
  !!p.due_date && p.status !== 'erledigt' && p.due_date.slice(0, 10) < today;

/** Pin/status tones shared by Mängel and Punkte (docs/fachkonzept/03): red open, orange in progress, green done, blue info. */
export type Tone = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'gray';
export const PUNKT_TONE: Record<PunktStatus, Tone> = { blockiert: 'red', wichtig: 'orange', in_arbeit: 'yellow', erledigt: 'green', nicht_faellig: 'gray' };
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

/** Quick tap in the meeting: In Arbeit → Erledigt → Wichtig → Blockiert → Nicht fällig → In Arbeit (full choice in the menu). */
export function nextPunktStatus(s: PunktStatus): PunktStatus {
  const order: PunktStatus[] = ['in_arbeit', 'erledigt', 'wichtig', 'blockiert', 'nicht_faellig'];
  return order[(order.indexOf(s) + 1) % order.length]!;
}

/** "Folgesitzung vorbereiten": every active Punkt moves on (concept: only ERLEDIGT goes to the history). */
export function carriesOver(s: PunktStatus) {
  return s !== 'erledigt';
}

/** Sub-task of another firm (or the own firm: company_id null) under a Punkt, with its own status and due date. */
export const Teilaufgabe = z.object({
  id: z.string().uuid().optional(),
  company_id: z.string().uuid().nullish(),
  text: z.string().trim().min(1, 'Teilaufgabe beschreiben').max(2000),
  status: z.enum(PUNKT_STATUS).default('in_arbeit'),
  due_date: z.string().date().nullish(),
});

export const PunktCreate = z.object({
  id: z.string().uuid(),
  besprechung_id: z.string().uuid(),
  location_id: z.string().uuid().nullish(),
  gewerk_id: z.string().uuid().nullish(),
  text: z.string().trim().min(1, 'Text fehlt').max(4000),
  responsible_company_id: z.string().uuid().nullish(),
  support_company_ids: z.array(z.string().uuid()).default([]),
  status: z.enum(PUNKT_STATUS).default('in_arbeit'),
  due_date: z.string().date().nullish(),
  internal: z.boolean().default(false),
  /** Concept fields: contact of the firm, note/dependency, share of the own firm ("WHB-Anteil"), check/approval by the own firm. */
  kontakt: z.string().trim().max(200).nullish(),
  notiz: z.string().max(4000).nullish(),
  eigen_anteil: z.string().max(4000).nullish(),
  kontrolle: z.string().max(400).nullish(),
  teilaufgaben: z.array(Teilaufgabe).max(30).optional(),
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

/** Draft meeting header edits: title, date, place, remarks, next date (docs/fachkonzept/09). */
export const BesprechungPatch = z
  .object({
    title: z.string().trim().min(1).max(200),
    held_at: z.string().datetime({ offset: true }),
    place: z.string().max(200).nullable(),
    bemerkung: z.string().max(5000).nullable(),
    next_at: z.string().datetime({ offset: true }).nullable(),
    /** Protokollkopf as in the concept. */
    protokollfuehrung: z.string().max(200).nullable(),
    dokumentenstand: z.string().max(200).nullable(),
    /** "Allgemeine Informationen": short binding notes without status (safety, order, access times). */
    allgemein: z.array(z.string().max(2000)).max(40),
    /** Manual participants and extra recipients of this meeting. */
    extra_teilnehmer: z.array(z.object({ name: z.string().trim().min(1).max(120), email: z.string().email().nullish().or(z.literal('')) })).max(40),
    cc: z.string().max(2000).nullable(),
  })
  .partial();

/** Mail text template of the project (concept: Standard, Kurzform, Förmlich, Eigene). */
export const MAIL_VORLAGEN = {
  standard: { name: 'Standard', intro: 'Guten Tag,\n\nnachfolgend das Protokoll bzw. die offenen Punkte aus der NU-Besprechung.', outro: 'Bitte prüfen Sie die Ihnen zugeordneten Punkte und melden Rückfragen zeitnah zurück.' },
  kurz: { name: 'Kurzform', intro: 'Hallo zusammen,\n\nanbei die offenen Punkte aus der Besprechung.', outro: 'Bitte kurzfristig bearbeiten, danke.' },
  foermlich: { name: 'Förmlich', intro: 'Sehr geehrte Damen und Herren,\n\nim Rahmen der Nachunternehmerbesprechung wurden die nachfolgenden Punkte festgehalten und sind Bestandteil dieses Protokolls.', outro: 'Einwände gegen das Protokoll bitte innerhalb von 7 Tagen schriftlich.' },
} as const;
export const MailVorlage = z.object({ preset: z.enum(['standard', 'kurz', 'foermlich', 'eigen']).default('standard'), intro: z.string().max(4000), outro: z.string().max(4000), signatur: z.string().max(1000) });
export type MailVorlage = z.infer<typeof MailVorlage>;
export const VERTEILER_KATEGORIEN = { projektleiter: 'Projektleiter', bauleiter: 'Bauleiter', poliere: 'Poliere', sonstige: 'Sonstige Projektbeteiligte' } as const;

/** Attendance of a participating company: true = anwesend, false = entschuldigt/fehlt, null = not recorded. */
export const anwesendLabel = (a: boolean | null | undefined) => (a === true ? 'anwesend' : a === false ? 'entschuldigt' : '–');

/** iCalendar (RFC 5545) event for the next meeting; times in UTC. */
export function besprechungIcs(e: { uid: string; title: string; start: Date; minutes?: number; place?: string | null; description?: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const end = new Date(e.start.getTime() + (e.minutes ?? 60) * 60000);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Bau Akte Pro//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${e.uid}@bauaktepro`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(e.start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(e.title)}`, ...(e.place ? [`LOCATION:${esc(e.place)}`] : []), ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

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
