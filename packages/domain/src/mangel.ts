import { z } from 'zod';
import type { ProjectRole } from './roles';

/** Status chain of a Mangel (docs/fachkonzept/04-maengel.md). */
export const MANGEL_STATUS = [
  'neu',
  'zugewiesen',
  'in_bearbeitung',
  'behoben_gemeldet',
  'nicht_behoben',
  'abgenommen',
  'strittig',
] as const;
export type MangelStatus = (typeof MANGEL_STATUS)[number];

export const MANGEL_STATUS_LABELS: Record<MangelStatus, string> = {
  neu: 'Neu',
  zugewiesen: 'Zugewiesen',
  in_bearbeitung: 'In Bearbeitung',
  behoben_gemeldet: 'Behoben gemeldet',
  nicht_behoben: 'Nicht behoben',
  abgenommen: 'Geprüft/Abgenommen',
  strittig: 'Strittig',
};

export const PRIORITIES = ['kritisch', 'normal', 'gering'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Start values, configurable per project later (Arbeitsweise 5). */
export const DEFAULT_DEADLINE_DAYS: Record<Priority, number> = { kritisch: 3, normal: 14, gering: 28 };
/** ANNAHME (offene-punkte B7): suggested length of the 2nd Nachfrist. */
export const DEFAULT_NACHFRIST_DAYS: Record<Priority, number> = { kritisch: 3, normal: 7, gering: 7 };

/** Context needed to decide whether a user may perform a transition. */
export interface TransitionActor {
  role: ProjectRole;
  userId: string;
  companyId: string | null;
}
export interface TransitionTarget {
  status: MangelStatus;
  createdBy: string;
  creatorRole: ProjectRole;
  assignedCompanyId: string | null;
}

type Rule = (actor: TransitionActor, m: TransitionTarget) => boolean;

const isBauleitung: Rule = (a) => a.role === 'bauleitung';
const isAssignedNu: Rule = (a, m) => a.role === 'nu' && a.companyId !== null && a.companyId === m.assignedCompanyId;
/** B2: Bauleitung, or the creator if Polier/Bauherr. A NU never accepts. */
const mayAccept: Rule = (a, m) =>
  a.role === 'bauleitung' ||
  (a.userId === m.createdBy && (m.creatorRole === 'polier' || m.creatorRole === 'bauherr') && a.role !== 'nu');

/** Allowed transitions: from → to → who may do it. */
const TRANSITIONS: Partial<Record<MangelStatus, Partial<Record<MangelStatus, Rule>>>> = {
  neu: { zugewiesen: isBauleitung },
  zugewiesen: { in_bearbeitung: isAssignedNu, strittig: isAssignedNu },
  in_bearbeitung: { behoben_gemeldet: isAssignedNu, strittig: isAssignedNu },
  nicht_behoben: { in_bearbeitung: isAssignedNu, strittig: isAssignedNu },
  behoben_gemeldet: { abgenommen: mayAccept, nicht_behoben: mayAccept },
  strittig: { zugewiesen: isBauleitung, abgenommen: isBauleitung },
};

export function allowedTransitions(actor: TransitionActor, m: TransitionTarget): MangelStatus[] {
  const from = TRANSITIONS[m.status] ?? {};
  return (Object.entries(from) as [MangelStatus, Rule][]).filter(([, rule]) => rule(actor, m)).map(([to]) => to);
}

export function canTransition(actor: TransitionActor, m: TransitionTarget, to: MangelStatus): boolean {
  return TRANSITIONS[m.status]?.[to]?.(actor, m) ?? false;
}

/** Fields a client may send when creating a Mangel (offline, client-generated id). */
export const MangelCreate = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  location_id: z.string().uuid(),
  gewerk_id: z.string().uuid(),
  description: z.string().trim().min(1, 'Beschreibung ist Pflicht'),
  priority: z.enum(PRIORITIES).default('normal'),
  due_date: z.string().date().nullish(),
  plan_id: z.string().uuid().nullish(),
  pin_page: z.number().int().positive().nullish(),
  pin_x: z.number().min(0).max(1).nullish(),
  pin_y: z.number().min(0).max(1).nullish(),
  /** Proposed company; becomes effective only after Bauleitung confirms (B1). */
  assigned_company_id: z.string().uuid().nullish(),
  visible_to_bauherr: z.boolean().default(false),
});
export type MangelCreate = z.infer<typeof MangelCreate>;

