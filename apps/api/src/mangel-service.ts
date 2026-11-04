import type { TxSql } from '@bap/db';
import {
  canTransition,
  defaultDueDate,
  MangelCreate,
  MangelPatch,
  MANGEL_STATUS,
  MANGEL_STATUS_LABELS,
  type MangelStatus,
  type ProjectRole,
} from '@bap/domain';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Actor {
  userId: string;
  companyId: string;
  role: ProjectRole;
  deviceId: string | null;
}

/** Context of a write: when it happened on the device (offline writes arrive later). */
export interface WriteMeta {
  occurredAt: Date;
  deviceId: string | null;
}

type Row = Record<string, unknown> & { id: string; project_id: string; version: number; status: MangelStatus };

export async function actorFor(tx: TxSql, userId: string, projectId: string): Promise<Actor> {
  const [m] = await tx`SELECT role, company_id FROM project_member WHERE project_id = ${projectId} AND user_id = ${userId}`;
  if (!m) throw new HttpError(403, 'Kein Zugriff auf dieses Projekt');
  return { userId, companyId: m.company_id as string, role: m.role as ProjectRole, deviceId: null };
}

async function audit(tx: TxSql, actor: Actor, m: { id: string; project_id: string }, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${m.project_id}, 'mangel', ${m.id}, ${action}, ${actor.userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${m.project_id}`;
}

async function load(tx: TxSql, id: string): Promise<Row> {
  // RLS: returns nothing if the user may not see the row.
  const [row] = await tx`SELECT * FROM mangel WHERE id = ${id}`;
  if (!row) throw new HttpError(404, 'Mangel nicht gefunden');
  return row as Row;
}

export async function createMangel(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const data = MangelCreate.parse(input);
  const actor = await actorFor(tx, userId, data.project_id);
  const [existing] = await tx`SELECT id FROM mangel WHERE id = ${data.id}`;
  if (existing) return load(tx, data.id); // idempotent: a retried offline upload must not create duplicates
  const internal = actor.role === 'bauleitung' || actor.role === 'polier';
  // Only Bauleitung can make an assignment effective; everyone else proposes (B1).
  const confirmed = actor.role === 'bauleitung' && !!data.assigned_company_id;
  const [{ n }] = (await tx`SELECT app.next_mangel_number(${data.project_id}) AS n`) as unknown as [{ n: number }];
  const row = {
    ...data,
    due_date: data.due_date ?? defaultDueDate(data.priority, meta.occurredAt),
    number: n,
    status: confirmed ? 'zugewiesen' : 'neu',
    assignment_confirmed: confirmed,
    visible_to_bauherr: internal ? data.visible_to_bauherr : actor.role === 'bauherr',
    reporter_company_id: actor.companyId,
    created_by: actor.userId,
    creator_role: actor.role,
    created_at: meta.occurredAt,
  };
  await tx`INSERT INTO mangel ${tx(row as never)}`;
  const created = await load(tx, data.id);
  await audit(tx, actor, created, 'erstellt', meta, { status: created.status });
  return created;
}

export type WriteResult =
  | { ok: true; mangel: Row }
  | { ok: false; kind: 'conflict' | 'rejected'; reason: string; conflictId: string };

async function recordProblem(
  tx: TxSql, actor: Actor, current: Row | null, projectId: string, entityId: string,
  kind: 'conflict' | 'rejected', reason: string, baseVersion: number | null, change: object,
): Promise<WriteResult> {
  const [c] = await tx`
    INSERT INTO sync_conflict (project_id, entity, entity_id, actor_id, base_version, server_version, client_change, server_state, kind, reason)
    VALUES (${projectId}, 'mangel', ${entityId}, ${actor.userId}, ${baseVersion}, ${current?.version ?? null},
            ${tx.json(change as never)}, ${current ? tx.json(current as never) : null}, ${kind}, ${reason})
    RETURNING id`;
  return { ok: false, kind, reason, conflictId: c!.id as string };
}

/** Field edits. Which fields a role may edit is decided here; RLS decides which rows. */
const EDITABLE_BY: Record<ProjectRole, readonly string[]> = {
  bauleitung: ['location_id', 'gewerk_id', 'description', 'priority', 'due_date', 'plan_id', 'pin_page', 'pin_x', 'pin_y', 'assigned_company_id', 'visible_to_bauherr'],
  polier: ['location_id', 'gewerk_id', 'description', 'priority', 'plan_id', 'pin_page', 'pin_x', 'pin_y', 'assigned_company_id'],
  bauherr: ['description'],
  nu: [],
  einkauf: [],
};

export async function patchMangel(tx: TxSql, userId: string, id: string, baseVersion: number, input: unknown, meta: WriteMeta): Promise<WriteResult> {
  const current = await load(tx, id);
  const actor = await actorFor(tx, userId, current.project_id);
  const patch = MangelPatch.parse(input);
  const forbidden = Object.keys(patch).filter((k) => !EDITABLE_BY[actor.role].includes(k));
  if (forbidden.length) return recordProblem(tx, actor, current, current.project_id, id, 'rejected', `Keine Berechtigung für: ${forbidden.join(', ')}`, baseVersion, patch);
  if (current.status === 'abgenommen') return recordProblem(tx, actor, current, current.project_id, id, 'rejected', 'Abgenommene Mängel sind gesperrt', baseVersion, patch);
  if (current.version !== baseVersion) {
    // Fields nobody else touched in the meantime could be merged later; for now: never overwrite silently.
    return recordProblem(tx, actor, current, current.project_id, id, 'conflict', 'Der Mangel wurde inzwischen geändert', baseVersion, patch);
  }
  // Changing the proposed company resets the confirmation unless Bauleitung does it.
  const extra: Record<string, unknown> = {};
  if ('assigned_company_id' in patch && patch.assigned_company_id !== current.assigned_company_id) {
    extra.assignment_confirmed = actor.role === 'bauleitung' && !!patch.assigned_company_id;
    if (current.status === 'zugewiesen' && !extra.assignment_confirmed) extra.status = 'neu';
  }
  const [row] = await tx`
    UPDATE mangel SET ${tx({ ...patch, ...extra } as never)}, version = version + 1, updated_at = now()
    WHERE id = ${id} AND version = ${baseVersion} RETURNING *`;
  if (!row) return recordProblem(tx, actor, current, current.project_id, id, 'conflict', 'Gleichzeitige Änderung', baseVersion, patch);
  await audit(tx, actor, current, 'geaendert', meta, { patch: { ...patch, ...extra }, base_version: baseVersion });
  return { ok: true, mangel: row as Row };
}

export const TransitionInput = z.object({
  to: z.enum(MANGEL_STATUS),
  base_version: z.number().int(),
  assigned_company_id: z.string().uuid().optional(),
  comment: z.string().optional(),
});

/**
 * Status change. Works for online calls AND for decisions recorded offline ("vormerken", docs 05):
 * the decision is applied only if the Mangel is still at the version it was based on.
 */
export async function transitionMangel(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta): Promise<WriteResult> {
  const t = TransitionInput.parse(input);
  const current = await load(tx, id);
  const actor = await actorFor(tx, userId, current.project_id);
  const target = {
    status: current.status,
    createdBy: current.created_by as string,
    creatorRole: current.creator_role as ProjectRole,
    assignedCompanyId: (t.assigned_company_id ?? current.assigned_company_id) as string | null,
  };
  if (current.version !== t.base_version) {
    return recordProblem(tx, actor, current, current.project_id, id, 'conflict',
      `Vorgemerkte Entscheidung „${MANGEL_STATUS_LABELS[t.to]}“ nicht angewendet: Der Mangel wurde inzwischen geändert (jetzt „${MANGEL_STATUS_LABELS[current.status]}“). Bitte neu entscheiden.`, t.base_version, t);
  }
  if (!canTransition(actor, target, t.to)) {
    return recordProblem(tx, actor, current, current.project_id, id, 'rejected', `Statuswechsel „${MANGEL_STATUS_LABELS[current.status]}“ → „${MANGEL_STATUS_LABELS[t.to]}“ ist für Ihre Rolle nicht erlaubt`, t.base_version, t);
  }
  const set: Record<string, unknown> = { status: t.to };
  if (t.to === 'zugewiesen') {
    if (!target.assignedCompanyId) throw new HttpError(422, 'Für die Zuweisung fehlt der Nachunternehmer');
    set.assigned_company_id = target.assignedCompanyId;
    set.assignment_confirmed = true;
  }
  const [row] = await tx`
    UPDATE mangel SET ${tx(set as never)}, version = version + 1, updated_at = now()
    WHERE id = ${id} AND version = ${t.base_version} RETURNING *`;
  if (!row) return recordProblem(tx, actor, current, current.project_id, id, 'conflict', 'Gleichzeitige Änderung', t.base_version, t);
  await audit(tx, actor, current, 'status', meta, { from: current.status, to: t.to, comment: t.comment ?? null, base_version: t.base_version });
  return { ok: true, mangel: row as Row };
}

/** Bauleitung sets the 2nd Nachfrist (usually the suggestion shown in the table). */
export async function setNachfrist(tx: TxSql, userId: string, id: string, date: string, baseVersion: number, meta: WriteMeta): Promise<WriteResult> {
  const current = await load(tx, id);
  const actor = await actorFor(tx, userId, current.project_id);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Nur die Bauleitung setzt eine Nachfrist');
  if (current.version !== baseVersion) return recordProblem(tx, actor, current, current.project_id, id, 'conflict', 'Der Mangel wurde inzwischen geändert', baseVersion, { nachfrist_date: date });
  const [row] = await tx`UPDATE mangel SET nachfrist_date = ${date}, version = version + 1, updated_at = now() WHERE id = ${id} RETURNING *`;
  await audit(tx, actor, current, 'nachfrist', meta, { nachfrist_date: date });
  return { ok: true, mangel: row as Row };
}
