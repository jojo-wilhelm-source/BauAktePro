/**
 * Role start pages (decided 13.11.2026: every role gets a page tailored to its work, docs/fachkonzept/15).
 * One request per page with counts and short lists; RLS still decides what each person sees.
 * - Polier: "Heute auf der Baustelle" – today's report, Mängel to check, due Punkte, deliveries, photos.
 */
import type { TxSql } from '@bap/db';
import { escalation, punktNo, type MangelStatus, type Priority } from '@bap/domain';
import { actorFor, HttpError } from './mangel-service';

const iso = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

export async function polierCockpit(t: TxSql, userId: string, projectId: string) {
  const a = await actorFor(t, userId, projectId);
  if (a.role !== 'polier' && a.role !== 'bauleitung') throw new HttpError(403, 'Diese Startseite ist für die Baustelle');

  const [heute] = await t`SELECT id, status, blatt_nr FROM tagesbericht WHERE project_id = ${projectId} AND datum = current_date LIMIT 1`;
  const [berichte] = await t`
    SELECT count(*) FILTER (WHERE status = 'entwurf' AND datum < current_date)::int AS offen_alt,
           max(datum)::text AS letzter
    FROM tagesbericht WHERE project_id = ${projectId}`;

  const maengel = await t`
    SELECT m.id, m.number, m.description, m.status, m.priority, m.due_date, m.nachfrist_date, l.name AS ort, c.name AS firma
    FROM mangel m JOIN location l ON l.id = m.location_id LEFT JOIN company c ON c.id = m.assigned_company_id
    WHERE m.project_id = ${projectId} AND m.deleted_at IS NULL AND m.status <> 'abgenommen'`;
  const mOut = maengel.map((m) => ({
    id: m.id as string, number: m.number as number, description: m.description as string, status: m.status as MangelStatus, ort: m.ort as string, firma: (m.firma as string) ?? null,
    due: iso(m.nachfrist_date ?? m.due_date),
    esc: escalation({ status: m.status as MangelStatus, due_date: iso(m.due_date), nachfrist_date: iso(m.nachfrist_date), priority: m.priority as Priority }),
  }));
  const pruefen = mOut.filter((m) => m.status === 'behoben_gemeldet').sort((x, y) => (x.due ?? '9').localeCompare(y.due ?? '9'));
  const ueberfaellig = mOut.filter((m) => m.esc.ampel === 'rot' && m.status !== 'behoben_gemeldet');

  const punkte = await t`
    SELECT p.id, p.number, p.text, p.status, p.due_date::text AS due, c.name AS firma, l.name AS ort
    FROM besprechung_punkt p LEFT JOIN company c ON c.id = p.responsible_company_id LEFT JOIN location l ON l.id = p.location_id
    WHERE p.project_id = ${projectId} AND p.status NOT IN ('erledigt', 'nicht_faellig') AND p.due_date IS NOT NULL AND p.due_date <= current_date + 7
    ORDER BY p.due_date LIMIT 12`;
  const [termin] = await t`SELECT id, number, next_at FROM besprechung WHERE project_id = ${projectId} AND next_at >= now() ORDER BY next_at LIMIT 1`;

  const lieferungen = await t`
    SELECT id, number, titel, status, lieferant, liefertermin::text AS liefertermin, benoetigt_am::text AS benoetigt_am, created_by = ${userId} AS meine
    FROM bestellanforderung
    WHERE project_id = ${projectId} AND (
      (status = 'bestellt' AND (liefertermin IS NULL OR liefertermin <= current_date + 7))
      OR (created_by = ${userId} AND status IN ('offen', 'in_bearbeitung', 'angefragt')))
    ORDER BY (status = 'bestellt') DESC, liefertermin NULLS LAST, created_at DESC LIMIT 12`;

  const fotos = await t`
    SELECT f.id, f.titel, f.kategorie, f.ist_360, f.taken_at, f.file_key IS NOT NULL AS hochgeladen, l.name AS ort
    FROM foto_doku f LEFT JOIN location l ON l.id = f.location_id
    WHERE f.project_id = ${projectId} AND f.deleted_at IS NULL ORDER BY f.taken_at DESC LIMIT 6`;
  const [fotoWoche] = await t`SELECT count(*)::int AS n FROM foto_doku WHERE project_id = ${projectId} AND deleted_at IS NULL AND taken_at >= date_trunc('week', now())`;

  return {
    heute: heute ? { id: heute.id as string, status: heute.status as string } : null,
    berichte: { offen_alt: (berichte?.offen_alt as number) ?? 0, letzter: (berichte?.letzter as string) ?? null },
    zahlen: {
      offen: mOut.length, ueberfaellig: ueberfaellig.length, pruefen: pruefen.length,
      ohne_firma: mOut.filter((m) => !m.firma).length, punkte: punkte.length, fotos_woche: (fotoWoche?.n as number) ?? 0,
    },
    pruefen: pruefen.slice(0, 8),
    ueberfaellig: ueberfaellig.sort((x, y) => (x.due ?? '9').localeCompare(y.due ?? '9')).slice(0, 8),
    punkte: punkte.map((p) => ({ ...p, no: punktNo(p.number as number) })),
    termin: termin ? { id: termin.id as string, number: termin.number as number, next_at: termin.next_at as string } : null,
    lieferungen,
    fotos,
  };
}

