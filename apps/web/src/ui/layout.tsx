import { useEffect, type ReactNode } from 'react';

export type Run = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

export function PageHeader({ eyebrow, title, children, action }: { eyebrow: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="eyebrow">{eyebrow}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1>{title}</h1>
        {action}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </header>
  );
}

/** Modal sheet in the iPadOS style: Cancel · Title · Primary. Escape closes it. */
export function Sheet(props: { title: string; primary: string; primaryDisabled?: boolean; destructive?: boolean; wide?: boolean; onCancel: () => void; onPrimary: () => void; children: ReactNode }) {
  const { onCancel } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className={`sheet ${props.wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={props.title}>
        <div className="sheet-bar">
          <button className="btn plain" onClick={onCancel}>
            Abbrechen
          </button>
          <h3>{props.title}</h3>
          <button
            className={`btn plain right ${props.destructive ? 'destructive' : ''}`}
            style={{ fontWeight: 600 }}
            disabled={props.primaryDisabled}
            onClick={props.onPrimary}
          >
            {props.primary}
          </button>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}
