// Simulated Insta360 camera (Open Spherical Camera API, as on X3/X4/X5 at 192.168.42.1) for testing the app
// without a real camera: node scripts/osc-kamera-simulator.mjs [bild.jpg] → http://localhost:8089
// Implements /osc/info, /osc/state, camera.takePicture (async with status polling), camera.setOptions/getOptions.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const BILD = process.argv[2];
if (!BILD) { console.error('Aufruf: node scripts/osc-kamera-simulator.mjs <360-grad-bild.jpg>'); process.exit(1); }
const bytes = readFileSync(BILD);
const PORT = Number(process.env.PORT ?? 8089);
let laufend = new Map(); let n = 0; let modus = 'image';

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json;charset=utf-8' }); res.end(JSON.stringify(body)); };
const lesen = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/osc/info') return json(res, 200, { manufacturer: 'Arashi Vision', model: 'Insta360 X4 (Simulator)', serialNumber: 'SIM0001', firmwareVersion: 'v1.0', api: ['/osc/info', '/osc/state', '/osc/commands/execute', '/osc/commands/status'], apiLevel: [2] });
  if (req.method === 'POST' && req.url === '/osc/state') return json(res, 200, { fingerprint: `FIG_${n}`, state: { batteryLevel: 0.82, storageUri: 'sd', _cardState: 'pass' } });
  if (req.method === 'GET' && req.url?.startsWith('/files/')) { res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': bytes.length }); return res.end(bytes); }
  if (req.method === 'POST' && req.url === '/osc/commands/execute') {
    const c = await lesen(req);
    if (c.name === 'camera.setOptions') { if (c.parameters?.options?.captureMode) modus = c.parameters.options.captureMode; return json(res, 200, { name: c.name, state: 'done' }); }
    if (c.name === 'camera.getOptions') return json(res, 200, { name: c.name, state: 'done', results: { options: { captureMode: modus } } });
    if (c.name === 'camera.takePicture') {
      if (modus !== 'image') return json(res, 400, { name: c.name, state: 'error', error: { code: 'disabledCommand', message: 'Kamera nicht im Fotomodus' } });
      const id = String(++n); laufend.set(id, Date.now() + 1500); // stitching in the camera takes a moment
      return json(res, 200, { name: c.name, state: 'inProgress', id, progress: { completion: 0 } });
    }
    return json(res, 400, { name: c.name, state: 'error', error: { code: 'unknownCommand', message: c.name } });
  }
  if (req.method === 'POST' && req.url === '/osc/commands/status') {
    const { id } = await lesen(req);
    const fertig = laufend.get(String(id));
    if (!fertig) return json(res, 400, { state: 'error', error: { code: 'invalidParameterValue', message: 'unbekannte id' } });
    if (Date.now() < fertig) return json(res, 200, { name: 'camera.takePicture', id, state: 'inProgress', progress: { completion: 0.5 } });
    return json(res, 200, { name: 'camera.takePicture', id, state: 'done', results: { fileUrl: `http://${req.headers.host}/files/IMG_${id}.jpg` } });
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`Insta360-Simulator auf http://localhost:${PORT}`));