/**
 * Bau-/Projektleitung: every project the person leads at a glance (one query, counts per project), sorted so that
 * projects with something to decide come first. "Zu tun" = waiting for the Leitung.
 */
export async function leitungCockpit(t: TxSql) {
  const rows = await t`
    SELECT p.id, p.name,
      (SELECT count(*)::int FROM mangel m WHERE m.project_id = p.id AND m.deleted_at IS NULL AND m.status <> 'abgenommen') AS maengel_offen,
      (SELECT count(*)::int FROM mangel m WHERE m.project_id = p.id AND m.deleted_at IS NULL AND m.status NOT IN ('abgenommen', 'behoben_gemeldet')
         AND coalesce(m.nachfrist_date, m.due_date) < current_date) AS maengel_ueberfaellig,
      (SELECT count(*)::int FROM mangel m WHERE m.project_id = p.id AND m.deleted_at IS NULL AND m.status = 'behoben_gemeldet') AS maengel_pruefen,
      (SELECT count(*)::int FROM mangel m WHERE m.project_id = p.id AND m.deleted_at IS NULL AND m.status = 'neu') AS maengel_neu,
      (SELECT count(*)::int FROM tagesbericht b WHERE b.project_id = p.id AND b.status = 'unterschrieben' AND b.countersigned_at IS NULL) AS berichte,
      (SELECT count(*)::int FROM einkauf e WHERE e.project_id = p.id AND e.status = 'eingereicht') AS einkaeufe,
      (SELECT count(*)::int FROM einreichung r WHERE r.project_id = p.id AND r.status IN ('eingereicht', 'in_pruefung')) AS einreichungen,
      (SELECT count(*)::int FROM einreichung r WHERE r.project_id = p.id AND r.status = 'gf_erforderlich') AS ueber_grenze,
      (SELECT count(*)::int FROM stundenzettel s WHERE s.project_id = p.id AND s.status = 'eingereicht') AS stunden,
      (SELECT count(*)::int FROM bestellanforderung a WHERE a.project_id = p.id AND a.status = 'offen') AS anforderungen,
      (SELECT min(b.next_at) FROM besprechung b WHERE b.project_id = p.id AND b.next_at >= now()) AS naechste_besprechung,
      (SELECT max(b.datum)::text FROM tagesbericht b WHERE b.project_id = p.id) AS letzter_bericht
    FROM project p WHERE app.project_role(p.id) = 'bauleitung' ORDER BY p.name`;
  const projekte = rows.map((r) => {
    const zuTun = (r.maengel_pruefen as number) + (r.berichte as number) + (r.einkaeufe as number) + (r.einreichungen as number) + (r.stunden as number) + (r.maengel_neu as number);
    return { ...(r as Record<string, unknown>), zu_tun: zuTun } as Record<string, unknown> & { zu_tun: number; name: string; maengel_ueberfaellig: number };
  }).sort((x, y) => y.zu_tun - x.zu_tun || (y.maengel_ueberfaellig as number) - (x.maengel_ueberfaellig as number) || String(x.name).localeCompare(String(y.name), 'de'));
  const sum = (k: string) => projekte.reduce((s, p) => s + ((p as Record<string, unknown>)[k] as number), 0);
  return {
    projekte,
    summe: {
      zu_tun: sum('zu_tun'), maengel_ueberfaellig: sum('maengel_ueberfaellig'), maengel_pruefen: sum('maengel_pruefen'), berichte: sum('berichte'),
      einkaeufe: sum('einkaeufe'), einreichungen: sum('einreichungen'), stunden: sum('stunden'), anforderungen: sum('anforderungen'), ueber_grenze: sum('ueber_grenze'),
    },
  };
}
