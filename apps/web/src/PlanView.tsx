import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getToken, type Mangel } from './api';
import { AMPEL_COLOR, mNo } from './ui/status';

const PIN_SHAPE = 'M15 1C7.3 1 1 7 1 14.5 1 24 15 37 15 37s14-13 14-22.5C29 7 22.7 1 15 1Z';
const PinShape = () => (
  <svg viewBox="0 0 30 38" width="30" height="38">
    <path d={PIN_SHAPE} stroke="#fff" strokeWidth="2" />
  </svg>
);

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  planId: string;
  maengel: Mangel[];
  selectedId: string | null;
  /** Position of a Mangel being created (shown as a blue pin). */
  draft?: { page: number; x: number; y: number } | null;
  onSelect: (id: string) => void;
  /** Click on an empty spot: position relative to the page (0..1). */
  onPick?: (pos: { page: number; x: number; y: number }) => void;
}

/** Renders page 1 of a plan with PDF.js and overlays Mängel pins (relative coordinates). */
export function PlanView({ planId, maengel, selectedId, draft, onSelect, onPick }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ url: `/api/plans/${planId}/file`, httpHeaders: { authorization: `Bearer ${getToken()}` } }).promise;
        const page = await doc.getPage(1);
        const width = canvas.current?.parentElement?.clientWidth ?? 900;
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
  }, [planId]);

  const pins = maengel.filter((m) => m.plan_id === planId && m.pin_x != null && m.pin_y != null);

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
              className={`pin ${AMPEL_COLOR[m.escalation.ampel]} ${m.id === selectedId ? 'selected' : ''}`}
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
