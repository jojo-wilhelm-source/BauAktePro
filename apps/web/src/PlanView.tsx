import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MANGEL_TONE, punktNo, PUNKT_TONE, type PunktStatus } from '@bap/domain';
import { getToken, type Mangel } from './api';
import { mNo } from './ui/status';

const PIN_SHAPE = 'M15 1C7.3 1 1 7 1 14.5 1 24 15 37 15 37s14-13 14-22.5C29 7 22.7 1 15 1Z';
const PinShape = ({ square }: { square?: boolean }) => (
  <svg viewBox="0 0 30 38" width="30" height="38">
    {square ? <path d="M3 2h24a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H20l-5 10-5-10H3a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="#fff" strokeWidth="2" /> : <path d={PIN_SHAPE} stroke="#fff" strokeWidth="2" />}
  </svg>
);

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** A Besprechungspunkt with a pin (square pin, so it is distinguishable from a Mangel). */
export interface PunktPin {
  id: string;
  number: number | null;
  text: string;
  status: PunktStatus;
  plan_id: string | null;
  pin_x: number | null;
  pin_y: number | null;
}

interface Props {
  planId: string;
  /** Changes when a new index is released, so the drawing is reloaded. */
  planIndex: string;
  maengel: Mangel[];
  punkte?: PunktPin[];
  selectedId: string | null;
  /** Position of an object being created or a pin being placed (shown in blue). */
  draft?: { page: number; x: number; y: number } | null;
  onSelect: (id: string) => void;
  onSelectPunkt?: (id: string) => void;
  /** Click on an empty spot: position relative to the page (0..1). */
  onPick?: (pos: { page: number; x: number; y: number }) => void;
}

/**
 * Renders page 1 of a plan with PDF.js and overlays pins (relative coordinates).
 * Colours by status (docs/fachkonzept/03): red open, orange in progress, green done, blue info.
 */
export function PlanView({ planId, planIndex, maengel, punkte = [], selectedId, draft, onSelect, onSelectPunkt, onPick }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSize(null);
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ url: `/api/plans/${planId}/file?v=${planIndex}`, httpHeaders: { authorization: `Bearer ${getToken()}` } }).promise;
        const page = await doc.getPage(1);
        const width = canvas.current?.parentElement?.parentElement?.clientWidth ?? 900;
        const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
        const c = canvas.current;
        if (!c || cancelled) return;
        const ratio = window.devicePixelRatio || 1;
        c.width = viewport.width * ratio;
        c.height = viewport.height * ratio;
        c.style.width = `${viewport.width}px`;
        c.style.height = `${viewport.height}px`;
        await page.render({ canvas: c, viewport, transform: [ratio, 0, 0, ratio, 0, 0] }).promise;
        setSize({ w: viewport.width, h: viewport.height });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, planIndex]);

  const pins = maengel.filter((m) => m.plan_id === planId && m.pin_x != null && m.pin_y != null);
  const punktPins = punkte.filter((p) => p.plan_id === planId && p.pin_x != null && p.pin_y != null);

  return (
    <div className="plan">
      {error && <p className="empty">Plan konnte nicht geladen werden: {error}</p>}
      <div
        className="plan-canvas"
        onClick={(e) => {
          if (!onPick || !size || e.target !== canvas.current) return;
          const r = canvas.current.getBoundingClientRect();
          onPick({ page: 1, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
        }}
      >
        <canvas ref={canvas} />
        {size &&
          pins.map((m) => (
            <button
              key={m.id}
              className={`pin c-${MANGEL_TONE[m.status]} ${m.id === selectedId ? 'selected' : ''}`}
              style={{ left: `${m.pin_x! * 100}%`, top: `${m.pin_y! * 100}%` }}
              title={`${mNo(m.number)} ${m.description}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(m.id);
              }}
            >
              <PinShape />
              <span>{m.number}</span>
            </button>
          ))}
        {size &&
          punktPins.map((p) => (
            <button
              key={p.id}
              className={`pin punkt c-${PUNKT_TONE[p.status]} ${p.id === selectedId ? 'selected' : ''}`}
              style={{ left: `${p.pin_x! * 100}%`, top: `${p.pin_y! * 100}%` }}
              title={`${punktNo(p.number)} ${p.text}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectPunkt?.(p.id);
              }}
            >
              <PinShape square />
              <span>{p.number ?? '•'}</span>
            </button>
          ))}
        {size && draft && (
          <span className="pin draft selected" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }}>
            <PinShape />
            <span>+</span>
          </span>
        )}
      </div>
    </div>
  );
}
