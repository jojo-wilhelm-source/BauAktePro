/**
 * IT administration (decided 13.11.2026): company settings, system overview and the audit log viewer.
 * Settings: one jsonb document per company over the defaults in @bap/domain (einstellungen.ts).
 */
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Sql, TxSql } from '@bap/db';
import { Einstellungen, mitStandard, type Einstellungen as E } from '@bap/domain';
import { HttpError, type WriteMeta } from './mangel-service';

async function requireAdmin(tx: TxSql) {
  const [r] = await tx`SELECT app.is_admin() AS ok`;
  if (!r?.ok) throw new HttpError(403, 'Nur für Administratoren');
}

/** Settings of the signed-in user's company (defaults for everything not set). */
export async function ladeEinstellungen(tx: TxSql | Sql, tenantId?: string): Promise<E> {
  const [r] = tenantId
    ? await tx`SELECT werte FROM tenant_einstellung WHERE tenant_id = ${tenantId}`
    : await tx`SELECT werte FROM tenant_einstellung WHERE tenant_id = app.user_tenant()`;
  return mitStandard(r?.werte);
}

export async function saveEinstellungen(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  await requireAdmin(tx);
  const neu = Einstellungen.parse(input);
  const alt = await ladeEinstellungen(tx);
  await tx`INSERT INTO tenant_einstellung (tenant_id, werte, updated_by) VALUES (app.user_tenant(), ${tx.json(neu as never)}, ${userId})
           ON CONFLICT (tenant_id) DO UPDATE SET werte = EXCLUDED.werte, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  // Which top-level areas changed – kept in the audit log (settings are rights-relevant configuration).
  const geaendert = (Object.keys(neu) as (keyof E)[]).filter((k) => JSON.stringify(neu[k]) !== JSON.stringify(alt[k]));
  await tx`INSERT INTO audit_log (tenant_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
           VALUES (app.user_tenant(), 'einstellungen', app.user_tenant(), 'geaendert', ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json({ bereiche: geaendert } as never)})`;
  return neu;
}

// --- System overview -----------------------------------------------------------------------------

const STORAGE = fileURLToPath(new URL('../../../storage/', import.meta.url));
const BEREICHE: Record<string, string> = { plans: 'Pläne', dokumente: 'Dokumente', fotos: 'Fotos (Mängel, Fotodoku)', besprechung: 'Besprechungsfotos', belege: 'Belege', einreichungen: 'Nachträge & Rechnungen', angebote: 'Angebote', protokolle: 'Protokolle (PDF)', anzeigen: 'Mangelanzeigen (PDF)', logos: 'Logos' };
let speicherCache: { at: number; werte: { bereich: string; label: string; bytes: number; dateien: number }[] } | null = null;

async function groesse(dir: string): Promise<{ bytes: number; dateien: number }> {
  let bytes = 0, dateien = 0;
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return { bytes, dateien }; }
  for (const e of entries) {
    if (e.isDirectory()) { const s = await groesse(dir + e.name + '/'); bytes += s.bytes; dateien += s.dateien; }
    else { try { bytes += (await stat(dir + e.name)).size; dateien++; } catch { /* vanished */ } }
  }
  return { bytes, dateien };
}

/** Storage per area (cached 5 minutes – walking large stores is not free). */
async function speicher() {
  if (speicherCache && Date.now() - speicherCache.at < 5 * 60_000) return speicherCache.werte;
  const werte = await Promise.all(Object.entries(BEREICHE).map(async ([bereich, label]) => ({ bereich, label, ...(await groesse(`${STORAGE}${bereich}/`)) })));
  speicherCache = { at: Date.now(), werte: werte.sort((a, b) => b.bytes - a.bytes) };
  return speicherCache.werte;
}

export async function systemUebersicht(tx: TxSql) {
  await requireAdmin(tx);
  const [z] = await tx`
    SELECT
      (SELECT count(*)::int FROM app_user WHERE tenant_id = app.user_tenant() AND active) AS benutzer_aktiv,
      (SELECT count(*)::int FROM app_user WHERE tenant_id = app.user_tenant() AND NOT active) AS benutzer_gesperrt,
      (SELECT count(*)::int FROM app_user WHERE tenant_id = app.user_tenant() AND is_admin) AS admins,
      (SELECT count(*)::int FROM app_user u WHERE u.tenant_id = app.user_tenant() AND app.user_last_seen(u.id) > now() - interval '7 days') AS aktiv_7_tage,
      (SELECT count(*)::int FROM einladung WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS einladungen_offen,
      (SELECT count(*)::int FROM project WHERE tenant_id = app.user_tenant()) AS projekte,
      (SELECT count(*)::int FROM company WHERE tenant_id = app.user_tenant() AND kind = 'nu') AS nachunternehmer,
      (SELECT count(*)::int FROM sync_conflict WHERE resolved_at IS NULL) AS konflikte,
      (SELECT count(*)::int FROM audit_log WHERE tenant_id = app.user_tenant() AND recorded_at > now() - interval '24 hours') AS ereignisse_24h,
      (SELECT count(*)::int FROM mangel m JOIN project p ON p.id = m.project_id WHERE p.tenant_id = app.user_tenant() AND m.deleted_at IS NOT NULL) AS papierkorb`;
  const anmeldungen = await tx`
    SELECT u.id, u.name, c.name AS firma, app.user_last_seen(u.id) AS zuletzt FROM app_user u JOIN company c ON c.id = u.company_id
    WHERE u.tenant_id = app.user_tenant() AND app.user_last_seen(u.id) IS NOT NULL ORDER BY app.user_last_seen(u.id) DESC LIMIT 8`;
  const rechte = await tx`
    SELECT a.id, a.entity, a.action, a.recorded_at, a.data, u.name AS von, p.name AS projekt FROM audit_log a
    JOIN app_user u ON u.id = a.actor_id LEFT JOIN project p ON p.id = a.project_id
    WHERE a.tenant_id = app.user_tenant() AND (a.entity IN ('app_user', 'project_member', 'einladung', 'einstellungen', 'zugang') OR a.action ILIKE '%recht%' OR a.action ILIKE '%rolle%')
    ORDER BY a.recorded_at DESC LIMIT 8`;
  const [db] = await tx`SELECT pg_database_size(current_database())::bigint AS bytes`.catch(() => [{ bytes: null }] as never);
  return { zahlen: z, anmeldungen, rechte, speicher: await speicher(), datenbank_bytes: db?.bytes ? Number(db.bytes) : null };
}

const ProtokollQuery = z.object({
  projekt: z.string().uuid().optional(), bereich: z.string().max(60).optional(), q: z.string().max(100).optional(),
  vor: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(10).max(500).default(100),
});

/** Audit log of the whole company, newest first, paged by id (efficient on large logs). */
export async function protokoll(tx: TxSql, query: unknown) {
  await requireAdmin(tx);
  const q = ProtokollQuery.parse(query);
  const rows = await tx`
    SELECT a.id, a.entity, a.entity_id, a.action, a.occurred_at, a.recorded_at, a.device_id, a.data, u.name AS von, p.name AS projekt
    FROM audit_log a JOIN app_user u ON u.id = a.actor_id LEFT JOIN project p ON p.id = a.project_id
    WHERE a.tenant_id = app.user_tenant()
      ${q.projekt ? tx`AND a.project_id = ${q.projekt}` : tx``}
      ${q.bereich ? tx`AND a.entity = ${q.bereich}` : tx``}
      ${q.q ? tx`AND (a.action ILIKE ${'%' + q.q + '%'} OR u.name ILIKE ${'%' + q.q + '%'} OR a.data::text ILIKE ${'%' + q.q + '%'})` : tx``}
      ${q.vor ? tx`AND a.id < ${q.vor}` : tx``}
    ORDER BY a.id DESC LIMIT ${q.limit}`;
  const bereiche = await tx`SELECT DISTINCT entity FROM audit_log WHERE tenant_id = app.user_tenant() ORDER BY entity`;
  return { eintraege: rows, bereiche: bereiche.map((b) => b.entity as string), weiter: rows.length === q.limit ? Number(rows[rows.length - 1]!.id) : null };
}
