import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ADMIN_URL, connect } from './index';

const dir = fileURLToPath(new URL('../migrations', import.meta.url));
const sql = connect(ADMIN_URL, 1);
await sql`CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const done = new Set((await sql`SELECT name FROM schema_migration`).map((r) => r.name as string));
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  const body = await readFile(join(dir, file), 'utf8');
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`INSERT INTO schema_migration (name) VALUES (${file})`;
  });
  console.log(`applied ${file}`);
}
await sql.end();
