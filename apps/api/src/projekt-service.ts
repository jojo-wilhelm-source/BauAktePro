/**
 * Projects and structure (docs/fachkonzept/01, 02): create a project, take over the structure of an earlier
 * project and change it afterwards. Rights: Bau-/Projektleitung (RLS + checks here); everything goes to the
 * audit log, team changes (rights) included.
 *
 * Taking over a structure merges by name/path, so it can also be applied to an existing project later
 * ("Struktur übernehmen") without creating duplicates. Never copied: Mängel, Pläne, Dokumente, Verträge,
 * Preise, Zugänge of other companies.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

async function audit(tx: TxSql, userId: string, projectId: string, entity: string, id: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, ${entity}, ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

async function requireLeitung(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Die Projektstruktur ändern Bau- und Projektleitung');
  return a;
}

export const TEILE = ['orte', 'gewerke', 'ordner', 'nachunternehmer', 'team'] as const;
export type Teil = (typeof TEILE)[number];
export const TEIL_LABELS: Record<Teil, string> = {
  orte: 'Orte (Gebäude, Geschosse, Räume)',
  gewerke: 'Gewerke',
  ordner: 'Ordnerstruktur der Dateiablage',
  nachunternehmer: 'Nachunternehmer mit Gewerken',
  team: 'Eigenes Team (Polier, Einkauf …)',
};

/** May the user create projects at all? (shown as "Neues Projekt" in the web app) */
export async function canCreateProject(tx: TxSql) {
  const [r] = await tx`SELECT app.is_leitung_any() AND app.is_own_staff() AS ok`;
  return !!r?.ok;
}

const CreateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name fehlt').max(200),
  address: z.string().trim().max(300).nullish(),
  vorlage_id: z.string().uuid().nullish(),
  teile: z.array(z.enum(TEILE)).default([]),
});

export async function createProject(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = CreateInput.parse(input);
  const [exists] = await tx`SELECT id FROM project WHERE id = ${d.id}`;
  if (exists) return { id: d.id, uebernommen: null };
  if (!(await canCreateProject(tx))) throw new HttpError(403, 'Projekte legen Bau- und Projektleitung an');
  if (d.vorlage_id) await actorFor(tx, userId, d.vorlage_id); // the template must be one of his projects
  await tx`SELECT app.create_project(${d.id}, ${d.name}, ${d.address ?? null})`;
  await audit(tx, userId, d.id, 'project', d.id, 'angelegt', meta, { name: d.name, vorlage: d.vorlage_id ?? null, teile: d.teile });
  const uebernommen = d.vorlage_id && d.teile.length ? await copyStructure(tx, userId, d.vorlage_id, d.id, d.teile, meta) : null;
  return { id: d.id, uebernommen };
}

const CopyInput = z.object({ from: z.string().uuid(), teile: z.array(z.enum(TEILE)).min(1, 'Bitte auswählen, was übernommen werden soll') });

export async function takeOverStructure(tx: TxSql, userId: string, projectId: string, input: unknown, meta: WriteMeta) {
  const d = CopyInput.parse(input);
  if (d.from === projectId) throw new HttpError(422, 'Bitte ein anderes Projekt wählen');
  return copyStructure(tx, userId, d.from, projectId, d.teile, meta);
}

type Loc = { id: string; parent_id: string | null; kind: string; name: string; sort: number };
const norm = (s: string) => s.trim().toLowerCase();

