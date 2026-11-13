/**
 * Nachunternehmer-Verzeichnis, Baustellen-Einkäufe, Fahrtenbuch und Kostenübersicht
 * (docs/fachkonzept/11, 14). Visibility via RLS; the API adds role checks and never returns prices to non-Leitung.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { EinkaufInput, FahrtInput, kmWarnung, kostenPrognose, nettoAusBrutto, TankenInput, tankenPflicht, verbrauch, verbrauchProStunde, type FahrzeugArt } from '@bap/domain';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const BELEG_DIR = fileURLToPath(new URL('../../../storage/belege/', import.meta.url));

async function audit(tx: TxSql, userId: string, projectId: string | null, entity: string, id: string, action: string, meta: WriteMeta, data: object) {
  if (!projectId) return; // company-level entries (Fahrtenbuch) carry no project; their rows are append-only anyway
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, ${entity}, ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

// --- Nachunternehmer -------------------------------------------------------------------

export async function listNu(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  if (actor.role === 'bauherr' || actor.role === 'einkauf') throw new HttpError(403, 'Kein Zugriff auf das NU-Verzeichnis');
  const leitung = actor.role === 'bauleitung';
  const rows = await tx`
    SELECT c.id, c.name, c.email, c.phone, c.contact_person, c.address,
      coalesce((SELECT array_agg(g.name ORDER BY g.name) FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE gc.company_id = c.id AND g.project_id = ${projectId}), '{}') AS gewerke,
      coalesce((SELECT array_agg(g.id) FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE gc.company_id = c.id AND g.project_id = ${projectId}), '{}') AS gewerk_ids,
      (SELECT count(*)::int FROM project_member pm WHERE pm.company_id = c.id AND pm.project_id = ${projectId}) AS zugaenge,
      (SELECT count(*)::int FROM mangel m WHERE m.assigned_company_id = c.id AND m.project_id = ${projectId} AND m.status <> 'abgenommen' AND m.deleted_at IS NULL) AS maengel_offen,
      (SELECT count(*)::int FROM mangel m WHERE m.assigned_company_id = c.id AND m.project_id = ${projectId} AND m.status <> 'abgenommen' AND m.deleted_at IS NULL
         AND coalesce(m.nachfrist_date, m.due_date) < current_date) AS maengel_ueberfaellig,
      (SELECT coalesce(sum(hours_approved), 0)::float FROM stundenzettel z WHERE z.company_id = c.id AND z.project_id = ${projectId}) AS stunden_anerkannt,
      (SELECT count(*)::int FROM besprechung_punkt p WHERE p.project_id = ${projectId} AND p.responsible_company_id = c.id AND p.status <> 'erledigt') AS punkte_offen
    FROM company c
    WHERE c.kind = 'nu' AND (EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = ${projectId})
                             OR EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = c.id AND pm.project_id = ${projectId}))
      ${actor.role === 'nu' ? tx`AND c.id = ${actor.companyId}` : tx``}
    ORDER BY c.name`;
  // Prices (contracts, Nachträge, Rechnungen) only for the Leitung.
  const vertraege = leitung ? await tx`SELECT v.*, v.amount_net::float AS amount, g.name AS gewerk_name FROM vertrag v LEFT JOIN gewerk g ON g.id = v.gewerk_id WHERE v.project_id = ${projectId} ORDER BY v.signed_on` : [];
  const geld = leitung
    ? await tx`SELECT company_id, kind, status, sum(amount_net)::float AS s FROM einreichung WHERE project_id = ${projectId} GROUP BY company_id, kind, status`
    : [];
  return {
    role: actor.role,
    nu: rows.map((c) => {
      const sumOf = (kind: string, statuses: string[]) => geld.filter((g) => g.company_id === c.id && g.kind === kind && statuses.includes(g.status as string)).reduce((s, g) => s + num(g.s), 0);
      return {
        ...c,
        vertraege: vertraege.filter((v) => v.company_id === c.id),
        auftrag: leitung ? vertraege.filter((v) => v.company_id === c.id).reduce((s, v) => s + num(v.amount), 0) : null,
        nachtraege_beauftragt: leitung ? sumOf('nachtrag', ['freigegeben']) : null,
        nachtraege_offen: leitung ? sumOf('nachtrag', ['eingereicht', 'in_pruefung', 'gf_erforderlich']) : null,
        abgerechnet: leitung ? sumOf('rechnung', ['freigegeben']) : null,
      };
    }),
  };
}

export const NuInput = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  email: z.string().email().nullish().or(z.literal('')),
  phone: z.string().max(60).nullish(),
  contact_person: z.string().max(120).nullish(),
  address: z.string().max(300).nullish(),
  gewerk_ids: z.array(z.string().uuid()).default([]),
});

/** Leitung adds a NU to the project (no login needed; access can be granted later). */
export async function saveNu(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = NuInput.parse(input);
  const actor = await actorFor(tx, userId, d.project_id);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Nachunternehmer pflegen Bau- und Projektleitung');
  const fields = { name: d.name, email: d.email || null, phone: d.phone || null, contact_person: d.contact_person || null, address: d.address || null };
  const [existing] = await tx`SELECT id FROM company WHERE id = ${d.id}`;
  if (existing) {
    await tx`UPDATE company SET ${tx(fields as never)} WHERE id = ${d.id} AND kind = 'nu'`;
  } else {
    // No RETURNING: the new company is only visible once it is linked to the project.
    await tx`INSERT INTO company ${tx({ id: d.id, tenant_id: (await tx`SELECT tenant_id FROM project WHERE id = ${d.project_id}`)[0]!.tenant_id, kind: 'nu', ...fields } as never)}`;
    await tx`INSERT INTO project_company (project_id, company_id) VALUES (${d.project_id}, ${d.id})`;
  }
  const known = (await tx`SELECT gc.gewerk_id FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE gc.company_id = ${d.id} AND g.project_id = ${d.project_id}`).map((r) => r.gewerk_id as string);
  for (const g of d.gewerk_ids.filter((x) => !known.includes(x))) await tx`INSERT INTO gewerk_company (gewerk_id, company_id) VALUES (${g}, ${d.id})`;
  await audit(tx, userId, d.project_id, 'nachunternehmer', d.id, existing ? 'geaendert' : 'angelegt', meta, { name: d.name });
  return { id: d.id };
}

