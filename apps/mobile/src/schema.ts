import { column, Schema, Table } from '@powersync/react-native';

/** Local SQLite schema. Synced tables mirror Postgres (filtered by infra/powersync/sync-config.yaml). */
const project = new Table({ tenant_id: column.text, name: column.text });
const project_member = new Table({ project_id: column.text, user_id: column.text, company_id: column.text, role: column.text });
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

export const AppSchema = new Schema({
  project, project_member, company, location, gewerk, gewerk_company, plan, mangel, mangel_note, sync_conflict, mangel_action, pending_action,
});
export type Database = (typeof AppSchema)['types'];
export type MangelRow = Database['mangel'];
