import { MANGEL_STATUS_LABELS, type MangelStatus } from '@bap/domain';
import type { Mangel } from '../api';

export const STATUS_COLOR: Record<MangelStatus, string> = {
  neu: 'c-gray',
  zugewiesen: 'c-blue',
  in_bearbeitung: 'c-indigo',
  behoben_gemeldet: 'c-teal',
  nicht_behoben: 'c-orange',
  strittig: 'c-purple',
  abgenommen: 'c-green',
};

export const AMPEL_COLOR: Record<Mangel['escalation']['ampel'], string> = { rot: 'c-red', gelb: 'c-orange', gruen: 'c-green', grau: 'c-gray' };

export const mNo = (n: number) => `M-${String(n).padStart(3, '0')}`;

export function StatusPill({ status }: { status: MangelStatus }) {
  return <span className={`pill ${STATUS_COLOR[status]}`}>{MANGEL_STATUS_LABELS[status]}</span>;
}

export function AmpelPill({ e }: { e: Mangel['escalation'] }) {
  return (
    <span className={`pill ${AMPEL_COLOR[e.ampel]}`}>
      <span className="dot" />
      {e.label}
    </span>
  );
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
