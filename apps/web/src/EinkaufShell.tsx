/**
 * Own layout for the Einkauf (decided 13.11.2026: every role gets a layout tailored to its work). The Einkauf lands
 * in the Einkaufsportal – the dashboard over all its sites – and opens single sites from there; a site shows what
 * the Einkauf works with: Bestellanforderungen and LV & Angebote. No project picker, no site modules it does not use.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Me, type ProjectInfo } from './api';
import { AusschreibungPage } from './Ausschreibung';
import { BestellungenPage, EinkaufsportalPage, MitteilungenPage } from './Bestellungen';
import { Icon } from './ui/Icon';
import { type Run } from './ui/layout';
import { initials } from './ui/status';

type View =
  | { kind: 'portal' }
  | { kind: 'mitteilungen' }
  | { kind: 'baustelle'; projectId: string; tab: 'anforderungen' | 'lv'; lv?: string | null; banf?: string | null };
type Toast = { kind: 'ok' | 'error'; text: string } | null;
interface Zahl { id: string; neu: number; dringend: number }

export function EinkaufShell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [view, setView] = useState<View>({ kind: 'portal' });
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [ungelesen, setUngelesen] = useState(0);
  const [zahlen, setZahlen] = useState<Zahl[]>([]);
  const [rev, setRev] = useState(0);

  const ladeZahlen = useCallback(async () => {
    try {
      const [n, p] = await Promise.all([api<{ n: number }>('/mitteilungen/anzahl'), api<{ baustellen: Zahl[] }>('/einkaufsportal')]);
      setUngelesen(n.n);
      setZahlen(p.baustellen);
    } catch { /* offline */ }
  }, []);
  useEffect(() => { void ladeZahlen(); const t = setInterval(() => void ladeZahlen(), 60_000); return () => clearInterval(t); }, [ladeZahlen]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const projectId = view.kind === 'baustelle' ? view.projectId : null;
  useEffect(() => {
    setInfo(null);
    if (projectId) void api<ProjectInfo>(`/projects/${projectId}`).then(setInfo);
  }, [projectId]);

  const run: Run = async (fn, ok) => {
    try {
      await fn();
      setToast({ kind: 'ok', text: ok });
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof ApiError ? e.message : String(e) });
    }
    void ladeZahlen();
  };
  const baustelle = (pid: string, tab: 'anforderungen' | 'lv' = 'anforderungen', extra: { lv?: string; banf?: string } = {}) => {
    setView({ kind: 'baustelle', projectId: pid, tab, lv: extra.lv ?? null, banf: extra.banf ?? null });
    setRev((r) => r + 1);
  };
  const item = (on: boolean, onClick: () => void, icon: Parameters<typeof Icon>[0]['name'], label: string, badge?: number) => (
    <button className={`side-item ${on ? 'active' : ''}`} onClick={onClick}>
      <Icon name={icon} />{label}{badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="app-icon">BA</div>
          <div><strong>Bau Akte Pro</strong><small>Einkauf</small></div>
        </div>
        {item(view.kind === 'portal', () => setView({ kind: 'portal' }), 'portal', 'Einkaufsportal')}
        {item(view.kind === 'mitteilungen', () => setView({ kind: 'mitteilungen' }), 'nachricht', 'Mitteilungen', ungelesen)}
        <div className="side-section">Baustellen</div>
        {me.projects.map((p) => {
          const z = zahlen.find((x) => x.id === p.id);
          return (
            <button key={p.id} className={`side-item ${projectId === p.id ? 'active' : ''}`} onClick={() => baustelle(p.id)}>
              <Icon name="firmen" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {z && z.neu > 0 && <span className={`badge ${z.dringend ? '' : 'neutral'}`}>{z.neu}</span>}
            </button>
          );
        })}
        <div className="sidebar-footer">
          <span className="avatar">{initials(me.user.name)}</span>
          <div className="who"><div>{me.user.name}</div><small>{me.user.company}</small></div>
          <button className="btn plain" onClick={onLogout} title="Abmelden" aria-label="Abmelden"><Icon name="abmelden" /></button>
        </div>
      </aside>

      <div className="content">
        {view.kind === 'portal' && <EinkaufsportalPage meId={me.user.id} run={run} onOpenLv={(lv, pid) => baustelle(pid, 'lv', { lv })} onOpenProject={(pid) => baustelle(pid)} />}
        {view.kind === 'mitteilungen' && (
          <MitteilungenPage onChange={() => void ladeZahlen()} onOpen={(m) => { if (m.project_id) baustelle(m.project_id, 'anforderungen', { banf: m.entity === 'bestellanforderung' ? m.entity_id ?? undefined : undefined }); }} />
        )}
        {view.kind === 'baustelle' && (!info ? <p className="loading">Baustelle wird geladen …</p> : (
          <>
            <div className="site-tabs">
              <button className="btn plain" onClick={() => setView({ kind: 'portal' })}>‹ Einkaufsportal</button>
              <div className="segmented">
                <button className={view.tab === 'anforderungen' ? 'on' : ''} onClick={() => setView({ ...view, tab: 'anforderungen', banf: null })}>Bestellanforderungen</button>
                <button className={view.tab === 'lv' ? 'on' : ''} onClick={() => setView({ ...view, tab: 'lv', lv: null })}>LV & Angebote</button>
              </div>
            </div>
            {view.tab === 'anforderungen'
              ? <BestellungenPage key={`b${rev}`} info={info} run={run} meId={me.user.id} openId={view.banf} onOpenLv={(lv) => baustelle(view.projectId, 'lv', { lv })} />
              : <AusschreibungPage key={`l${rev}${view.lv ?? ''}`} info={info} run={run} initialLv={view.lv} />}
          </>
        ))}
      </div>
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.kind === 'ok' && <Icon name="haken" size={18} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}
