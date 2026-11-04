import type { MangelStatus, Priority, ProjectRole } from '@bap/domain';

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
  companies: { id: string; name: string; kind: string }[];
  plans: { id: string; location_id: string; name: string; plan_index: string; page_count: number }[];
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
