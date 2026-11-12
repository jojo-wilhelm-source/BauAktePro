import { column, Schema, Table } from '@powersync/react-native';

/** Local SQLite schema. Synced tables mirror Postgres (filtered by infra/powersync/sync-config.yaml). */
const project = new Table({ tenant_id: column.text, name: column.text });
const project_member = new Table({
  project_id: column.text, user_id: column.text, company_id: column.text, role: column.text,
  // Areas switched off per person (0 = off); the server sends no data for them anyway.
  m_plaene: column.integer, m_dokumente: column.integer, m_besprechungen: column.integer, m_bautagebuch: column.integer,
});
/** Contacts of the firms on site, callable from the app. */
const company_kontakt = new Table({ company_id: column.text, name: column.text, funktion: column.text, telefon: column.text, email: column.text, aktiv: column.integer });
const company = new Table({ name: column.text, kind: column.text });
const location = new Table({ project_id: column.text, parent_id: column.text, kind: column.text, name: column.text, sort: column.integer });
const gewerk = new Table({ project_id: column.text, name: column.text });
const gewerk_company = new Table({ gewerk_id: column.text, company_id: column.text });
const plan = new Table({ project_id: column.text, location_id: column.text, name: column.text, plan_index: column.text, page_count: column.integer });
const mangel = new Table(
  {
    project_id: column.text,
    location_id: column.text,
    gewerk_id: column.text,
    number: column.integer,
    description: column.text,
    priority: column.text,
    status: column.text,
    due_date: column.text,
    nachfrist_date: column.text,
    plan_id: column.text,
    pin_page: column.integer,
    pin_x: column.real,
    pin_y: column.real,
    assigned_company_id: column.text,
    assignment_confirmed: column.integer,
    reporter_company_id: column.text,
    visible_to_bauherr: column.integer,
    created_by: column.text,
    creator_role: column.text,
    created_at: column.text,
    version: column.integer,
  },
  { indexes: { project: ['project_id'] } },
);
const mangel_note = new Table({ mangel_id: column.text, project_id: column.text, text: column.text, created_at: column.text });
/** Room areas on plans: the device derives the room from a pin, also offline. */
const location_area = new Table({ project_id: column.text, location_id: column.text, plan_id: column.text, page: column.integer, x0: column.real, y0: column.real, x1: column.real, y1: column.real });
/** Mangelanzeigen: readable offline (internal: all; NU: only those sent to the own company). Written via the API. */
const mangelanzeige = new Table({ project_id: column.text, number: column.integer, company_id: column.text, status: column.text, deadline: column.text, sent_at: column.text });
const mangelanzeige_position = new Table({ anzeige_id: column.text, project_id: column.text, pos: column.integer, mangel_id: column.text }, { indexes: { mangel: ['mangel_id'] } });
/** NU-Besprechung on the tablet (docs/fachkonzept/09): readable and editable offline (internal roles). */
const besprechung = new Table({ project_id: column.text, number: column.integer, kind: column.text, title: column.text, held_at: column.text, place: column.text, status: column.text, previous_id: column.text, version: column.integer });
const besprechung_punkt = new Table(
  {
    project_id: column.text,
    number: column.integer,
    first_besprechung_id: column.text,
    location_id: column.text,
    gewerk_id: column.text,
    text: column.text,
    responsible_company_id: column.text,
    support_company_ids: column.text, // JSON array
    status: column.text,
    due_date: column.text,
    internal: column.integer,
    plan_id: column.text,
    pin_x: column.real,
    pin_y: column.real,
    version: column.integer,
    created_by: column.text,
    created_at: column.text,
  },
  { indexes: { project: ['project_id'] } },
);
const besprechung_eintrag = new Table({ besprechung_id: column.text, punkt_id: column.text, project_id: column.text, carried: column.integer, status_snapshot: column.text }, { indexes: { b: ['besprechung_id'] } });
/** Status chips tapped in the meeting: upload queue, applied only if the Punkt is unchanged (like mangel_action). */
const punkt_action = new Table({ punkt_id: column.text, payload: column.text, base_version: column.integer, occurred_at: column.text }, { insertOnly: true });
const pending_punkt = new Table({ punkt_id: column.text, status: column.text, base_version: column.integer, occurred_at: column.text }, { localOnly: true });
/** Photos of Mängel: metadata synced; files load via the API. */
const mangel_foto = new Table({ mangel_id: column.text, project_id: column.text, kind: column.text, taken_at: column.text, created_by: column.text }, { indexes: { m: ['mangel_id'] } });
/** Photos taken on the device that still have to be uploaded (file lies in the app's documents folder). Never synced. */
const foto_upload = new Table({ mangel_id: column.text, uri: column.text, kind: column.text, taken_at: column.text, error: column.text }, { localOnly: true });
/** Baustellen-Einkäufe and Fahrtenbuch (docs/fachkonzept/14): own entries, recorded offline, uploaded via /sync/upload. */
const einkauf = new Table({
  project_id: column.text, number: column.integer, gekauft_von: column.text, datum: column.text, haendler: column.text, betrag_brutto: column.real,
  mwst_satz: column.real, gewerk_id: column.text, zweck: column.text, zahlungsart: column.text, status: column.text, created_by: column.text, created_at: column.text,
});
const fahrzeug = new Table({ tenant_id: column.text, kennzeichen: column.text, bezeichnung: column.text, kraftstoff: column.text, fahrer_id: column.text });
const fahrt = new Table({ fahrzeug_id: column.text, fahrer_id: column.text, datum: column.text, km_start: column.integer, km_ende: column.integer, project_id: column.text, zweck: column.text });
const tankvorgang = new Table({ fahrzeug_id: column.text, fahrer_id: column.text, datum: column.text, liter: column.real, betrag_brutto: column.real, km_stand: column.integer, tankstelle: column.text, project_id: column.text });
/** Receipt photos waiting for upload (einkauf / tankvorgang). Never synced. */
const beleg_upload = new Table({ kind: column.text, entity_id: column.text, uri: column.text }, { localOnly: true });
/** Dateiablage (docs/fachkonzept/03, 05): folders, documents and their released revisions; files are downloaded by offline.ts. */
const folder = new Table({ project_id: column.text, parent_id: column.text, name: column.text, sort: column.integer, kind: column.text }, { indexes: { p: ['project_id'] } });
const document = new Table({ project_id: column.text, folder_id: column.text, name: column.text, current_revision_id: column.text }, { indexes: { f: ['folder_id'] } });
const document_revision = new Table({ document_id: column.text, project_id: column.text, version_label: column.text, file_name: column.text, mime: column.text, size_bytes: column.integer, status: column.text, decided_at: column.text });
const sync_conflict = new Table({ project_id: column.text, entity_id: column.text, kind: column.text, reason: column.text, created_at: column.text });

