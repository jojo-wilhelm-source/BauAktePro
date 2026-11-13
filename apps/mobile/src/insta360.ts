/**
 * Insta360 directly from the app (decided 13.11.2026, docs/fachkonzept/16): the iPhone/iPad joins the camera's
 * Wi-Fi, the app triggers the shot over the official Open Spherical Camera API (X3, X4, X5, ONE RS …, address
 * 192.168.42.1) and downloads the finished 360° photo. Needs "in-camera stitching" switched on in the camera.
 * Works without internet (the camera's Wi-Fi is local). Bluetooth pairing would need the Insta360 SDK (D14).
 */
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';

const KEY = 'bap.kamera';
// Development: EXPO_PUBLIC_KAMERA_URL points to the simulated camera (scripts/osc-kamera-simulator.mjs).
export const STANDARD_ADRESSE = process.env.EXPO_PUBLIC_KAMERA_URL ?? 'http://192.168.42.1';

export async function kameraAdresse() { return (await SecureStore.getItemAsync(KEY)) ?? STANDARD_ADRESSE; }
export async function setKameraAdresse(a: string) { await SecureStore.setItemAsync(KEY, a.trim().replace(/\/$/, '') || STANDARD_ADRESSE); }

const HEADERS = { 'content-type': 'application/json;charset=utf-8', accept: 'application/json' };

async function anfrage<T>(basis: string, pfad: string, body?: unknown, ms = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(basis + pfad, { method: body === undefined ? 'GET' : 'POST', headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    const j = (await r.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (!r.ok || j.error) throw new Error(fehlertext(j.error?.code, j.error?.message));
    return j;
  } catch (e) {
    if ((e as Error).name === 'AbortError' || /Network request failed/i.test(String(e))) throw new Error('Keine Verbindung zur Kamera. Ist das iPhone/iPad mit dem WLAN der Insta360 verbunden?');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function fehlertext(code?: string, msg?: string) {
  if (code === 'disabledCommand') return 'Die Kamera ist nicht im Fotomodus – bitte an der Kamera auf Foto umstellen.';
  if (code === 'cameraInExclusiveUse') return 'Die Kamera ist gerade mit einer anderen App verbunden.';
  return msg ? `Kamera: ${msg}` : 'Die Kamera hat die Aufnahme abgelehnt.';
}

export interface KameraInfo { model: string; batterie: number | null }

/** Check the connection: model and battery. */
export async function verbinden(): Promise<KameraInfo> {
  const basis = await kameraAdresse();
  const info = await anfrage<{ model?: string; manufacturer?: string }>(basis, '/osc/info');
  const state = await anfrage<{ state?: { batteryLevel?: number } }>(basis, '/osc/state', {}).catch(() => ({ state: {} as { batteryLevel?: number } }));
  return { model: info.model ?? 'Insta360', batterie: state.state?.batteryLevel ?? null };
}

/**
 * Take a 360° photo and download it into the app (one request at a time, as the OSC API requires).
 * onStatus reports progress for the UI.
 */
export async function aufnehmen(onStatus: (s: string) => void): Promise<{ uri: string; takenAt: string; width: number; height: number }> {
  const basis = await kameraAdresse();
  onStatus('Fotomodus …');
  await anfrage(basis, '/osc/commands/execute', { name: 'camera.setOptions', parameters: { options: { captureMode: 'image' } } }).catch(() => undefined);
  onStatus('Auslösen …');
  const start = await anfrage<{ state: string; id?: string; results?: { fileUrl?: string } }>(basis, '/osc/commands/execute', { name: 'camera.takePicture' });
  let fileUrl = start.results?.fileUrl;
  const bis = Date.now() + 60_000;
  while (!fileUrl) {
    if (!start.id || Date.now() > bis) throw new Error('Die Kamera hat kein Foto geliefert (Zeitüberschreitung).');
    await new Promise((r) => setTimeout(r, 700));
    onStatus('Kamera setzt das 360°-Bild zusammen …');
    const s = await anfrage<{ state: string; results?: { fileUrl?: string } }>(basis, '/osc/commands/status', { id: start.id });
    if (s.state === 'done') fileUrl = s.results?.fileUrl;
  }
  onStatus('Foto wird übertragen …');
  const dir = new Directory(Paths.cache, 'insta360');
  dir.create({ idempotent: true, intermediates: true });
  const ziel = new File(dir, `${Date.now()}.jpg`);
  const datei = await File.downloadFileAsync(fileUrl, ziel, { idempotent: true });
  // Insta360 exports equirectangular 2:1 (X3 5760×2880, X4 up to 11904×5952); the server measures the real size.
  return { uri: datei.uri, takenAt: new Date().toISOString(), width: 5760, height: 2880 };
}
