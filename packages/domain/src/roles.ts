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
