/**
 * Rights per person (docs/fachkonzept/01, decided 12.11.2026): the role sets what someone may do in a project;
 * single areas can additionally be switched off per member. Switches never add rights beyond the role.
 */
export const MODULE = ['plaene', 'dokumente', 'besprechungen', 'bautagebuch', 'stunden', 'nachtraege', 'kosten'] as const;
export type Modul = (typeof MODULE)[number];
export const MODUL_LABELS: Record<Modul, string> = {
  plaene: 'Pläne', dokumente: 'Dokumente', besprechungen: 'Besprechungen', bautagebuch: 'Bautagebuch',
  stunden: 'Stundenzettel', nachtraege: 'Nachträge & Rechnungen', kosten: 'Kosten',
};
export const ROLLEN = ['bauleitung', 'projektleitung', 'polier', 'einkauf', 'nu', 'bauherr'] as const;
export type Rolle = (typeof ROLLEN)[number];

/** Areas a role can have at all (the switches are offered only for these). */
export const MODULE_JE_ROLLE: Record<Rolle, readonly Modul[]> = {
  bauleitung: MODULE,
  projektleitung: MODULE,
  polier: ['plaene', 'dokumente', 'besprechungen', 'bautagebuch', 'stunden'],
  einkauf: ['plaene', 'dokumente'],
  nu: ['plaene', 'dokumente', 'besprechungen', 'stunden', 'nachtraege'],
  bauherr: ['plaene', 'dokumente', 'besprechungen', 'bautagebuch'],
};
export const modulColumn = (m: Modul) => `m_${m}` as const;
/** Which areas are on for a member row ({m_plaene: true, ...}) given its role. */
export function aktiveModule(role: string, row: Partial<Record<`m_${Modul}`, boolean>>): Modul[] {
  const erlaubt = MODULE_JE_ROLLE[(role === 'admin' ? 'bauleitung' : role) as Rolle] ?? [];
  return erlaubt.filter((m) => row[modulColumn(m)] !== false);
}