export async function addVertrag(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = z.object({
    project_id: z.string().uuid(), company_id: z.string().uuid(), gewerk_id: z.string().uuid().nullish(),
    title: z.string().trim().min(1).max(300), amount_net: z.coerce.number().min(0), signed_on: z.string().date().nullish(),
  }).parse(input);
  const actor = await actorFor(tx, userId, d.project_id);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Verträge erfassen Bau- und Projektleitung');
  const [row] = await tx`INSERT INTO vertrag ${tx({ ...d, gewerk_id: d.gewerk_id ?? null, signed_on: d.signed_on ?? null, created_by: userId } as never)} RETURNING id`;
  await audit(tx, userId, d.project_id, 'vertrag', row!.id as string, 'angelegt', meta, { company: d.company_id, amount_net: d.amount_net });
  return row;
}

// --- Baustellen-Einkäufe -------------------------------------------------------------------

export async function listEinkaeufe(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  if (actor.role === 'nu' || actor.role === 'bauherr') throw new HttpError(403, 'Kein Zugriff auf Einkäufe');
  const rows = await tx`
    SELECT e.id, e.number, e.gekauft_von, e.datum, e.haendler, e.betrag_brutto::float AS brutto, e.mwst_satz::float AS mwst, e.gewerk_id, g.name AS gewerk_name,
           e.zweck, e.zahlungsart, e.beleg_key IS NOT NULL AS has_beleg, e.status, e.erstattet, e.decision_reason, e.decided_at, d.name AS decided_by_name,
           u.name AS created_by_name, e.created_by, e.version
    FROM einkauf e LEFT JOIN gewerk g ON g.id = e.gewerk_id JOIN app_user u ON u.id = e.created_by LEFT JOIN app_user d ON d.id = e.decided_by
    WHERE e.project_id = ${projectId} ORDER BY e.datum DESC, e.number DESC NULLS FIRST`;
  return { role: actor.role, einkaeufe: rows.map((r) => ({ ...r, netto: nettoAusBrutto(num(r.brutto), num(r.mwst)) })) };
}