/** Merge the chosen parts of `from` into `to`. Returns what was added. */
export async function copyStructure(tx: TxSql, userId: string, from: string, to: string, teile: Teil[], meta: WriteMeta) {
  await actorFor(tx, userId, from);
  await requireLeitung(tx, userId, to);
  const added = { orte: 0, gewerke: 0, ordner: 0, nachunternehmer: 0, team: 0 };

  // --- Orte by path ("Haus A/EG/Bad") ----------------------------------------------------------
  const locMap = new Map<string, string>(); // source id → target id
  const srcLocs = (await tx`SELECT id, parent_id, kind, name, sort FROM location WHERE project_id = ${from}`) as unknown as Loc[];
  const tgtLocs = (await tx`SELECT id, parent_id, kind, name, sort FROM location WHERE project_id = ${to}`) as unknown as Loc[];
  const pathOf = (list: Loc[]) => {
    const byId = new Map(list.map((l) => [l.id, l]));
    const p = (l: Loc): string => (l.parent_id && byId.get(l.parent_id) ? `${p(byId.get(l.parent_id)!)}/` : '') + norm(l.name);
    return p;
  };
  const tgtPath = pathOf(tgtLocs);
  const tgtByPath = new Map(tgtLocs.map((l) => [tgtPath(l), l.id]));
  const srcPath = pathOf(srcLocs);
  for (const l of srcLocs) {
    const t = tgtByPath.get(srcPath(l));
    if (t) locMap.set(l.id, t);
  }
  if (teile.includes('orte')) {
    // Parents before children.
    const depth = (l: Loc) => srcPath(l).split('/').length;
    for (const l of [...srcLocs].sort((a, b) => depth(a) - depth(b))) {
      if (locMap.has(l.id)) continue;
      const id = randomUUID();
      await tx`INSERT INTO location (id, project_id, parent_id, kind, name, sort) VALUES (${id}, ${to}, ${l.parent_id ? locMap.get(l.parent_id) ?? null : null}, ${l.kind}, ${l.name}, ${l.sort})`;
      locMap.set(l.id, id);
      added.orte++;
    }
  }

  // --- Gewerke by name -------------------------------------------------------------------------
  const gwMap = new Map<string, string>();
  const srcGw = await tx`SELECT id, name FROM gewerk WHERE project_id = ${from}`;
  const tgtGw = new Map((await tx`SELECT id, name FROM gewerk WHERE project_id = ${to}`).map((g) => [norm(g.name as string), g.id as string]));
  for (const g of srcGw) {
    const t = tgtGw.get(norm(g.name as string));
    if (t) gwMap.set(g.id as string, t);
    else if (teile.includes('gewerke')) {
      const id = randomUUID();
      await tx`INSERT INTO gewerk (id, project_id, name) VALUES (${id}, ${to}, ${g.name})`;
      gwMap.set(g.id as string, id);
      tgtGw.set(norm(g.name as string), id);
      added.gewerke++;
    }
  }

  // --- Ordner by path ----------------------------------------------------------------------------
  if (teile.includes('ordner')) {
    type F = { id: string; parent_id: string | null; name: string; sort: number; kind: string; location_id: string | null; visible_to_nu: boolean; visible_to_bauherr: boolean };
    const src = (await tx`SELECT id, parent_id, name, sort, kind, location_id, visible_to_nu, visible_to_bauherr FROM folder WHERE project_id = ${from}`) as unknown as F[];
    const tgt = (await tx`SELECT id, parent_id, name, sort, kind, location_id, visible_to_nu, visible_to_bauherr FROM folder WHERE project_id = ${to}`) as unknown as F[];
    const fPath = (list: F[]) => {
      const byId = new Map(list.map((f) => [f.id, f]));
      const p = (f: F): string => (f.parent_id && byId.get(f.parent_id) ? `${p(byId.get(f.parent_id)!)}/` : '') + norm(f.name);
      return p;
    };
    const sp = fPath(src);
    const tp = fPath(tgt);
    const tByPath = new Map(tgt.map((f) => [tp(f), f.id]));
    const fMap = new Map<string, string>();
    for (const f of [...src].sort((a, b) => sp(a).split('/').length - sp(b).split('/').length)) {
      const existing = tByPath.get(sp(f));
      if (existing) {
        fMap.set(f.id, existing);
        continue;
      }
      const id = randomUUID();
      await tx`INSERT INTO folder ${tx({
        id, project_id: to, parent_id: f.parent_id ? fMap.get(f.parent_id) ?? null : null, name: f.name, sort: f.sort, kind: f.kind,
        location_id: f.location_id ? locMap.get(f.location_id) ?? null : null, visible_to_nu: f.visible_to_nu, visible_to_bauherr: f.visible_to_bauherr,
      } as never)}`;
      fMap.set(f.id, id);
      added.ordner++;
    }
  }

  // --- Nachunternehmer with their Gewerke (no accesses, no contracts, no prices) -------------------
  if (teile.includes('nachunternehmer')) {
    const nus = await tx`
      SELECT DISTINCT c.id FROM company c WHERE c.kind = 'nu' AND (
        EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = ${from})
        OR EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = c.id AND pm.project_id = ${from}))`;
    for (const n of nus) {
      const r = await tx`INSERT INTO project_company (project_id, company_id) VALUES (${to}, ${n.id}) ON CONFLICT (project_id, company_id) DO NOTHING RETURNING id`;
      if (r.length) added.nachunternehmer++;
    }
    const assign = await tx`
      SELECT gc.gewerk_id, gc.company_id FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id JOIN company c ON c.id = gc.company_id
      WHERE g.project_id = ${from} AND c.kind = 'nu'`;
    for (const a of assign) {
      const g = gwMap.get(a.gewerk_id as string);
      if (g) await tx`INSERT INTO gewerk_company (gewerk_id, company_id) VALUES (${g}, ${a.company_id}) ON CONFLICT (gewerk_id, company_id) DO NOTHING`;
    }
  }

  // --- Own team (same roles); rights changes are audited one by one -----------------------------
  if (teile.includes('team')) {
    const team = await tx`
      SELECT pm.user_id, pm.company_id, pm.role, u.name FROM project_member pm JOIN company c ON c.id = pm.company_id JOIN app_user u ON u.id = pm.user_id
      WHERE pm.project_id = ${from} AND c.kind = 'own' AND pm.user_id <> ${userId}`;
    for (const t of team) {
      const r = await tx`
        INSERT INTO project_member (project_id, user_id, company_id, role) VALUES (${to}, ${t.user_id}, ${t.company_id}, ${t.role})
        ON CONFLICT (project_id, user_id) DO NOTHING RETURNING id`;
      if (r.length) {
        added.team++;
        await audit(tx, userId, to, 'project_member', r[0]!.id as string, 'mitglied_hinzugefuegt', meta, { user: t.user_id, name: t.name, role: t.role, aus_projekt: from });
      }
    }
  }

  await audit(tx, userId, to, 'project', to, 'struktur_uebernommen', meta, { from, teile, added });
  return added;
}

