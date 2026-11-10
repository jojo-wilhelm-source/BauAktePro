/**
 * Plans on the device (docs/fachkonzept/05-offline-sync.md): whenever the device is online, every plan
 * of the project is downloaded into the app's document folder. The plan view only reads local files,
 * so plans are available on site without network – even ones nobody has opened yet.
 * One file per plan and index: a new index is a new file; the old one stays until cleanup (later).
 */
import { useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { API_URL } from './config';
import { freshSession, type Session } from './session';

const dir = new Directory(Paths.document, 'plans');
const fileFor = (p: { id: string; plan_index: string }) => new File(dir, `${p.id}-${p.plan_index.replace(/[^a-z0-9]/gi, '')}.pdf`);

export type PlanFiles = Record<string, string>; // plan id → local file uri

function localFiles(plans: { id: string; plan_index: string }[]): PlanFiles {
  const out: PlanFiles = {};
  for (const p of plans) {
    const f = fileFor(p);
    if (f.exists) out[p.id] = f.uri;
  }
  return out;
}

export function usePlanFiles(plans: { id: string; plan_index: string }[], session: Session, online: boolean) {
  const key = plans.map((p) => `${p.id}:${p.plan_index}`).join(',');
  const [files, setFiles] = useState<PlanFiles>(() => localFiles(plans));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFiles(localFiles(plans));
    if (!online) return;
    const missing = plans.filter((p) => !fileFor(p).exists);
    if (!missing.length) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const s = await freshSession(session);
      dir.create({ idempotent: true, intermediates: true });
      for (const p of missing) {
        try {
          await File.downloadFileAsync(`${API_URL}/plans/${p.id}/file`, fileFor(p), { headers: { authorization: `Bearer ${s.token}` }, idempotent: true });
        } catch {
          // Next attempt on the next sync; the plan view says the plan is not on the device yet.
        }
        if (!cancelled) setFiles(localFiles(plans));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, online]); // eslint-disable-line react-hooks/exhaustive-deps

  return { files, loading };
}

/** Removes downloaded plans (on logout: device data belongs to the user). */
export function clearPlanFiles() {
  if (dir.exists) dir.delete();
}
