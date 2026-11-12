/** Project roles (per project, see docs/fachkonzept/01-rollen-rechte.md). */
export const PROJECT_ROLES = ['bauleitung', 'polier', 'nu', 'bauherr', 'einkauf'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Roles that see all project data except prices (internal side). */
export const INTERNAL_ROLES: readonly ProjectRole[] = ['bauleitung', 'polier'];

export const isInternal = (role: ProjectRole) => INTERNAL_ROLES.includes(role);

/** Display labels for the German UI. */
export const ROLE_LABELS: Record<ProjectRole, string> = {
  bauleitung: 'Bauleitung',
  polier: 'Polier',
  nu: 'Nachunternehmer',
  bauherr: 'Bauherr',
  einkauf: 'Einkauf',
};

/**
 * Roles as stored in project_member. Projektleitung has the same rights as Bauleitung (docs/fachkonzept/01):
 * all rights checks work on the EFFECTIVE role, the label shows the real one.
 */
export type StoredRole = ProjectRole | 'projektleitung' | 'admin';
/** 'admin' = Administrator without own membership: Bauleitung rights in every project of the company. */
export const effectiveRole = (r: StoredRole | string): ProjectRole => (r === 'projektleitung' || r === 'admin' ? 'bauleitung' : (r as ProjectRole));
export const roleLabel = (r: StoredRole | string) =>
  r === 'projektleitung' ? 'Projektleitung' : r === 'admin' ? 'Administrator' : (ROLE_LABELS[r as ProjectRole] ?? r);
/** Bau- or Projektleitung ("Leitung"): the deciding roles. */
export const isLeitung = (r: StoredRole | string) => effectiveRole(r) === 'bauleitung';