// --- Editing ---------------------------------------------------------------------------------------

const KINDS = ['gebaeude', 'geschoss', 'abschnitt', 'raum'] as const;
export const LocationInput = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  parent_id: z.string().uuid().nullish(),
  kind: z.enum(KINDS),
  name: z.string().trim().min(1, 'Name fehlt').max(120),
});

export async function addLocation(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = LocationInput.parse(input);
  await requireLeitung(tx, userId, d.project_id);
  if (d.parent_id) {
    const [p] = await tx`SELECT kind FROM location WHERE id = ${d.parent_id} AND project_id = ${d.project_id}`;
    if (!p) throw new HttpError(404, 'Übergeordneter Ort nicht gefunden');
    if (KINDS.indexOf(d.kind) <= KINDS.indexOf(p.kind as (typeof KINDS)[number])) throw new HttpError(422, 'Ein Unterort muss feiner sein (z. B. Geschoss unter Gebäude, Raum unter Geschoss)');
  }
  const [{ n }] = (await tx`SELECT coalesce(max(sort), 0) + 1 AS n FROM location WHERE project_id = ${d.project_id} AND parent_id IS NOT DISTINCT FROM ${d.parent_id ?? null}`) as unknown as [{ n: number }];
  const [row] = await tx`INSERT INTO location (id, project_id, parent_id, kind, name, sort) VALUES (${d.id}, ${d.project_id}, ${d.parent_id ?? null}, ${d.kind}, ${d.name}, ${n}) RETURNING *`;
  await audit(tx, userId, d.project_id, 'location', d.id, 'angelegt', meta, { name: d.name, kind: d.kind });
  return row;
}

