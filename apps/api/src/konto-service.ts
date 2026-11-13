/**
 * Own account (decided 13.11.2026): name, phone, password and personal settings – for every role.
 * Personal settings: which kinds of notification also come by e-mail (the in-app notification always comes).
 * Project archive: the Leitung archives finished projects; they stay readable but leave sidebars and overviews.
 */
import { verifyPassword } from 'better-auth/crypto';
import { z } from 'zod';
import type { Sql, TxSql } from '@bap/db';
import { setPassword } from './anmeldung';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

/** Notification kinds a person can take off e-mail. */
export const MAIL_ARTEN = { bestellanforderung: 'Bestellanforderungen', angebot: 'Angebote' } as const;

const KontoInput = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  telefon: z.string().trim().max(40).nullish(),
  einstellungen: z.object({ mail_aus: z.array(z.enum(Object.keys(MAIL_ARTEN) as [keyof typeof MAIL_ARTEN])).max(20).default([]) }).optional(),
});

export async function konto(tx: TxSql, userId: string) {
  const [u] = await tx`SELECT u.id, u.name, u.email, u.telefon, u.einstellungen, c.name AS firma FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = ${userId}`;
  return { ...u, mail_arten: MAIL_ARTEN };
}

export async function saveKonto(tx: TxSql, userId: string, input: unknown) {
  const d = KontoInput.parse(input);
  const patch: Record<string, unknown> = {};
  if (d.name) patch.name = d.name;
  if (d.telefon !== undefined) patch.telefon = d.telefon || null;
  if (d.einstellungen) patch.einstellungen = tx.json(d.einstellungen as never);
  if (Object.keys(patch).length) await tx`UPDATE app_user SET ${tx(patch as never)} WHERE id = ${userId}`;
  return konto(tx, userId);
}

const PasswortInput = z.object({ alt: z.string().min(1).max(128), neu: z.string().min(10, 'Mindestens 10 Zeichen').max(128) });

/** Change the own password (old one required); other sessions are ended – devices sign in again. */
export async function passwortAendern(admin: Sql, userId: string, input: unknown, sessionToken: string | null) {
  const d = PasswortInput.parse(input);
  const [a] = await admin`SELECT password FROM auth_account WHERE user_id = ${userId} AND provider_id = 'credential'`;
  if (!a?.password || !(await verifyPassword({ hash: a.password as string, password: d.alt }))) throw new HttpError(422, 'Das bisherige Passwort stimmt nicht');
  if (d.alt === d.neu) throw new HttpError(422, 'Bitte ein neues Passwort wählen');
  await setPassword(admin, userId, d.neu);
  await admin`DELETE FROM auth_session WHERE user_id = ${userId} ${sessionToken ? admin`AND token <> ${sessionToken}` : admin``}`;
  await admin`INSERT INTO audit_log (tenant_id, entity, entity_id, action, actor_id, occurred_at, data)
              SELECT tenant_id, 'app_user', id, 'passwort_geaendert', id, now(), '{}' FROM app_user WHERE id = ${userId}`;
  return { ok: true };
}

/** Archive or restore a project (Bau-/Projektleitung). */
export async function archivieren(tx: TxSql, userId: string, projectId: string, input: unknown, meta: WriteMeta) {
  const { archiviert } = z.object({ archiviert: z.boolean() }).parse(input);
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Archivieren darf die Bau- oder Projektleitung');
  await tx`UPDATE project SET archiviert_at = ${archiviert ? tx`now()` : null} WHERE id = ${projectId}`;
  await tx`INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
           SELECT tenant_id, id, 'project', id, ${archiviert ? 'archiviert' : 'wiederhergestellt'}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, '{}' FROM project WHERE id = ${projectId}`;
  return { ok: true };
}