/** Record a purchase (web or offline from the phone). Idempotent on the device id. */
export async function createEinkauf(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = EinkaufInput.parse(input);
  const actor = await actorFor(tx, userId, d.project_id);
  if (actor.role === 'nu' || actor.role === 'bauherr') throw new HttpError(403, 'Einkäufe erfassen die eigenen Leute');
  const [existing] = await tx`SELECT * FROM einkauf WHERE id = ${d.id}`;
  if (existing) return existing;
  const [{ n }] = (await tx`SELECT app.next_counter(${d.project_id}, 'einkauf') AS n`) as unknown as [{ n: number }];
  const [row] = await tx`INSERT INTO einkauf ${tx({ ...d, gewerk_id: d.gewerk_id ?? null, number: n, created_by: userId, created_at: meta.occurredAt } as never)} RETURNING *`;
  await audit(tx, userId, d.project_id, 'einkauf', d.id, 'erfasst', meta, { brutto: d.betrag_brutto, haendler: d.haendler });
  return row!;
}

export async function decideEinkauf(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = z.object({ decision: z.enum(['freigeben', 'ablehnen', 'zuruecknehmen', 'erstattet']), reason: z.string().max(1000).optional(), base_version: z.number().int() }).parse(input);
  const [e] = await tx`SELECT * FROM einkauf WHERE id = ${id}`;
  if (!e) throw new HttpError(404, 'Einkauf nicht gefunden');
  const actor = await actorFor(tx, userId, e.project_id as string);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Einkäufe geben Bau- und Projektleitung frei');
  if (e.version !== d.base_version) throw new HttpError(409, 'Der Einkauf wurde inzwischen geändert');
  let set: Record<string, unknown>;
  if (d.decision === 'erstattet') {
    if (e.status !== 'freigegeben' || e.zahlungsart !== 'privat') throw new HttpError(409, 'Nur freigegebene, privat ausgelegte Beträge werden erstattet');
    set = { erstattet: !e.erstattet };
  } else if (d.decision === 'zuruecknehmen') {
    if (e.status === 'eingereicht') throw new HttpError(409, 'Es gibt keine Entscheidung zum Zurücknehmen');
    if (e.erstattet) throw new HttpError(409, 'Bereits zur Erstattung übergeben – zuerst „erstattet“ zurücksetzen');
    set = { status: 'eingereicht', decided_by: null, decided_at: null, decision_reason: null };
  } else {
    if (e.status !== 'eingereicht') throw new HttpError(409, 'Bereits entschieden – zuerst die Entscheidung zurücknehmen');
    if (d.decision === 'ablehnen' && !d.reason?.trim()) throw new HttpError(422, 'Bitte einen Grund angeben');
    set = { status: d.decision === 'freigeben' ? 'freigegeben' : 'abgelehnt', decided_by: userId, decided_at: new Date(), decision_reason: d.reason ?? null };
  }
  const [row] = await tx`UPDATE einkauf SET ${tx(set as never)}, version = version + 1 WHERE id = ${id} AND version = ${d.base_version} RETURNING *`;
  if (!row) throw new HttpError(409, 'Gleichzeitige Änderung');
  await audit(tx, userId, e.project_id as string, 'einkauf', id, d.decision, meta, { reason: d.reason ?? null, ...set });
  return row;
}

