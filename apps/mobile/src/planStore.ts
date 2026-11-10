/**
 * Plans on the device (docs/fachkonzept/05-offline-sync.md). Downloading is done by offline.ts for all
 * projects; the plan view only reads local files, so plans work on site without network.
 */
import { useMemo } from 'react';
import { planFile, useOfflineState } from './offline';

export type PlanFiles = Record<string, string>; // plan id → local file uri

export function usePlanFiles(plans: { id: string; plan_index: string }[]) {
  const { version, running } = useOfflineState();
  const key = plans.map((p) => `${p.id}:${p.plan_index}`).join(',');
  const files = useMemo(() => {
    const out: PlanFiles = {};
    for (const p of plans) {
      const f = planFile(p);
      if (f.exists) out[p.id] = f.uri;
    }
    return out;
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return { files, loading: running };
}