/** Editable fields (no status – status changes go through transitions). */
export const MangelPatch = MangelCreate.omit({ id: true, project_id: true }).partial();
export type MangelPatch = z.infer<typeof MangelPatch>;

/** Escalation stage shown in the Mängel table (docs 04, "Anzeige in der Mängeltabelle"). */
export type EscalationStage = 'keine_frist' | 'erledigt' | 'laeuft' | 'bald_faellig' | 'ueberfaellig' | 'an_bauleitung';
export interface Escalation {
  stage: EscalationStage;
  /** Days overdue (positive) or remaining (negative). */
  daysOverdue: number | null;
  ampel: 'gruen' | 'gelb' | 'rot' | 'grau';
  label: string;
  /** Suggested 2nd Nachfrist (ISO date) once the deadline has passed and none is set yet. */
  nachfristSuggestion: string | null;
}

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Thresholds from the company settings (Einstellungen.maengel); defaults = start values of the Fachkonzept. */
export interface EskalationsRegeln { vorwarnung_tage: number; eskalation_tage: number; nachfrist_tage: Record<Priority, number> }
const STANDARD_REGELN: EskalationsRegeln = { vorwarnung_tage: 2, eskalation_tage: 7, nachfrist_tage: DEFAULT_NACHFRIST_DAYS };

export function escalation(
  m: { status: MangelStatus; due_date: string | null; nachfrist_date: string | null; priority: Priority },
  today: Date = new Date(),
  regeln: EskalationsRegeln = STANDARD_REGELN,
): Escalation {
  if (m.status === 'abgenommen') return { stage: 'erledigt', daysOverdue: null, ampel: 'grau', label: 'Erledigt', nachfristSuggestion: null };
  const deadline = m.nachfrist_date ?? m.due_date;
  if (!deadline) return { stage: 'keine_frist', daysOverdue: null, ampel: 'grau', label: 'Keine Frist', nachfristSuggestion: null };
  const t = toDate(toIso(today)).getTime();
  const days = Math.round((t - toDate(deadline).getTime()) / DAY);
  const suggestion =
    days > 0 && !m.nachfrist_date ? toIso(new Date(t + regeln.nachfrist_tage[m.priority] * DAY)) : null;
  const prefix = m.nachfrist_date ? '2. Nachfrist ' : '';
  if (days < -regeln.vorwarnung_tage) return { stage: 'laeuft', daysOverdue: days, ampel: 'gruen', label: `${prefix}läuft (${-days} Tage)`, nachfristSuggestion: null };
  if (days <= 0) return { stage: 'bald_faellig', daysOverdue: days, ampel: 'gelb', label: days === 0 ? `${prefix}heute fällig` : `${prefix}in ${-days} Tagen fällig`, nachfristSuggestion: null };
  if (days < regeln.eskalation_tage) return { stage: 'ueberfaellig', daysOverdue: days, ampel: 'rot', label: `${prefix}überfällig seit ${days} Tagen`, nachfristSuggestion: suggestion };
  // Decided 12.11.2026: no escalation to the Geschäftsführung; from day 7 (configurable) the Bauleitung is the last stage.
  return { stage: 'an_bauleitung', daysOverdue: days, ampel: 'rot', label: `${prefix}überfällig ${days} Tage – Bauleitung`, nachfristSuggestion: suggestion };
}

export function defaultDueDate(priority: Priority, from: Date = new Date(), tage: Record<Priority, number> = DEFAULT_DEADLINE_DAYS): string {
  return toIso(new Date(toDate(toIso(from)).getTime() + tage[priority] * DAY));
}