async function storeBeleg(id: string, file: { bytes: Buffer; name: string }) {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'pdf'].includes(ext)) throw new HttpError(422, 'Beleg: Foto oder PDF');
  await mkdir(BELEG_DIR, { recursive: true });
  const key = `${id}.${ext}`;
  await writeFile(BELEG_DIR + key, file.bytes);
  return key;
}
export async function attachBeleg(tx: TxSql, kind: 'einkauf' | 'tankvorgang', id: string, file: { bytes: Buffer; name: string }) {
  const [row] = kind === 'einkauf' ? await tx`SELECT id FROM einkauf WHERE id = ${id}` : await tx`SELECT id FROM tankvorgang WHERE id = ${id}`; // RLS
  if (!row) throw new HttpError(404, 'Eintrag nicht gefunden');
  const key = await storeBeleg(`${kind}-${id}`, file);
  const upd = kind === 'einkauf' ? await tx`UPDATE einkauf SET beleg_key = ${key} WHERE id = ${id} RETURNING id` : await tx`UPDATE tankvorgang SET beleg_key = ${key} WHERE id = ${id} RETURNING id`;
  if (!upd.length) throw new HttpError(409, 'Beleg kann nicht mehr geändert werden');
  return { ok: true };
}
export async function belegFile(tx: TxSql, kind: 'einkauf' | 'tankvorgang', id: string) {
  const [row] = kind === 'einkauf' ? await tx`SELECT beleg_key FROM einkauf WHERE id = ${id}` : await tx`SELECT beleg_key FROM tankvorgang WHERE id = ${id}`;
  if (!row?.beleg_key) throw new HttpError(404, 'Kein Beleg');
  const key = (row.beleg_key as string).replace(/[^a-z0-9._-]/gi, '');
  return { pfad: BELEG_DIR + key, type: key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

// --- Fahrtenbuch -------------------------------------------------------------------------

export async function fahrtenbuch(tx: TxSql, userId: string) {
  const [me] = await tx`SELECT u.id, c.kind FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = ${userId}`;
  if (me?.kind !== 'own') throw new HttpError(403, 'Das Fahrtenbuch gehört zur eigenen Firma');
  if (!(await tx`SELECT app.has_fahrtenbuch() AS ok`)[0]?.ok) throw new HttpError(403, 'Das Fahrtenbuch ist für Sie nicht freigeschaltet (Administrator)');
  const [{ leitung }] = (await tx`SELECT app.is_leitung_any() AS leitung`) as unknown as [{ leitung: boolean }];
  const fahrzeuge = await tx`
    SELECT f.*, u.name AS fahrer_name, app.fahrzeug_last_km(f.id) AS last_km, app.maschine_last_bh(f.id)::float AS last_bh,
      CASE WHEN f.art = 'tankstelle' THEN app.tankstelle_bestand(f.id)::float END AS bestand
    FROM fahrzeug f LEFT JOIN app_user u ON u.id = f.fahrer_id
    WHERE f.aktiv ORDER BY f.art, f.bezeichnung`;
  const fahrten = await tx`
    SELECT t.*, u.name AS fahrer_name, p.name AS project_name, (t.km_ende - t.km_start) AS km
    FROM fahrt t JOIN app_user u ON u.id = t.fahrer_id LEFT JOIN project p ON p.id = t.project_id ORDER BY t.datum DESC, t.km_start DESC LIMIT 500`;
  const tanken = await tx`
    SELECT t.*, t.liter::float AS liter_f, t.betrag_brutto::float AS betrag_f, t.betriebsstunden::float AS bh, u.name AS fahrer_name, p.name AS project_name,
      t.beleg_key IS NOT NULL AS has_beleg, q.bezeichnung AS quelle_name
    FROM tankvorgang t JOIN app_user u ON u.id = t.fahrer_id LEFT JOIN project p ON p.id = t.project_id LEFT JOIN fahrzeug q ON q.id = t.quelle_id
    ORDER BY t.fahrzeug_id, coalesce(t.km_stand, 0), coalesce(t.betriebsstunden, 0), t.datum`;
  // Consumption per fill-up (needs the previous fill-up of the same vehicle): l/100 km or l/h for machines.
  const withVerbrauch = tanken.map((t, i) => {
    const prevRow = i > 0 && tanken[i - 1]!.fahrzeug_id === t.fahrzeug_id ? tanken[i - 1]! : undefined;
    if (t.betriebsstunden != null) return { ...t, verbrauch: null, verbrauch_h: verbrauchProStunde(prevRow?.bh as number | undefined, { betriebsstunden: t.bh as number, liter: num(t.liter_f) }) };
    const prev = prevRow?.km_stand != null ? { km_stand: prevRow.km_stand as number } : undefined;
    return { ...t, verbrauch: t.km_stand != null ? verbrauch(prev, { km_stand: t.km_stand as number, liter: num(t.liter_f) }) : null, verbrauch_h: null };
  });
  return { leitung, me: userId, fahrzeuge, fahrten, tanken: withVerbrauch.reverse() };
}

export async function addFahrzeug(tx: TxSql, userId: string, input: unknown) {
  const d = z.object({ kennzeichen: z.string().trim().min(1).max(20), bezeichnung: z.string().trim().min(1).max(100), kraftstoff: z.enum(['diesel', 'benzin', 'elektro', 'hybrid']).default('diesel'),
    fahrer_id: z.string().uuid().nullish(), art: z.enum(['fahrzeug', 'maschine', 'tankstelle']).default('fahrzeug'), kapazitaet_l: z.coerce.number().int().positive().max(100000).nullish() }).parse(input);
  const [{ ok }] = (await tx`SELECT app.is_leitung_any() AS ok`) as unknown as [{ ok: boolean }];
  if (!ok) throw new HttpError(403, 'Fahrzeuge legen Bau- und Projektleitung an');
  const [row] = await tx`INSERT INTO fahrzeug (tenant_id, kennzeichen, bezeichnung, kraftstoff, fahrer_id, art, kapazitaet_l)
    VALUES (app.user_tenant(), ${d.kennzeichen.toUpperCase()}, ${d.bezeichnung}, ${d.kraftstoff}, ${d.fahrer_id ?? null}, ${d.art}, ${d.kapazitaet_l ?? null}) RETURNING *`;
  return row;
}

/** Trip (web or offline). Gaps/rollbacks in the odometer are returned as a warning, never blocked. */
export async function addFahrt(tx: TxSql, userId: string, input: unknown) {
  const d = FahrtInput.parse(input);
  const [existing] = await tx`SELECT * FROM fahrt WHERE id = ${d.id}`;
  if (existing) return { fahrt: existing, warnung: null };
  const [{ last }] = (await tx`SELECT app.fahrzeug_last_km(${d.fahrzeug_id}) AS last`) as unknown as [{ last: number | null }];
  const [row] = await tx`
    INSERT INTO fahrt (id, tenant_id, fahrzeug_id, fahrer_id, datum, km_start, km_ende, project_id, zweck)
    VALUES (${d.id}, app.user_tenant(), ${d.fahrzeug_id}, ${userId}, ${d.datum}, ${d.km_start}, ${d.km_ende}, ${d.project_id ?? null}, ${d.zweck}) RETURNING *`;
  return { fahrt: row, warnung: kmWarnung(last, d.km_start) };
}

export async function addTanken(tx: TxSql, userId: string, input: unknown) {
  const d = TankenInput.parse(input);
  const [existing] = await tx`SELECT * FROM tankvorgang WHERE id = ${d.id}`;
  if (existing) return existing;
  const [fz] = await tx`SELECT art FROM fahrzeug WHERE id = ${d.fahrzeug_id}`;
  if (!fz) throw new HttpError(404, 'Fahrzeug nicht gefunden');
  const fehler = tankenPflicht(fz.art as FahrzeugArt, d);
  if (fehler) throw new HttpError(422, fehler);
  let warnung: string | null = null;
  if (d.quelle_id) {
    const [q] = await tx`SELECT art, app.tankstelle_bestand(id)::float AS bestand FROM fahrzeug WHERE id = ${d.quelle_id}`;
    if (q?.art !== 'tankstelle') throw new HttpError(422, 'Als Quelle bitte eine mobile Tankstelle wählen');
    // Offline entries arrive late: a negative stock is a warning, never a block.
    if ((q.bestand as number) < d.liter) warnung = `Laut Buchungen sind nur ${Math.max(0, q.bestand as number)} l in der Tankstelle`;
  }
  const [row] = await tx`
    INSERT INTO tankvorgang (id, tenant_id, fahrzeug_id, fahrer_id, datum, liter, betrag_brutto, km_stand, betriebsstunden, tankstelle, quelle_id, project_id)
    VALUES (${d.id}, app.user_tenant(), ${d.fahrzeug_id}, ${userId}, ${d.datum}, ${d.liter}, ${d.betrag_brutto ?? null}, ${d.km_stand ?? null},
            ${d.betriebsstunden ?? null}, ${d.tankstelle ?? null}, ${d.quelle_id ?? null}, ${d.project_id ?? null}) RETURNING *`;
  return { ...row, warnung };
}

// --- Kostenübersicht -----------------------------------------------------------------------

/** Per Gewerk: Budget, Auftrag, Nachträge, abgerechnet, Einkäufe, Prognose (docs/fachkonzept/11). Leitung only. */
export async function kosten(tx: TxSql, userId: string, projectId: string) {
  const actor = await actorFor(tx, userId, projectId);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Die Kostenübersicht sehen Bau- und Projektleitung');
  if (!(await tx`SELECT app.has_module(${projectId}, 'kosten') AS ok`)[0]?.ok) throw new HttpError(403, 'Die Kostenübersicht ist für Sie abgeschaltet');
  const gewerke = await tx`SELECT id, name, budget_net::float AS budget FROM gewerk WHERE project_id = ${projectId} ORDER BY name`;
  const gc = await tx`SELECT gc.gewerk_id, gc.company_id FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE g.project_id = ${projectId}`;
  const vertraege = await tx`SELECT company_id, gewerk_id, amount_net::float AS a FROM vertrag WHERE project_id = ${projectId}`;
  const ein = await tx`SELECT company_id, kind, status, amount_net::float AS a FROM einreichung WHERE project_id = ${projectId}`;
  const ek = await tx`SELECT gewerk_id, betrag_brutto::float AS b, mwst_satz::float AS m, status FROM einkauf WHERE project_id = ${projectId} AND status = 'freigegeben'`;
  const regie = await tx`
    SELECT z.company_id, sum(coalesce(l.stunden_anerkannt, l.stunden))::float AS h FROM stundenzettel_zeile l JOIN stundenzettel z ON z.id = l.zettel_id
    WHERE z.project_id = ${projectId} AND l.bezug = 'regie' AND z.status IN ('bestaetigt', 'gekuerzt') GROUP BY z.company_id`;
  // A company's Nachträge/Rechnungen count for the Gewerk of its contract (else its first assigned Gewerk).
  const gewerkOf = (companyId: string) => (vertraege.find((v) => v.company_id === companyId)?.gewerk_id ?? gc.find((x) => x.company_id === companyId)?.gewerk_id) as string | undefined;
  const sum = (rows: readonly Record<string, unknown>[]) => rows.reduce((s, r) => s + num(r.a), 0);
  const zeile = (gewerkId: string | null) => {
    const companies = [...new Set(ein.map((e) => e.company_id as string))].filter((c) => (gewerkOf(c) ?? null) === gewerkId);
    const e = ein.filter((x) => companies.includes(x.company_id as string));
    const z = {
      budget: gewerkId ? (gewerke.find((g) => g.id === gewerkId)?.budget as number | null) ?? null : null,
      auftrag: sum(vertraege.filter((v) => (v.gewerk_id ?? gewerkOf(v.company_id as string) ?? null) === gewerkId)),
      nachtraegeBeauftragt: sum(e.filter((x) => x.kind === 'nachtrag' && x.status === 'freigegeben')),
      nachtraegeOffen: sum(e.filter((x) => x.kind === 'nachtrag' && ['eingereicht', 'in_pruefung', 'gf_erforderlich'].includes(x.status as string))),
      abgerechnet: sum(e.filter((x) => x.kind === 'rechnung' && x.status === 'freigegeben')),
      rechnungenOffen: sum(e.filter((x) => x.kind === 'rechnung' && ['eingereicht', 'in_pruefung'].includes(x.status as string))),
      einkaeufe: ek.filter((x) => (x.gewerk_id ?? null) === gewerkId).reduce((s, x) => s + nettoAusBrutto(num(x.b), num(x.m)), 0),
    };
    const regieH = regie.filter((r) => companies.includes(r.company_id as string) || (gewerkId && gc.some((x) => x.gewerk_id === gewerkId && x.company_id === r.company_id))).reduce((s, r) => s + num(r.h), 0);
    return { ...z, ...kostenPrognose(z), regieStunden: regieH };
  };
  const rows = gewerke.map((g) => ({ gewerk_id: g.id as string, gewerk: g.name as string, ...zeile(g.id as string) }));
  const ohne = zeile(null);
  if (ohne.auftrag || ohne.einkaeufe || ohne.nachtraegeBeauftragt || ohne.abgerechnet) rows.push({ gewerk_id: '', gewerk: 'Ohne Gewerk (Baustelle allgemein)', ...ohne });
  return { rows };
}

export async function setBudget(tx: TxSql, userId: string, gewerkId: string, input: unknown, meta: WriteMeta) {
  const { budget_net } = z.object({ budget_net: z.coerce.number().min(0).nullable() }).parse(input);
  const [g] = await tx`SELECT project_id FROM gewerk WHERE id = ${gewerkId}`;
  if (!g) throw new HttpError(404, 'Gewerk nicht gefunden');
  const actor = await actorFor(tx, userId, g.project_id as string);
  if (actor.role !== 'bauleitung') throw new HttpError(403, 'Budgets pflegen Bau- und Projektleitung');
  await tx`UPDATE gewerk SET budget_net = ${budget_net} WHERE id = ${gewerkId}`;
  await audit(tx, userId, g.project_id as string, 'gewerk', gewerkId, 'budget', meta, { budget_net });
  return { ok: true };
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// --- Corrections afterwards (decided 12.11.2026) ---------------------------------------------------

async function korrekturAudit(tx: TxSql, userId: string, projectId: string | null, entity: string, id: string, from: object, to: object) {
  await tx`INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, occurred_at, data)
           VALUES (app.user_tenant(), ${projectId}, ${entity}, ${id}, 'korrigiert', ${userId}, now(), ${tx.json({ from, to } as never)})`;
}
const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]));