export async function renameLocation(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const { name, sort } = z.object({ name: z.string().trim().min(1).max(120).optional(), sort: z.number().int().optional() }).parse(input);
  const [l] = await tx`SELECT * FROM location WHERE id = ${id}`;
  if (!l) throw new HttpError(404, 'Ort nicht gefunden');
  await requireLeitung(tx, userId, l.project_id as string);
  const [row] = await tx`UPDATE location SET name = ${name ?? l.name}, sort = ${sort ?? l.sort} WHERE id = ${id} RETURNING *`;
  await audit(tx, userId, l.project_id as string, 'location', id, 'geaendert', meta, { from: l.name, name, sort });
  return row;
}

/** Deleting runs in a savepoint: a foreign key (Mängel, Pläne, Unterorte …) turns into a clear message. */
async function deleteGuarded(tx: TxSql, what: string, fn: (sp: TxSql) => Promise<unknown>) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp as unknown as TxSql);
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23503') throw new HttpError(409, `${what} wird noch verwendet (z. B. von Mängeln, Plänen oder Unterorten) und kann nicht gelöscht werden`);
    throw e;
  }
}

export async function deleteLocation(tx: TxSql, userId: string, id: string, meta: WriteMeta) {
  const [l] = await tx`SELECT * FROM location WHERE id = ${id}`;
  if (!l) throw new HttpError(404, 'Ort nicht gefunden');
  await requireLeitung(tx, userId, l.project_id as string);
  await deleteGuarded(tx, `„${l.name as string}“`, (sp) => sp`DELETE FROM location WHERE id = ${id}`);
  await audit(tx, userId, l.project_id as string, 'location', id, 'geloescht', meta, { name: l.name });
}

export async function addGewerk(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = z.object({ id: z.string().uuid(), project_id: z.string().uuid(), name: z.string().trim().min(1).max(80) }).parse(input);
  await requireLeitung(tx, userId, d.project_id);
  const [dup] = await tx`SELECT id FROM gewerk WHERE project_id = ${d.project_id} AND lower(name) = lower(${d.name})`;
  if (dup) throw new HttpError(409, `Gewerk „${d.name}“ gibt es schon`);
  const [row] = await tx`INSERT INTO gewerk (id, project_id, name) VALUES (${d.id}, ${d.project_id}, ${d.name}) RETURNING id, name`;
  await audit(tx, userId, d.project_id, 'gewerk', d.id, 'angelegt', meta, { name: d.name });
  return row;
}

export async function renameGewerk(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(input);
  const [g] = await tx`SELECT * FROM gewerk WHERE id = ${id}`;
  if (!g) throw new HttpError(404, 'Gewerk nicht gefunden');
  await requireLeitung(tx, userId, g.project_id as string);
  const [row] = await tx`UPDATE gewerk SET name = ${name} WHERE id = ${id} RETURNING id, name`;
  await audit(tx, userId, g.project_id as string, 'gewerk', id, 'geaendert', meta, { from: g.name, name });
  return row;
}

export async function deleteGewerk(tx: TxSql, userId: string, id: string, meta: WriteMeta) {
  const [g] = await tx`SELECT * FROM gewerk WHERE id = ${id}`;
  if (!g) throw new HttpError(404, 'Gewerk nicht gefunden');
  await requireLeitung(tx, userId, g.project_id as string);
  await deleteGuarded(tx, `Gewerk „${g.name as string}“`, async (sp) => {
    // Pure assignments to firms go with the Gewerk; Mängel, Verträge, Einkäufe … keep it alive.
    await sp`DELETE FROM gewerk_company WHERE gewerk_id = ${id}`;
    await sp`DELETE FROM gewerk WHERE id = ${id}`;
  });
  await audit(tx, userId, g.project_id as string, 'gewerk', id, 'geloescht', meta, { name: g.name });
}

export async function renameProject(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = z.object({ name: z.string().trim().min(1).max(200), address: z.string().trim().max(300).nullish() }).parse(input);
  await requireLeitung(tx, userId, id);
  const [p] = await tx`SELECT name, address FROM project WHERE id = ${id}`;
  await tx`UPDATE project SET name = ${d.name}, address = ${d.address ?? null} WHERE id = ${id}`;
  await audit(tx, userId, id, 'project', id, 'geaendert', meta, { from: p, ...d });
  return { ok: true };
}

