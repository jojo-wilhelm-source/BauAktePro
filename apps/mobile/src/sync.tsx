/**
 * Abgleich (docs/fachkonzept/05): the data comes via PowerSync, the files via offline.ts.
 * - Automatisch (default): connected whenever there is network; after each completed sync the missing
 *   files are downloaded and files that are no longer visible are removed.
 * - Nur per Klick: the device stays offline and only syncs on "Jetzt abgleichen" (upload first, then
 *   download, then files), e.g. to save mobile data.
 * Everything recorded offline stays in the local queue until it is uploaded; nothing is lost when the
 * app is closed in between.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePowerSync, useStatus } from '@powersync/react';
import type { PowerSyncDatabase } from '@powersync/react-native';
import { Connector } from './db';
import { uploadQueuedBelege, uploadQueuedFotos } from './fotoStore';
import { cleanup, collectJobs, downloadMissing, loadSyncMode, saveSyncMode, type SyncMode } from './offline';
import { freshSession, type Session } from './session';

interface SyncApi {
  mode: SyncMode;
  setMode: (m: SyncMode) => void;
  /** Full round trip: upload queue, download changes, photos/receipts, files. Resolves with an error text or null. */
  syncNow: () => Promise<string | null>;
  syncing: boolean;
  lastError: string | null;
  centerOpen: boolean;
  openCenter: (open: boolean) => void;
}
const Ctx = createContext<SyncApi | null>(null);
export const useSync = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('SyncProvider missing');
  return c;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the device is connected, the local queue is empty and a sync completed after `since`. */
async function waitForSync(db: PowerSyncDatabase, since: number, timeoutMs = 45000): Promise<string | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = db.currentStatus;
    const [{ n }] = await db.getAll<{ n: number }>('SELECT count(*) AS n FROM ps_crud');
    if (s.connected && n === 0 && s.lastSyncedAt && s.lastSyncedAt.getTime() >= since && !s.dataFlowStatus.downloading) return null;
    await sleep(500);
  }
  return db.currentStatus.connected ? 'Abgleich dauert länger als erwartet – läuft im Hintergrund weiter.' : 'Keine Verbindung zum Server. Die Änderungen bleiben auf dem Gerät und werden später übertragen.';
}

export function SyncProvider({ session, children }: { session: Session; children: ReactNode }) {
  const db = usePowerSync() as PowerSyncDatabase;
  const status = useStatus();
  const [mode, setModeState] = useState<SyncMode | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [centerOpen, openCenter] = useState(false);
  const deviceId = `ios-${session.userId.slice(-4)}`;
  const connector = useRef(new Connector(session, deviceId));

  useEffect(() => {
    void loadSyncMode().then(setModeState);
  }, []);

  // Automatic mode: stay connected. Manual mode: only during syncNow.
  useEffect(() => {
    if (!mode) return;
    if (mode === 'auto') void db.connect(connector.current);
    else void db.disconnect();
    return () => void db.disconnect();
  }, [mode, db]);

  /** Files after a sync: download what is missing; clean up only when the data is complete. */
  const syncFiles = useCallback(async () => {
    const jobs = await collectJobs(db);
    const s = await freshSession(session);
    await downloadMissing(jobs, s.token);
    if (db.currentStatus.hasSynced) cleanup(jobs);
  }, [db, session]);

  // Automatic mode: after every completed sync (and on reconnect) fetch the files.
  const lastSynced = status.lastSyncedAt?.getTime() ?? 0;
  useEffect(() => {
    if (mode === 'auto' && status.connected && lastSynced) void syncFiles();
  }, [mode, status.connected, lastSynced, syncFiles]);

  const syncNow = useCallback(async () => {
    if (syncing) return null;
    setSyncing(true);
    setLastError(null);
    const since = Date.now();
    try {
      if (!db.currentStatus.connected) await db.connect(connector.current);
      let err = await waitForSync(db, since);
      if (!err) {
        // Photos and receipts need the entries on the server first, so they go after the data.
        await uploadQueuedFotos(db, session);
        await uploadQueuedBelege(db, session);
        await syncFiles();
      }
      if (mode === 'manuell') await db.disconnect();
      setLastError(err);
      return err;
    } catch (e) {
      const err = `Abgleich fehlgeschlagen: ${String((e as Error).message ?? e)}`;
      setLastError(err);
      return err;
    } finally {
      setSyncing(false);
    }
  }, [db, mode, session, syncFiles, syncing]);

  const setMode = useCallback((m: SyncMode) => {
    setModeState(m);
    void saveSyncMode(m);
  }, []);

  return (
    <Ctx.Provider value={{ mode: mode ?? 'auto', setMode, syncNow, syncing, lastError, centerOpen, openCenter }}>{children}</Ctx.Provider>
  );
}