/**
 * Upload queue for decisions made on the device (status changes, edits). Insert-only: rows are
 * uploaded to /sync/upload and not kept locally. The server applies them only if the Mangel is
 * still at base_version ("Entscheidung vormerken", docs/fachkonzept/05-offline-sync.md).
 */
const mangel_action = new Table(
  { mangel_id: column.text, action: column.text, payload: column.text, base_version: column.integer, occurred_at: column.text },
  { insertOnly: true },
);
/** Local mirror of pending actions, only for display ("vorgemerkt"). Never synced. */
const pending_action = new Table(
  { mangel_id: column.text, action: column.text, payload: column.text, base_version: column.integer, occurred_at: column.text },
  { localOnly: true },
);

/**
 * Bautagebuch (docs/fachkonzept/07). The synced report is read-only on the device; drafts, signatures and Nachträge
 * go through tagesbericht_action (ordered, version-checked on the server). tagesbericht_lokal shows unsent work.
 */
const tagesbericht = new Table(
  {
    project_id: column.text, datum: column.text, bereich: column.text, wetter: column.text, personal: column.text, geraete: column.text, leistungen: column.text,
    lieferungen: column.text, behinderungen: column.text, besonderheiten: column.text, status: column.text, signed_by: column.text, signed_at: column.text,
    countersigned_by: column.text, countersigned_at: column.text, version: column.integer, created_by: column.text,
  },
  { indexes: { p: ['project_id', 'datum'] } },
);
const tagesbericht_nachtrag = new Table({ bericht_id: column.text, project_id: column.text, text: column.text, created_by: column.text, created_at: column.text }, { indexes: { b: ['bericht_id'] } });
const tagesbericht_action = new Table({ bericht_id: column.text, action: column.text, payload: column.text, base_version: column.integer, occurred_at: column.text }, { insertOnly: true });
const tagesbericht_lokal = new Table(
  {
    project_id: column.text, datum: column.text, payload: column.text, status: column.text, expected_version: column.integer, nachtraege: column.text, countersigned: column.integer, updated_at: column.text,
  },
  { localOnly: true },
);

export const AppSchema = new Schema({
  company_kontakt,
  tagesbericht, tagesbericht_nachtrag, tagesbericht_action, tagesbericht_lokal,
  project, project_member, company, location, location_area, gewerk, gewerk_company, plan, mangel, mangel_note, mangel_foto, foto_upload, einkauf, fahrzeug, fahrt, tankvorgang, beleg_upload, folder, document, document_revision, mangelanzeige, mangelanzeige_position, besprechung, besprechung_punkt, besprechung_eintrag, punkt_action, pending_punkt, sync_conflict, mangel_action, pending_action,
});
export type Database = (typeof AppSchema)['types'];
export type MangelRow = Database['mangel'];