/** Correct an own Einkauf while it is still "eingereicht" (RLS enforces author + status). */
export async function editEinkauf(tx: TxSql, userId: string, id: string, input: unknown) {
  const d = EinkaufInput.omit({ id: true, project_id: true }).partial().parse(input);
  const [cur] = await tx`SELECT * FROM einkauf WHERE id = ${id}`;
  if (!cur) throw new HttpError(404, 'Einkauf nicht gefunden');
  if (cur.created_by !== userId || cur.status !== 'eingereicht') throw new HttpError(409, 'Nur eigene, noch nicht entschiedene Einkäufe lassen sich ändern');
  const patch = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return cur;
  const [row] = await tx`UPDATE einkauf SET ${tx(patch as never)}, version = version + 1 WHERE id = ${id} RETURNING *`;
  if (!row) throw new HttpError(409, 'Nicht mehr änderbar');
  await korrekturAudit(tx, userId, cur.project_id as string, 'einkauf', id, pick(cur, Object.keys(patch)), patch);
  return row;
}

/** Correct a trip (own, or Leitung). */
export async function editFahrt(tx: TxSql, userId: string, id: string, input: unknown) {
  const [cur] = await tx`SELECT * FROM fahrt WHERE id = ${id}`;
  if (!cur) throw new HttpError(404, 'Fahrt nicht gefunden');
  const d = FahrtInput.parse({ ...cur, datum: iso(cur.datum), ...(input as object), id });
  const patch = { datum: d.datum, km_start: d.km_start, km_ende: d.km_ende, zweck: d.zweck, project_id: d.project_id ?? null, fahrzeug_id: d.fahrzeug_id };
  const [row] = await tx`UPDATE fahrt SET ${tx(patch as never)} WHERE id = ${id} RETURNING *`;
  if (!row) throw new HttpError(403, 'Nur eigene Fahrten (oder als Leitung)');
  await korrekturAudit(tx, userId, (cur.project_id as string) ?? null, 'fahrt', id, pick(cur, Object.keys(patch)), patch);
  return row;
}

