import type { Modul } from '@bap/domain';
import type { AnzeigeStatus, LocationArea, MangelStatus, PlanRevisionStatus, Priority, ProjectRole, PunktStatus } from '@bap/domain';

const TOKEN_KEY = 'bap.token';
const REFRESH_KEY = 'bap.refresh';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

/** Sign-in result: short access token (12 h) + refresh token (session, 30 days). */
export function setSession(s: { token: string; refresh?: string } | null) {
  setToken(s?.token ?? null);
  if (s?.refresh) localStorage.setItem(REFRESH_KEY, s.refresh);
  if (!s) localStorage.removeItem(REFRESH_KEY);
}

export async function signOut() {
  const refresh = localStorage.getItem(REFRESH_KEY);
  setSession(null);
  if (refresh) await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh }) }).catch(() => {});
}

const secondsLeft = (t: string) => {
  try {
    return (JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp as number) - Date.now() / 1000;
  } catch {
    return -1;
  }
};

/** Renews the access token when less than an hour is left (or it has expired). Returns false if signed out. */
let refreshing: Promise<boolean> | null = null;
export function ensureFreshToken(): Promise<boolean> {
  const t = getToken();
  if (t && secondsLeft(t) > 3600) return Promise.resolve(true);
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (!refresh) return Promise.resolve(!!t && secondsLeft(t) > 0);
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh }) })
    .then(async (r) => {
      if (r.ok) setToken(((await r.json()) as { token: string }).token);
      else if (r.status === 401 || r.status === 403) setSession(null);
      return r.ok;
    })
    .catch(() => !!t && secondsLeft(t) > 0)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.reason ?? body?.error ?? `HTTP ${status}`);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!path.startsWith('/auth/')) await ensureFreshToken();
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    // No content-type without a body (Fastify rejects an empty JSON body, e.g. on DELETE).
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && !path.startsWith('/auth/')) setSession(null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export interface Me {
  user: { id: string; name: string; email: string; company: string };
  projects: { id: string; name: string; role: ProjectRole; module: Modul[] }[];
  canCreateProject: boolean;
  /** Fahrtenbuch granted by the administrator. */
  fahrtenbuch: boolean;
  isAdmin: boolean;
  companyAdmin: boolean;
}
export interface ProjectInfo {
  project: { id: string; name: string };
  role: ProjectRole;
  roleLabel: string;
  companyId: string;
  locations: { id: string; parent_id: string | null; kind: string; name: string; nummer?: string | null }[];
  gewerke: { id: string; name: string }[];
  gewerkCompanies: { gewerk_id: string; company_id: string }[];
  companies: { id: string; name: string; kind: string; email: string | null }[];
  plans: { id: string; location_id: string; name: string; plan_index: string; page_count: number; folder_name: string | null; released: boolean }[];
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
  created_at: string;
  version: number;
  escalation: { stage: string; ampel: 'gruen' | 'gelb' | 'rot' | 'grau'; label: string; nachfristSuggestion: string | null };
  allowed_transitions: MangelStatus[];
  notes: { text: string; created_at: string }[];
  anzeige_id: string | null;
  anzeige_number: number | null;
  anzeige_status: AnzeigeStatus | null;
  anzeige_sent_at: string | null;
  created_by: string;
  fotos: { id: string; kind: 'mangel' | 'nachweis'; taken_at: string }[];
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
/** Authenticated download (e.g. calendar file). */
export async function downloadFile(path: string, fileName: string) {
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  next_at: string | null;
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
  /** NU: own Punkt (highlighted). */
  mine?: boolean;
  fotos?: { id: string; caption: string | null }[];
}
export interface BesprechungDetail extends Omit<BesprechungListItem, 'punkte' | 'offen' | 'has_next'> {
  teilnehmer: { id: string; name: string; kind: string; email: string | null; anwesend: boolean | null }[];
  bemerkung: string | null;
  punkte: Punkt[];
  maengel: { id: string; number: number; description: string; company_name: string; escalation: { label: string } }[];
  can_edit: boolean;
  can_send: boolean;
  can_release?: boolean;
  can_countersign?: boolean;
  bauherr_freigabe?: boolean;
  bauherr_freigabe_at?: string | null;
  bauherr_signed_at?: string | null;
}

// --- Dokumente --------------------------------------------------------------------
export interface Folder { id: string; parent_id: string | null; name: string; sort: number; visible_to_nu: boolean; visible_to_bauherr: boolean; kind: 'plaene' | 'dokumente'; location_id: string | null }
export interface DocVersion {
  id: string; label: string; status: PlanRevisionStatus; comment: string | null; uploaded_at: string; decided_at: string | null;
  uploaded_by_name: string; decided_by_name: string | null; version: number; file_name?: string; mime?: string;
}
export interface DocItem { id: string; type: 'plan' | 'document'; folder_id: string; name: string; current_revision_id: string | null; revisions: DocVersion[] }
