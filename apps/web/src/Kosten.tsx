/** Kostenübersicht je Gewerk (docs/fachkonzept/11): Budget, Auftrag, Nachträge, abgerechnet, Einkäufe, Prognose. Leitung only. */
import { useCallback, useEffect, useState } from 'react';
import { formatEuro } from '@bap/domain';
import { api, type ProjectInfo } from './api';
import { PageHeader, Sheet, type Run } from './ui/layout';

interface Row {
  gewerk_id: string; gewerk: string; budget: number | null; auftrag: number; nachtraegeBeauftragt: number; nachtraegeOffen: number; abgerechnet: number;
  rechnungenOffen: number; einkaeufe: number; prognose: number; mitOffenen: number; abweichung: number | null; restAuftrag: number; ampel: 'rot' | 'gelb' | 'gruen' | 'grau'; regieStunden: number;
}
const TONE = { rot: 'c-red', gelb: 'c-orange', gruen: 'c-green', grau: 'c-gray' } as const;
const AMPEL_TEXT = { rot: 'über Budget', gelb: 'knapp', gruen: 'im Budget', grau: 'kein Budget' } as const;

export function KostenPage({ info, run }: { info: ProjectInfo; run: Run }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [budget, setBudget] = useState<Row | null>(null);
  const reload = useCallback(async () => setRows((await api<{ rows: Row[] }>(`/projects/${info.project.id}/kosten`)).rows), [info.project.id]);
  useEffect(() => void reload(), [reload]);
  const total = (k: keyof Row) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const totalBudget = rows.some((r) => r.budget != null) ? total('budget') : null;
  const cols: [keyof Row, string][] = [['auftrag', 'Auftrag'], ['nachtraegeBeauftragt', 'Nachträge beauftragt'], ['einkaeufe', 'Einkäufe'], ['prognose', 'Prognose'], ['nachtraegeOffen', 'Nachträge offen'], ['abgerechnet', 'Abgerechnet'], ['restAuftrag', 'Rest']];

  return (
    <>
      <PageHeader eyebrow={info.project.name} title="Kosten">
        <span className="sub" style={{ fontSize: 13 }}>
          Budget {totalBudget != null ? formatEuro(totalBudget) : '–'} · Prognose {formatEuro(total('prognose'))} · abgerechnet {formatEuro(total('abgerechnet'))} (netto)
        </span>
      </PageHeader>
      <div className="list-pad" style={{ maxWidth: 1280 }}>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Gewerk</th><th className="money">Budget</th>{cols.map(([k, l]) => <th key={k} className="money">{l}</th>)}<th>Stand</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.gewerk_id || 'ohne'} onClick={() => r.gewerk_id && setBudget(r)} title={r.gewerk_id ? 'Klicken: Budget ändern' : undefined}>
                  <td><div className="desc">{r.gewerk}</div>{r.regieStunden > 0 && <div className="sub">{r.regieStunden.toLocaleString('de-DE')} h Regie anerkannt</div>}</td>
                  <td className="money">{r.budget != null ? formatEuro(r.budget) : <span className="sub">–</span>}</td>
                  {cols.map(([k]) => <td key={k} className="money" style={k === 'prognose' ? { fontWeight: 600 } : k === 'nachtraegeOffen' && r.nachtraegeOffen ? { color: 'var(--orange)' } : undefined}>{formatEuro(Number(r[k]))}</td>)}
                  <td>
                    <span className={`pill ${TONE[r.ampel]}`}><span className="dot" />{AMPEL_TEXT[r.ampel]}</span>
                    {r.abweichung != null && <div className="sub">{r.abweichung > 0 ? '+' : ''}{formatEuro(r.abweichung)}</div>}
                  </td>
                </tr>
              ))}
              <tr style={{ cursor: 'default', fontWeight: 600 }}>
                <td>Summe</td><td className="money">{totalBudget != null ? formatEuro(totalBudget) : '–'}</td>
                {cols.map(([k]) => <td key={k} className="money">{formatEuro(total(k))}</td>)}<td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="footnote">
          Prognose = Auftrag + beauftragte Nachträge + freigegebene Baustellen-Einkäufe. „Knapp“ ab 95 % des Budgets, „über Budget“, wenn die Prognose mit den offenen Nachträgen das Budget übersteigt.
          Quellen: Verträge (Nachunternehmer), Nachträge & Rechnungen, Einkäufe. Alle Beträge netto. Nur für Bau- und Projektleitung sichtbar.
        </div>
      </div>
      {budget && <BudgetSheet row={budget} onClose={() => setBudget(null)} onSave={(v) => run(async () => { await api(`/gewerke/${budget.gewerk_id}/budget`, { method: 'PUT', body: { budget_net: v } }); setBudget(null); await reload(); }, 'Budget gespeichert')} />}
    </>
  );
}

function BudgetSheet({ row, onClose, onSave }: { row: Row; onClose: () => void; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(row.budget != null ? String(row.budget).replace('.', ',') : '');
  const n = v === '' ? null : Number(v.replace(/\./g, '').replace(',', '.'));
  return (
    <Sheet title={`Budget ${row.gewerk}`} primary="Sichern" primaryDisabled={n != null && !(n >= 0)} onCancel={onClose} onPrimary={() => onSave(n)}>
      <div className="group"><div className="row"><span className="k">Budget netto (€)</span><input autoFocus inputMode="decimal" placeholder="leer = kein Budget" value={v} onChange={(e) => setV(e.target.value)} /></div></div>
    </Sheet>
  );
}