/** Correct a fill-up (own, or Leitung); the same rules as when entering it. */
export async function editTanken(tx: TxSql, userId: string, id: string, input: unknown) {
  const [cur] = await tx`SELECT * FROM tankvorgang WHERE id = ${id}`;
  if (!cur) throw new HttpError(404, 'Tankvorgang nicht gefunden');
  const d = TankenInput.parse({ ...cur, datum: iso(cur.datum), liter: Number(cur.liter), betrag_brutto: cur.betrag_brutto == null ? null : Number(cur.betrag_brutto),
    betriebsstunden: cur.betriebsstunden == null ? null : Number(cur.betriebsstunden), ...(input as object), id });
  const [fz] = await tx`SELECT art FROM fahrzeug WHERE id = ${d.fahrzeug_id}`;
  const fehler = tankenPflicht((fz?.art ?? 'fahrzeug') as FahrzeugArt, d);
  if (fehler) throw new HttpError(422, fehler);
  const patch = { datum: d.datum, liter: d.liter, betrag_brutto: d.betrag_brutto ?? null, km_stand: d.km_stand ?? null, betriebsstunden: d.betriebsstunden ?? null,
    tankstelle: d.tankstelle ?? null, quelle_id: d.quelle_id ?? null, project_id: d.project_id ?? null };
  const [row] = await tx`UPDATE tankvorgang SET ${tx(patch as never)} WHERE id = ${id} RETURNING *`;
  if (!row) throw new HttpError(403, 'Nur eigene Tankvorgänge (oder als Leitung)');
  await korrekturAudit(tx, userId, (cur.project_id as string) ?? null, 'tankvorgang', id, pick(cur, Object.keys(patch)), patch);
  return row;
}
