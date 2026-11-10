import type { AnzeigeStatus, LocationArea, MangelStatus, PlanRevisionStatus, Priority, ProjectRole, PunktStatus } from '@bap/domain';

const TOKEN_KEY = 'bap.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.reason ?? body?.error ?? `HTTP ${status}`);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401) setToken(null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export interface Me {
  user: { id: string; name: string; email: string; company: string };
  projects: { id: string; name: string; role: ProjectRole }[];
}
export interface ProjectInfo {
  project: { id: string; name: string };
  role: ProjectRole;
  companyId: string;
  locations: { id: string; parent_id: string | null; kind: string; name: string }[];
  gewerke: { id: string; name: string }[];
  gewerkCompanies: { gewerk_id: string; company_id: string }[];
  companies: { id: string; name: string; kind: string; email: string | null }[];
  plans: { id: string; location_id: string; name: string; plan_index: string; page_count: number }[];
  locationAreas: LocationArea[];
}
export interface Mangel {
  id: string;
  number: number;
  description: string;
  status: MangelStatus;
  priority: Priority;
  due_date: string | null;
  nachfrist_date: string | null;
  location_id: string;
  location_name: string;
  gewerk_id: string;
  gewerk_name: string;
  assigned_company_id: string | null;
  assigned_company_name: string | null;
  assignment_confirmed: boolean;
  visible_to_bauherr: boolean;
  plan_id: string | null;
  pin_page: number | null;
  pin_x: number | null;
  pin_y: number | null;
  created_by_name: string;
  version: number;
  escalation: { stage: string; ampel: 'gruen' | 'gelb' | 'rot' | 'grau'; label: string; nachfristSuggestion: string | null };
  allowed_transitions: MangelStatus[];
  notes: { text: string; created_at: string }[];
  anzeige_id: string | null;
  anzeige_number: number | null;
  anzeige_status: AnzeigeStatus | null;
  anzeige_sent_at: string | null;
  created_by: string;
}
export interface AnzeigeListItem {
  id: string;
  number: number | null;
  status: AnzeigeStatus;
  deadline: string;
  company_id: string;
  company_name: string;
  recipient_email: string | null;
  sent_at: string | null;
  created_at: string;
  version: number;
  positions: number;
}
export interface AnzeigeDetail extends Omit<AnzeigeListItem, 'positions'> {
  note: string | null;
  anzeige_no: string;
  company_email: string | null;
  created_by_name: string;
  sent_by_name: string | null;
  positions: AnzeigePosition[];
}
export interface AnzeigePosition {
  pos: number;
  mangel_id: string;
  number: number;
  description: string;
  status: MangelStatus;
  location_name: string;
  gewerk_name: string;
}

/** Opens a PDF from the API in a new tab without putting the token into the URL. */
export async function openPdf(path: string) {
  const win = window.open('', '_blank');
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    win?.close();
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  const url = URL.createObjectURL(await res.blob());
  if (win) win.location.href = url;
  else window.location.href = url;
}
export interface Conflict {
  id: string;
  kind: 'conflict' | 'rejected';
  reason: string;
  number: number | null;
  actor_name: string;
  client_change: Record<string, unknown>;
  created_at: string;
}

// --- Pläne (register) ---------------------------------------------------------
export interface PlanRevision {
  id: string;
  plan_id: string;
  plan_index: string;
  status: PlanRevisionStatus;
  comment: string | null;
  uploaded_at: string;
  decided_at: string | null;
  uploaded_by_name: string;
  decided_by_name: string | null;
  version: number;
}
export interface PlanEntry {
  id: string;
  name: string;
  plan_index: string;
  location_id: string;
  location_name: string;
  released_at: string | null;
  current_revision_id: string | null;
  revisions: PlanRevision[];
}

// --- Besprechungen --------------------------------------------------------------
export interface BesprechungListItem {
  id: string;
  number: number;
  kind: 'nu' | 'bau';
  title: string;
  held_at: string;
  place: string | null;
  status: 'entwurf' | 'versendet';
  sent_at: string | null;
  previous_id: string | null;
  version: number;
  punkte: number;
  offen: number;
  has_next: boolean;
}
export interface Punkt {
  id: string;
  number: number | null;
  location_id: string | null;
  location_name: string | null;
  gewerk_id: string | null;
  gewerk_name: string | null;
  text: string;
  responsible_company_id: string | null;
  responsible_name: string | null;
  support_company_ids: string[];
  support_names: string[];
  status: PunktStatus;
  due_date: string | null;
  internal: boolean;
  carried: boolean;
  status_snapshot: PunktStatus | null;
  text_snapshot: string | null;
  plan_id: string | null;
  pin_page: number | null;
  pin_x: number | null;
  pin_y: number | null;
  version: number;
}
export interface BesprechungDetail extends Omit<BesprechungListItem, 'punkte' | 'offen' | 'has_next'> {
  teilnehmer: { id: string; name: string; kind: string; email: string | null }[];
  punkte: Punkt[];
  maengel: { id: string; number: number; description: string; company_name: string; escalation: { label: string } }[];
  can_edit: boolean;
  can_send: boolean;
}
