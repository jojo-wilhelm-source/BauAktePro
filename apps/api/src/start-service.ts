/**
 * Start page "Was ist zu tun?" (NU-Portal, docs/fachkonzept/08): everything that waits for the signed-in
 * person's firm in one list – overdue first. Visibility comes from RLS (a NU only ever sees his own things).
 */
import type { TxSql } from '@bap/db';
import { anzeigeNo, escalation, punktNo, type MangelStatus, type Priority } from '@bap/domain';
import { actorFor } from './mangel-service';

const iso = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

export async function startPage(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  const nu = a.role === 'nu';
  const company = nu ? a.companyId : null;

  const maengel = await tx`
    SELECT m.id, m.number, m.description, m.status, m.priority, m.due_date, m.nachfrist_date, l.name AS location_name
    FROM mangel m JOIN location l ON l.id = m.location_id
    WHERE m.project_id = ${projectId} AND m.deleted_at IS NULL AND m.status NOT IN ('abgenommen')
      ${company ? tx`AND m.assigned_company_id = ${company} AND m.assignment_confirmed` : tx``}`;
  const maengelOut = maengel
    .map((m) => ({
      id: m.id, number: m.number, description: m.description, status: m.status, location: m.location_name,
      due: iso(m.nachfrist_date ?? m.due_date),
      esc: escalation({ status: m.status as MangelStatus, due_date: iso(m.due_date), nachfrist_date: iso(m.nachfrist_date), priority: m.priority as Priority }),
      // What the NU has to do next.
      todo: m.status === 'zugewiesen' ? 'Annehmen und beheben' : m.status === 'in_bearbeitung' || m.status === 'nicht_behoben' ? 'Beheben und mit Foto melden' : m.status === 'behoben_gemeldet' ? 'Wartet auf Prüfung' : m.status === 'strittig' ? 'In Klärung' : '',
    }))
    .sort((x, y) => (x.esc.ampel === 'rot' ? 0 : 1) - (y.esc.ampel === 'rot' ? 0 : 1) || (x.due ?? '9').localeCompare(y.due ?? '9'));

  const anzeigen = await tx`
    SELECT a.id, a.number, a.deadline, a.sent_at, c.name AS company,
      (SELECT count(*)::int FROM mangelanzeige_position p JOIN mangel m ON m.id = p.mangel_id WHERE p.anzeige_id = a.id AND m.status <> 'abgenommen') AS offen,
      (SELECT count(*)::int FROM mangelanzeige_position p WHERE p.anzeige_id = a.id) AS positionen
    FROM mangelanzeige a JOIN company c ON c.id = a.company_id
    WHERE a.project_id = ${projectId} AND a.status = 'versendet' ${company ? tx`AND a.company_id = ${company}` : tx``}
    ORDER BY a.sent_at DESC LIMIT 20`;

  const punkte = await tx`
    SELECT p.id, p.number, p.text, p.status, p.due_date, l.name AS location_name
    FROM besprechung_punkt p LEFT JOIN location l ON l.id = p.location_id
    WHERE p.project_id = ${projectId} AND p.status <> 'erledigt'
      ${company ? tx`AND (p.responsible_company_id = ${company} OR ${company} = ANY (p.support_company_ids))` : tx``}
    ORDER BY p.due_date NULLS LAST LIMIT 30`;

  const einreichungen = nu
    ? await tx`SELECT id, kind, number, title, status, amount_net::float AS amount FROM einreichung WHERE project_id = ${projectId} ORDER BY submitted_at DESC LIMIT 10`
    : [];
  const stunden = nu
    ? await tx`SELECT id, number, period_from, period_to, status FROM stundenzettel WHERE project_id = ${projectId} ORDER BY period_from DESC LIMIT 5`
    : [];

  return {
    role: a.role,
    maengel: maengelOut,
    anzeigen: anzeigen.map((x) => ({ ...x, no: anzeigeNo(x.number as number) })),
    punkte: punkte.map((p) => ({ ...p, no: punktNo(p.number as number), due: iso(p.due_date) })),
    einreichungen,
    stunden,
    counts: {
      ueberfaellig: maengelOut.filter((m) => m.esc.ampel === 'rot').length,
      offen: maengelOut.filter((m) => m.status !== 'behoben_gemeldet').length,
      punkte: punkte.length,
    },
  };
}
