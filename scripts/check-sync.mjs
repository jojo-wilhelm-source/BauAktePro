// Asks the PowerSync service what a given test user's device would receive. Usage: node scripts/check-sync.mjs elektro
const who = process.argv[2] ?? 'elektro';
const { token } = await fetch('http://localhost:3000/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${who}@example.test` }) }).then((r) => r.json());
const res = await fetch('http://localhost:8080/sync/stream', {
  method: 'POST',
  headers: { authorization: `Token ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ raw_data: true, include_checksum: true, streams: { include_defaults: true, subscriptions: [] } }),
});
if (!res.ok) { console.error(res.status, await res.text()); process.exit(1); }
const seen = {};
const reader = res.body.getReader();
let buf = '';
const dec = new TextDecoder();
const timer = setTimeout(() => reader.cancel(), 4000);
try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      for (const op of msg.data?.data ?? []) {
        if (op.op !== 'PUT') continue;
        const d = typeof op.data === 'string' ? JSON.parse(op.data) : op.data;
        (seen[op.object_type] ??= new Set()).add(op.object_type === 'mangel' ? `${d.number}: ${d.description}` : (d.name ?? d.text ?? op.object_id));
      }
      if (msg.checkpoint_complete) { clearTimeout(timer); reader.cancel(); }
    }
  }
} catch {}
console.log(`== ${who}`);
for (const [t, s] of Object.entries(seen)) console.log(`${t.padEnd(15)} ${[...s].join(' | ')}`);
