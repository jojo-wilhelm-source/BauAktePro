/**
 * Rechte-Tests (CLAUDE.md, Arbeitsweise 2) – against the real local Postgres with RLS.
 * Requires: pnpm db:up && pnpm db:migrate. Every test run re-seeds the database.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect } from '@bap/db';
import { ID } from '@bap/db/seed-ids';
import { initKeys, issueToken } from '../src/auth';
import { buildApp } from '../src/app';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const sql = connect();
const app = buildApp(sql);
const tokens: Record<string, string> = {};

async function call(user: keyof typeof ID, method: 'GET' | 'POST' | 'PATCH', url: string, body?: object) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${tokens[user]}`, 'x-device-id': 'test' } });
  return { status: res.statusCode, body: res.json() as any };
}
const maengel = async (user: keyof typeof ID) => (await call(user, 'GET', `/projects/${ID.project}/maengel`)).body as any[];
const numbers = async (user: keyof typeof ID) => (await maengel(user)).map((m) => m.number).sort();

beforeAll(async () => {
  await initKeys();
  for (const u of ['uBauleitung', 'uPolier', 'uElektro', 'uFliesen', 'uBauherr'] as const) tokens[u] = await issueToken(ID[u]);
});
beforeEach(() => {
  execSync('pnpm --silent db:seed', { cwd: root, stdio: 'ignore' });
});
afterAll(async () => {
  await app.close();
  await sql.end();
});

describe('NU-Isolation', () => {
  it('NU sieht nur bestätigt zugewiesene Mängel des eigenen Gewerks', async () => {
    expect(await numbers('uElektro')).toEqual([2]); // #3 is assigned to Elektro but not yet confirmed
    expect(await numbers('uFliesen')).toEqual([1]);
  });
  it('NU kann fremden Mangel weder lesen noch ändern', async () => {
    const r = await call('uElektro', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'in_bearbeitung', base_version: 1 });
    expect(r.status).toBe(404); // RLS: row does not exist for him
  });
  it('NU sieht keine internen Notizen', async () => {
    const m = await maengel('uFliesen');
    expect(m[0].notes).toEqual([]);
    const direct = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uFliesen}, true)`;
      return tx`SELECT count(*)::int AS n FROM mangel_note`;
    });
    expect(direct[0]!.n).toBe(0);
  });
  it('NU hat keinen Zugriff auf fremde Projekte', async () => {
    const r = await call('uElektro', 'GET', `/projects/${ID.otherProject}/maengel`);
    expect(r.status).toBe(403);
  });
  it('NU kann einen Mangel melden, er erscheint erst nach Bestätigung beim anderen NU', async () => {
    const id = randomUUID();
    const r = await call('uFliesen', 'POST', '/maengel', {
      id, project_id: ID.project, location_id: ID.raumBad, gewerk_id: ID.gwElektro,
      description: 'Vorleistung: Leerrohr fehlt', assigned_company_id: ID.coElektro,
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('neu');
    expect(r.body.assignment_confirmed).toBe(false);
    expect((await maengel('uElektro')).some((m) => m.id === id)).toBe(false);
    const ok = await call('uBauleitung', 'POST', `/maengel/${id}/transition`, { to: 'zugewiesen', base_version: 1 });
    expect(ok.status).toBe(200);
    expect((await maengel('uElektro')).some((m) => m.id === id)).toBe(true);
  });
});

describe('Bauherr', () => {
  it('sieht freigegebene und eigene Mängel, keine internen', async () => {
    expect(await numbers('uBauherr')).toEqual([2, 3]);
  });
  it('Zuweisung durch den Bauherrn wird erst durch die Bauleitung wirksam (B1)', async () => {
    const r = await call('uBauherr', 'POST', `/maengel/${ID.mUnconfirmed}/transition`, { to: 'zugewiesen', base_version: 1 });
    expect(r.status).toBe(409);
    expect(r.body.kind).toBe('rejected');
  });
});

describe('Abnahme (B2)', () => {
  it('NU kann nicht abnehmen, Polier als Ersteller schon', async () => {
    await call('uFliesen', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'in_bearbeitung', base_version: 1 });
    await call('uFliesen', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'behoben_gemeldet', base_version: 2 });
    const nu = await call('uFliesen', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'abgenommen', base_version: 3 });
    expect(nu.body.kind).toBe('rejected');
    const polier = await call('uPolier', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'abgenommen', base_version: 3 });
    expect(polier.status).toBe(200);
    expect(polier.body.status).toBe('abgenommen');
  });
});

describe('Offline: Konflikte und vorgemerkte Entscheidungen', () => {
  it('veraltete Änderung überschreibt nicht still, sondern erzeugt einen Konflikt', async () => {
    const a = await call('uBauleitung', 'PATCH', `/maengel/${ID.mFliesen}`, { base_version: 1, description: 'Fuge gerissen (Bauleitung)' });
    expect(a.status).toBe(200);
    const b = await call('uPolier', 'PATCH', `/maengel/${ID.mFliesen}`, { base_version: 1, description: 'Fuge gerissen (Polier, offline)' });
    expect(b.status).toBe(409);
    expect(b.body.kind).toBe('conflict');
    const conflicts = (await call('uBauleitung', 'GET', `/projects/${ID.project}/conflicts`)).body;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].client_change.description).toContain('Polier');
    expect((await maengel('uBauleitung')).find((m) => m.id === ID.mFliesen).description).toBe('Fuge gerissen (Bauleitung)');
  });

  it('offline vorgemerkte Abnahme wird nur angewendet, wenn sich der Stand nicht geändert hat', async () => {
    await call('uFliesen', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'in_bearbeitung', base_version: 1 });
    await call('uFliesen', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'behoben_gemeldet', base_version: 2 });
    // Bauleitung decides offline on version 3 …; meanwhile the NU flags it as disputed (version 4).
    await call('uBauleitung', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'nicht_behoben', base_version: 3 });
    const upload = await call('uPolier', 'POST', '/sync/upload', {
      ops: [{ op: 'PUT', table: 'mangel_action', id: randomUUID(), data: {
        mangel_id: ID.mFliesen, action: 'transition', payload: JSON.stringify({ to: 'abgenommen' }), base_version: 3, occurred_at: '2026-11-04T08:00:00Z',
      } }],
    });
    expect(upload.body.results[0].ok).toBe(false);
    expect(upload.body.results[0].kind).toBe('conflict');
    expect(upload.body.results[0].reason).toContain('neu entscheiden');
  });

  it('Offline-Erfassung ist idempotent (doppelter Upload erzeugt keinen zweiten Mangel)', async () => {
    const id = randomUUID();
    const op = { op: 'PUT', table: 'mangel', id, data: { project_id: ID.project, location_id: ID.raumKueche, gewerk_id: ID.gwElektro, description: 'Offline erfasst', occurred_at: '2026-11-03T15:00:00Z' } };
    await call('uPolier', 'POST', '/sync/upload', { ops: [op] });
    await call('uPolier', 'POST', '/sync/upload', { ops: [op] });
    const all = await maengel('uPolier');
    expect(all.filter((m) => m.id === id)).toHaveLength(1);
    const log = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uBauleitung}, true)`;
      return tx`SELECT occurred_at, device_id FROM audit_log WHERE entity_id = ${id}`;
    });
    expect(log).toHaveLength(1);
    expect((log[0]!.occurred_at as Date).toISOString()).toBe('2026-11-03T15:00:00.000Z');
  });
});

describe('Upload aus der App (SQLite-Format)', () => {
  it('akzeptiert null-Werte und 0/1 statt Booleans, Server setzt Nummer und Status', async () => {
    const id = randomUUID();
    const r = await call('uElektro', 'POST', '/sync/upload', { ops: [{ op: 'PUT', table: 'mangel', id, data: {
      project_id: ID.project, location_id: ID.raumBad, gewerk_id: ID.gwFliesen, description: 'Vom iPad', priority: 'normal', status: 'abgenommen',
      plan_id: ID.planEg, pin_page: 1, pin_x: 0.5, pin_y: 0.5, assigned_company_id: ID.coFliesen, assignment_confirmed: 1, visible_to_bauherr: 1,
      due_date: null, nachfrist_date: null, number: null, version: 0, created_by: ID.uElektro, created_at: '2026-11-04T09:00:00Z',
    } }] });
    expect(r.body.results[0].ok).toBe(true);
    const m = r.body.results[0].mangel;
    expect(m.status).toBe('neu');                 // client cannot set status
    expect(m.assignment_confirmed).toBe(false);   // NU cannot confirm assignments
    expect(m.visible_to_bauherr).toBe(false);     // NU cannot release for Bauherr
    expect(m.number).toBe(4);
  });
});

describe('Audit Log', () => {
  it('ist für die API nicht änderbar oder löschbar', async () => {
    await expect(sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uBauleitung}, true)`;
      await tx`DELETE FROM audit_log`;
    })).rejects.toThrow(/permission denied/);
  });
});