/** Structure overview for the "Projekt & Struktur" page, incl. how often each Ort/Gewerk is used. */
export async function structure(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  const [project] = await tx`SELECT id, name, address, created_at FROM project WHERE id = ${projectId}`;
  const locations = await tx`
    SELECT l.id, l.parent_id, l.kind, l.name, l.sort,
      (SELECT count(*)::int FROM mangel m WHERE m.location_id = l.id AND m.deleted_at IS NULL) AS maengel,
      (SELECT count(*)::int FROM plan p WHERE p.location_id = l.id) AS plaene
    FROM location l WHERE l.project_id = ${projectId} ORDER BY l.sort, l.name`;
  const gewerke = await tx`
    SELECT g.id, g.name,
      (SELECT count(*)::int FROM mangel m WHERE m.gewerk_id = g.id AND m.deleted_at IS NULL) AS maengel,
      coalesce((SELECT array_agg(c.name ORDER BY c.name) FROM gewerk_company gc JOIN company c ON c.id = gc.company_id WHERE gc.gewerk_id = g.id AND c.kind = 'nu'), '{}') AS firmen
    FROM gewerk g WHERE g.project_id = ${projectId} ORDER BY g.name`;
  const team = await tx`
    SELECT pm.id, u.name, u.email, pm.role, c.name AS company, c.kind AS company_kind FROM project_member pm
    JOIN app_user u ON u.id = pm.user_id JOIN company c ON c.id = pm.company_id
    WHERE pm.project_id = ${projectId} ORDER BY c.kind = 'own' DESC, u.name`;
  return { project, role: a.role, locations, gewerke, team, teile: TEIL_LABELS };
}

// --- Nachunternehmer from other projects ------------------------------------------------------------

/** NU firms of the own company's other projects (visible to the user) that are not yet in this project. */
export async function nuKandidaten(tx: TxSql, userId: string, projectId: string) {
  await requireLeitung(tx, userId, projectId);
  return tx`
    SELECT c.id, c.name, c.contact_person, c.email,
      coalesce((SELECT array_agg(DISTINCT p.name) FROM project p
                WHERE p.id <> ${projectId} AND (EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = p.id)
                                             OR EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = c.id AND pm.project_id = p.id))), '{}') AS projekte,
      coalesce((SELECT array_agg(DISTINCT g.name) FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE gc.company_id = c.id), '{}') AS gewerke
    FROM company c
    WHERE c.kind = 'nu' AND c.tenant_id = app.user_tenant()
      AND NOT EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = ${projectId})
      AND NOT EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = c.id AND pm.project_id = ${projectId})
    ORDER BY c.name`; // RLS on company: only firms of projects the user belongs to
}

/** Adds existing NU firms to the project; Gewerke are matched by name (e.g. "Elektro" → "Elektro"). */
export async function nuUebernehmen(tx: TxSql, userId: string, projectId: string, input: unknown, meta: WriteMeta) {
  const { company_ids } = z.object({ company_ids: z.array(z.string().uuid()).min(1) }).parse(input);
  await requireLeitung(tx, userId, projectId);
  const gw = new Map((await tx`SELECT id, name FROM gewerk WHERE project_id = ${projectId}`).map((g) => [norm(g.name as string), g.id as string]));
  let n = 0;
  for (const cid of company_ids) {
    const [c] = await tx`SELECT id, name FROM company WHERE id = ${cid} AND kind = 'nu'`; // RLS
    if (!c) throw new HttpError(404, 'Nachunternehmer nicht gefunden');
    const r = await tx`INSERT INTO project_company (project_id, company_id) VALUES (${projectId}, ${cid}) ON CONFLICT (project_id, company_id) DO NOTHING RETURNING id`;
    if (r.length) n++;
    const names = await tx`SELECT DISTINCT g.name FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE gc.company_id = ${cid}`;
    for (const g of names) {
      const t = gw.get(norm(g.name as string));
      if (t) await tx`INSERT INTO gewerk_company (gewerk_id, company_id) VALUES (${t}, ${cid}) ON CONFLICT (gewerk_id, company_id) DO NOTHING`;
    }
    await audit(tx, userId, projectId, 'company', cid, 'nu_uebernommen', meta, { name: c.name });
  }
  return { added: n };
}
