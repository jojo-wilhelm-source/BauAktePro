/**
 * Mängel sorted and grouped like folders (docs/fachkonzept/04): used by the web list, the folder view and
 * the Mängelbericht PDF, so the report has exactly the order and structure the user sees.
 */
import { formatDate } from './format';
import { MANGEL_STATUS, MANGEL_STATUS_LABELS, type MangelStatus } from './mangel';

export type MangelSort = 'nummer' | 'firma' | 'datum_neu' | 'datum_alt' | 'frist' | 'ort';
export const MANGEL_SORT_LABELS: Record<MangelSort, string> = {
  nummer: 'Nummer',
  firma: 'Firma',
  datum_neu: 'Datum (neueste zuerst)',
  datum_alt: 'Datum (älteste zuerst)',
  frist: 'Frist',
  ort: 'Ort',
};

export type MangelGruppe = 'firma' | 'geschoss' | 'ort' | 'gewerk' | 'monat' | 'tag' | 'status';
export const MANGEL_GRUPPE_LABELS: Record<MangelGruppe, string> = {
  firma: 'Firma',
  geschoss: 'Geschoss',
  ort: 'Raum',
  gewerk: 'Gewerk',
  monat: 'Monat',
  tag: 'Tag',
  status: 'Status',
};

/** What sorting/grouping needs from a Mangel (web list row or DB row). */
export interface MangelKey {
  number: number | null;
  company: string | null;
  created_at: string;
  due: string | null;
  location: string;
  geschoss?: string | null;
  gewerk: string;
  status: MangelStatus;
}

const cmp = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
const day = (iso: string) => iso.slice(0, 10);
const OHNE_FIRMA = 'Ohne Firma';

export function sortMaengel<T>(list: readonly T[], sort: MangelSort, key: (t: T) => MangelKey): T[] {
  const byNo = (a: MangelKey, b: MangelKey) => (a.number ?? 1e9) - (b.number ?? 1e9);
  return [...list].sort((x, y) => {
    const a = key(x);
    const b = key(y);
    switch (sort) {
      case 'firma':
        // Without company last; within a company by number.
        return (a.company ? 0 : 1) - (b.company ? 0 : 1) || cmp(a.company ?? '', b.company ?? '') || byNo(a, b);
      case 'datum_neu':
        return cmp(b.created_at, a.created_at) || byNo(a, b);
      case 'datum_alt':
        return cmp(a.created_at, b.created_at) || byNo(a, b);
      case 'frist':
        return (a.due ? 0 : 1) - (b.due ? 0 : 1) || cmp(a.due ?? '', b.due ?? '') || byNo(a, b);
      case 'ort':
        return cmp(a.geschoss ?? '', b.geschoss ?? '') || cmp(a.location, b.location) || byNo(a, b);
      default:
        return byNo(a, b);
    }
  });
}

/** Folder of a Mangel for one grouping level: key, display label and sort order of the folders. */
export function gruppeVon(m: MangelKey, g: MangelGruppe): { key: string; label: string; order: string } {
  switch (g) {
    case 'firma':
      return { key: m.company ?? '', label: m.company ?? OHNE_FIRMA, order: m.company ? `0${m.company}` : '1' };
    case 'geschoss':
      return { key: m.geschoss ?? '', label: m.geschoss ?? 'Ohne Geschoss', order: m.geschoss ? `0${m.geschoss}` : '1' };
    case 'ort':
      return { key: m.location, label: m.location, order: m.location };
    case 'gewerk':
      return { key: m.gewerk, label: m.gewerk, order: m.gewerk };
    case 'monat': {
      const k = m.created_at.slice(0, 7);
      const label = new Date(`${k}-15T12:00:00Z`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });
      // Newest month first: invert the order key.
      return { key: k, label, order: String(999999 - Number(k.replace('-', ''))) };
    }
    case 'tag':
      return { key: day(m.created_at), label: formatDate(m.created_at), order: String(99999999 - Number(day(m.created_at).replace(/-/g, ''))) };
    case 'status':
      return { key: m.status, label: MANGEL_STATUS_LABELS[m.status], order: String(MANGEL_STATUS.indexOf(m.status)).padStart(2, '0') };
  }
}

export interface MangelOrdner<T> {
  /** Unique path, e.g. "firma:Elektro Blitz GmbH/monat:2026-11". */
  path: string;
  label: string;
  items: T[];
  children: MangelOrdner<T>[];
  /** All Mängel in this folder including subfolders. */
  count: number;
}

/** Folder tree: first level, optional further levels; Mängel inside a folder keep the given sort. */
export function ordnerBaum<T>(list: readonly T[], levels: MangelGruppe[], key: (t: T) => MangelKey, parent = ''): MangelOrdner<T>[] {
  const [g, ...rest] = levels;
  if (!g) return [];
  const map = new Map<string, { label: string; order: string; items: T[] }>();
  for (const t of list) {
    const f = gruppeVon(key(t), g);
    const e = map.get(f.key) ?? { label: f.label, order: f.order, items: [] };
    e.items.push(t);
    map.set(f.key, e);
  }
  return [...map.entries()]
    .sort(([, a], [, b]) => cmp(a.order, b.order))
    .map(([k, e]) => {
      const path = `${parent}${parent ? '/' : ''}${g}:${k}`;
      const children = ordnerBaum(e.items, rest, key, path);
      return { path, label: e.label, items: children.length ? [] : e.items, children, count: e.items.length };
    });
}
