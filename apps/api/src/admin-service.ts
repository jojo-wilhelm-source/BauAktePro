/**
 * Administration (decided 12.11.2026): the administrator sees and manages everything of the own company –
 * all users with their projects and roles, locks/unlocks accounts, grants admin and firm-admin rights.
 * Every change is a rights change and goes to the audit log (per affected project, or tenant-wide entry).
 */
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { HttpError, type WriteMeta } from './mangel-service';

async function requireAdmin(tx: TxSql) {
  const [r] = await tx`SELECT app.is_admin() AS ok`;
  if (!r?.ok) throw new HttpError(403, 'Nur für Administratoren');
}

export async function adminOverview(tx: TxSql) {
  await requireAdmin(tx);
  const users = await tx`
    SELECT u.id, u.name, u.email, u.active, u.is_admin, u.company_admin, c.id AS company_id, c.name AS company, c.kind AS company_kind,
      app.user_last_seen(u.id) AS last_seen,
      coalesce((SELECT json_agg(json_build_object('project', p.name, 'role', pm.role) ORDER BY p.name)
                FROM project_member pm JOIN project p ON p.id = pm.project_id WHERE pm.user_id = u.id), '[]') AS projekte
    FROM app_user u JOIN company c ON c.id = u.company_id
    WHERE u.tenant_id = app.user_tenant()
    ORDER BY c.kind = 'own' DESC, c.name, u.name`;
  const projects = await tx`
    SELECT p.id, p.name, p.created_at,
      (SELECT count(*)::int FROM project_member pm WHERE pm.project_id = p.id) AS mitglieder,
      (SELECT count(*)::int FROM mangel m WHERE m.project_id = p.id AND m.deleted_at IS NULL AND m.status <> 'abgenommen') AS maengel_offen
    FROM project p WHERE p.tenant_id = app.user_tenant() ORDER BY p.name`;
  return { users, projects };
}

export async function adminUpdateUser(tx: TxSql, adminId: string, userId: string, input: unknown, meta: WriteMeta) {
  await requireAdmin(tx);
  const d = z.object({ active: z.boolean().optional(), is_admin: z.boolean().optional(), company_admin: z.boolean().optional() }).parse(input);
  if (userId === adminId && (d.active === false || d.is_admin === false)) throw new HttpError(422, 'Den eigenen Admin-Zugang kann man nicht sperren oder entziehen');
  const [u] = await tx`SELECT u.id, u.email, u.active, u.is_admin, u.company_admin, c.kind FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = ${userId}`;
  if (!u) throw new HttpError(404, 'Benutzer nicht gefunden');
  if (d.is_admin && u.kind !== 'own') throw new HttpError(422, 'Administratoren müssen zur eigenen Firma gehören');
  if (d.company_admin && u.kind !== 'nu') throw new HttpError(422, 'Firmen-Admin gibt es nur für Nachunternehmer');
  const patch = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return u;
  const [row] = await tx`UPDATE app_user SET ${tx(patch as never)}, updated_at = now() WHERE id = ${userId} RETURNING id, active, is_admin, company_admin`;
  // A locked account loses its sessions right away (devices must sign in again).
  if (d.active === false) await tx`SELECT app.end_sessions(${userId})`;
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    VALUES (app.user_tenant(), NULL, 'app_user', ${userId}, 'rechte_geaendert', ${adminId}, ${meta.deviceId}, ${meta.occurredAt},
            ${tx.json({ email: u.email, from: { active: u.active, is_admin: u.is_admin, company_admin: u.company_admin }, to: patch } as never)})`;
  return row;
}
