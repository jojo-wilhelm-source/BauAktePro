/**
 * Rechte-Tests (CLAUDE.md, Arbeitsweise 2) – against the real local Postgres with RLS.
 * Requires: pnpm db:up && pnpm db:migrate. Every test run re-seeds the database.
 */
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_URL, connect } from '@bap/db';
import { ID, TEST_PASSWORD } from '@bap/db/seed-ids';
import { initKeys, issueToken } from '../src/auth';
import { buildApp } from '../src/app';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const sql = connect();
const adminSql = connect(ADMIN_URL, 1);
const app = buildApp(sql);
const tokens: Record<string, string> = {};

async function call(user: keyof typeof ID, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: object) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${tokens[user]}`, 'x-device-id': 'test' } });
  return { status: res.statusCode, body: res.json() as any };
}
/** Multipart upload like the browser/app does it (fields first, then the file). */
async function upload(user: keyof typeof ID, url: string, fields: Record<string, string>, filename: string, bytes: Buffer) {
  const b = '----bap' + randomUUID();
  const parts = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
  const payload = Buffer.concat([Buffer.from(parts + `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${b}--\r\n`)]);
  const res = await app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': `multipart/form-data; boundary=${b}` } });
  return { status: res.statusCode, body: res.json() as any };
}
const tinyPdf = async () => {
  const { PDFDocument } = await import('pdf-lib');
  const d = await PDFDocument.create();
  d.addPage([200, 200]);
  return Buffer.from(await d.save());
};
const maengel = async (user: keyof typeof ID) => (await call(user, 'GET', `/projects/${ID.project}/maengel`)).body as any[];
const numbers = async (user: keyof typeof ID) => (await maengel(user)).map((m) => m.number).sort();

beforeAll(async () => {
  await initKeys();
  for (const u of ['uBauleitung', 'uPolier', 'uElektro', 'uFliesen', 'uBauherr', 'uProjektleitung', 'uAdmin', 'uEinkauf'] as const) tokens[u] = await issueToken(ID[u]);
});
beforeEach(() => {
  execSync('pnpm --silent db:seed', { cwd: root, stdio: 'ignore' });
});
afterAll(async () => {
  await app.close();
  await sql.end();
  await adminSql.end();
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

describe('Mangelanzeige', () => {
  const draft = (extra: object = {}) => ({
    id: randomUUID(), project_id: ID.project, company_id: ID.coFliesen, mangel_ids: [ID.mFliesen], deadline: '2026-11-24', ...extra,
  });
  const list = async (user: keyof typeof ID) => (await call(user, 'GET', `/projects/${ID.project}/mangelanzeigen`)).body as any[];

  it('nur die Bauleitung erstellt Anzeigen (Polier, NU, Bauherr nicht)', async () => {
    for (const u of ['uPolier', 'uFliesen', 'uBauherr'] as const) {
      expect((await call(u, 'POST', '/mangelanzeigen', draft())).status).toBe(403);
    }
    expect((await call('uBauleitung', 'POST', '/mangelanzeigen', draft())).status).toBe(200);
  });

  it('nur bestätigt zugewiesene Mängel desselben NU werden Positionen', async () => {
    expect((await call('uBauleitung', 'POST', '/mangelanzeigen', draft({ mangel_ids: [ID.mElektro] }))).status).toBe(422);
    expect((await call('uBauleitung', 'POST', '/mangelanzeigen', draft({ company_id: ID.coElektro, mangel_ids: [ID.mUnconfirmed] }))).status).toBe(422);
  });

  it('NU sieht keine Entwürfe, nach dem Versand nur die eigene Anzeige; Bauherr sieht keine', async () => {
    const d = draft();
    await call('uBauleitung', 'POST', '/mangelanzeigen', d);
    expect(await list('uFliesen')).toEqual([]);
    expect((await call('uFliesen', 'GET', `/mangelanzeigen/${d.id}`)).status).toBe(404);

    const sent = await call('uBauleitung', 'POST', `/mangelanzeigen/${d.id}/send`, { base_version: 1 });
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('versendet');
    expect(sent.body.number).toBe(1);
    expect(sent.body.recipient_email).toBe('buero@fliesen-fuchs.example.test');

    expect((await list('uFliesen')).map((a) => a.id)).toEqual([d.id]);
    expect(await list('uElektro')).toEqual([]);
    expect(await list('uBauherr')).toEqual([]);
  });

  it('Versand setzt die Frist der Mängel, protokolliert und legt die Mail ab', async () => {
    const d = draft();
    await call('uBauleitung', 'POST', '/mangelanzeigen', d);
    const sent = await call('uBauleitung', 'POST', `/mangelanzeigen/${d.id}/send`, { base_version: 1 });
    expect(sent.body.mail.devFile).toMatch(/storage\/outbox\/.*\.eml$/);
    const m = (await maengel('uBauleitung')).find((x) => x.id === ID.mFliesen);
    expect(String(m.due_date).slice(0, 10)).toBe('2026-11-24');
    expect(m.anzeige_number).toBe(1);
    const log = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uBauleitung}, true)`;
      return tx`SELECT entity, action FROM audit_log WHERE entity_id IN (${d.id}, ${ID.mFliesen}) ORDER BY id`;
    });
    expect(log.map((l) => `${l.entity}:${l.action}`)).toEqual(['mangelanzeige:erstellt', 'mangel:frist', 'mangelanzeige:versendet']);
  });

  it('versendete Anzeigen sind gesperrt (API und Datenbank)', async () => {
    const d = draft();
    await call('uBauleitung', 'POST', '/mangelanzeigen', d);
    await call('uBauleitung', 'POST', `/mangelanzeigen/${d.id}/send`, { base_version: 1 });
    expect((await call('uBauleitung', 'PATCH', `/mangelanzeigen/${d.id}`, { base_version: 2, deadline: '2027-01-01' })).status).toBe(409);
    expect((await call('uBauleitung', 'POST', `/mangelanzeigen/${d.id}/send`, { base_version: 2 })).status).toBe(409);
    const changed = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uBauleitung}, true)`;
      await tx`SET LOCAL ROLE bap_app`;
      return tx`UPDATE mangelanzeige SET note = 'still geändert' WHERE id = ${d.id}`;
    });
    expect(changed.count).toBe(0); // RLS: sent rows are not updatable
  });

  it('Entwurf als PDF mit Wasserzeichen abrufbar', async () => {
    const d = draft();
    await call('uBauleitung', 'POST', '/mangelanzeigen', d);
    const res = await app.inject({ method: 'GET', url: `/mangelanzeigen/${d.id}/pdf`, headers: { authorization: `Bearer ${tokens.uBauleitung}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('Pläne: Index, Freigabe, QR-Prüfung', () => {
  const plaene = async (user: keyof typeof ID) => (await call(user, 'GET', `/projects/${ID.project}/plaene`)).body.plans as any[];
  const upload = async (user: keyof typeof ID, fields: Record<string, string>) => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.addPage([600, 400]);
    const pdf = Buffer.from(await doc.save());
    const b = '----bap' + randomUUID();
    const parts = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
    const payload = Buffer.concat([Buffer.from(parts + `--${b}\r\nContent-Disposition: form-data; name="file"; filename="plan.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${b}--\r\n`)]);
    const res = await app.inject({ method: 'POST', url: '/plan-revisions', payload, headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': `multipart/form-data; boundary=${b}` } });
    return { status: res.statusCode, body: res.json() as any };
  };

  it('NU sieht nur den freigegebenen Stand, nicht den Eingang', async () => {
    const nu = await plaene('uElektro');
    expect(nu[0].revisions.map((r: any) => r.plan_index)).toEqual(['A']);
    const intern = await plaene('uPolier');
    expect(intern[0].revisions.map((r: any) => `${r.plan_index}:${r.status}`).sort()).toEqual(['A:freigegeben', 'B:zur_pruefung']);
  });

  it('nur die Bauleitung gibt frei; alter Index wird „Ersetzt“, QR-Prüfung meldet „veraltet“', async () => {
    expect((await call('uPolier', 'POST', `/plan-revisions/${ID.revEgB}/decision`, { decision: 'freigeben', base_version: 1 })).status).toBe(403);
    const ok = await call('uBauleitung', 'POST', `/plan-revisions/${ID.revEgB}/decision`, { decision: 'freigeben', base_version: 1 });
    expect(ok.status).toBe(200);
    const p = (await plaene('uBauleitung'))[0];
    expect(p.plan_index).toBe('B');
    expect(p.revisions.find((r: any) => r.plan_index === 'A').status).toBe('ersetzt');
    expect((await plaene('uElektro'))[0].revisions.map((r: any) => r.plan_index)).toEqual(['B']);
    const check = await call('uPolier', 'GET', `/plan-revisions/${ID.revEgA}/check`);
    expect(check.body.is_current).toBe(false);
    expect(check.body.current_index).toBe('B');
    expect((await call('uPolier', 'GET', `/plan-revisions/${ID.revEgB}/check`)).body.is_current).toBe(true);
  });

  it('Ablehnen braucht einen Grund', async () => {
    expect((await call('uBauleitung', 'POST', `/plan-revisions/${ID.revEgB}/decision`, { decision: 'ablehnen', base_version: 1 })).status).toBe(422);
  });

  it('Upload landet immer in „Zur Prüfung“ mit nächstem Index; NU darf nicht hochladen', async () => {
    const up = await upload('uPolier', { project_id: ID.project, plan_id: ID.planEg, comment: 'Test' });
    expect(up.status).toBe(200);
    expect(up.body.plan_index).toBe('C');
    expect((await upload('uElektro', { project_id: ID.project, plan_id: ID.planEg })).status).toBe(403);
  });

  it('Ausdruck mit QR-Code als PDF', async () => {
    const res = await app.inject({ method: 'GET', url: `/plan-revisions/${ID.revEgA}/pdf`, headers: { authorization: `Bearer ${tokens.uPolier}` } });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('NU-Besprechung', () => {
  const nextMeeting = (user: keyof typeof ID, extra: object = {}) =>
    call(user, 'POST', '/besprechungen', { id: randomUUID(), project_id: ID.project, held_at: '2026-11-10T09:00:00+01:00', previous_id: ID.bespr1, ...extra });
  const nums = (d: any) => d.punkte.map((p: any) => p.number).sort((a: number, b: number) => a - b);

  it('NU sieht alle nicht internen Punkte der versendeten Besprechung, eigene markiert', async () => {
    const el = (await call('uElektro', 'GET', `/besprechungen/${ID.bespr1}`)).body;
    expect(nums(el)).toEqual([1, 2, 3, 4]); // P-005 is internal
    expect(el.punkte.filter((p: any) => p.mine).map((p: any) => p.number).sort()).toEqual([1, 2]); // P-001 Zuarbeit, P-002 verantwortlich
    const fl = (await call('uFliesen', 'GET', `/besprechungen/${ID.bespr1}`)).body;
    expect(fl.punkte.filter((p: any) => p.mine).map((p: any) => p.number)).toEqual([1]);
    expect(nums((await call('uPolier', 'GET', `/besprechungen/${ID.bespr1}`)).body)).toEqual([1, 2, 3, 4, 5]);
    expect((await call('uBauherr', 'GET', `/besprechungen/${ID.bespr1}`)).status).toBe(404); // not a participant
  });

  it('Folgesitzung: alle aktiven Punkte wandern mit, nur Erledigt nicht; Teilnehmer und allgemeine Infos übernommen', async () => {
    expect((await nextMeeting('uElektro')).status).toBe(403);
    const r = await nextMeeting('uPolier');
    expect(r.status).toBe(200);
    expect(r.body.number).toBe(2);
    const d = (await call('uPolier', 'GET', `/besprechungen/${r.body.id}`)).body;
    expect(nums(d)).toEqual([1, 2, 4, 5]);
    expect(d.allgemein).toHaveLength(2);
    expect(d.punkte.every((p: any) => p.carried)).toBe(true);
    expect(d.teilnehmer).toHaveLength(3);
  });

  it('Entwurf ist für NU unsichtbar; nach Versand sieht der NU neue Punkte; nur Bauleitung versendet', async () => {
    const r = await nextMeeting('uPolier');
    const id = randomUUID();
    await call('uPolier', 'POST', '/punkte', { id, besprechung_id: r.body.id, location_id: ID.eg, gewerk_id: ID.gwElektro, text: 'Steckdosen Bad versetzen', responsible_company_id: ID.coElektro });
    expect((await call('uElektro', 'GET', `/besprechungen/${r.body.id}`)).status).toBe(404);
    expect((await call('uPolier', 'POST', `/besprechungen/${r.body.id}/send`, { base_version: 1 })).status).toBe(403);
    const sent = await call('uBauleitung', 'POST', `/besprechungen/${r.body.id}/send`, { base_version: 1 });
    expect(sent.status).toBe(200);
    expect(sent.body.mails.map((m: any) => m.company).sort()).toEqual(['Elektro Blitz GmbH', 'Fliesen Fuchs GmbH']);
    expect(nums((await call('uElektro', 'GET', `/besprechungen/${r.body.id}`)).body)).toEqual([1, 2, 4, 6]);
    const fl = (await call('uFliesen', 'GET', `/besprechungen/${r.body.id}`)).body;
    expect(nums(fl)).toEqual([1, 2, 4, 6]);
    expect(fl.punkte.filter((p: any) => p.mine).map((p: any) => p.number)).toEqual([1]);
  });

  it('versendete Besprechung ist gesperrt (API und Datenbank)', async () => {
    const add = await call('uPolier', 'POST', '/punkte', { id: randomUUID(), besprechung_id: ID.bespr1, text: 'zu spät' });
    expect(add.status).toBe(409);
    const changed = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uBauleitung}, true)`;
      await tx`SET LOCAL ROLE bap_app`;
      return tx`UPDATE besprechung SET title = 'still geändert' WHERE id = ${ID.bespr1}`;
    });
    expect(changed.count).toBe(0);
  });

  it('Status-Chip offline vom iPad: veralteter Stand erzeugt Konflikt statt still zu überschreiben', async () => {
    const ok = await call('uBauleitung', 'PATCH', `/punkte/${ID.p2}`, { base_version: 1, status: 'in_arbeit' });
    expect(ok.status).toBe(200);
    const up = await call('uPolier', 'POST', '/sync/upload', { ops: [{ op: 'PUT', table: 'punkt_action', id: randomUUID(), data: {
      punkt_id: ID.p2, payload: JSON.stringify({ status: 'erledigt' }), base_version: 1, occurred_at: '2026-11-10T08:00:00Z' } }] });
    expect(up.body.results[0].ok).toBe(false);
    expect(up.body.results[0].kind).toBe('conflict');
    const fresh = await call('uPolier', 'POST', '/sync/upload', { ops: [{ op: 'PUT', table: 'punkt_action', id: randomUUID(), data: {
      punkt_id: ID.p2, payload: JSON.stringify({ status: 'erledigt' }), base_version: 2 } }] });
    expect(fresh.body.results[0].ok).toBe(true);
  });

  it('NU bekommt als PDF nur die eigene Aufgabenliste', async () => {
    const res = await app.inject({ method: 'GET', url: `/besprechungen/${ID.bespr1}/pdf`, headers: { authorization: `Bearer ${tokens.uFliesen}` } });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('Projektleitung = gleiche Rechte wie Bauleitung', () => {
  it('gibt Pläne frei, sieht interne Notizen und Einreichungen, entscheidet Stunden', async () => {
    expect((await call('uProjektleitung', 'POST', `/plan-revisions/${ID.revEgB}/decision`, { decision: 'freigeben', base_version: 1 })).status).toBe(200);
    expect((await maengel('uProjektleitung')).find((m) => m.id === ID.mFliesen).notes).toHaveLength(1);
    expect((await call('uProjektleitung', 'GET', `/projects/${ID.project}/einreichungen`)).body.einreichungen).toHaveLength(2);
    expect((await call('uProjektleitung', 'POST', `/stundenzettel/${ID.szElektro}/decision`, { decision: 'bestaetigen', base_version: 1 })).status).toBe(200);
  });
});

describe('Dokumente: Ordner, Alt, Sichtbarkeit', () => {
  const tree = async (u: keyof typeof ID) => (await call(u, 'GET', `/projects/${ID.project}/dokumente`)).body;
  it('NU sieht nur freigegebene Ordner und nur den aktuellen Stand; Bauherr nur Pläne/Architektur', async () => {
    const nu = await tree('uElektro');
    expect(nu.folders.map((f: any) => f.name).sort()).toEqual(['Architektur', 'Pläne', 'Statik', 'Tragwerk']);
    const statik = nu.items.find((i: any) => i.id === ID.docStatik);
    expect(statik.revisions.map((r: any) => r.label)).toEqual(['Version 2']); // "Alt" (Version 1) stays internal
    expect(nu.items.some((i: any) => i.id === ID.docBrandschutz)).toBe(false);
    const bh = await tree('uBauherr');
    expect(bh.folders.map((f: any) => f.name).sort()).toEqual(['Architektur', 'Pläne']);
    const intern = await tree('uPolier');
    expect(intern.items.find((i: any) => i.id === ID.docStatik).revisions.map((r: any) => r.status)).toEqual(['freigegeben', 'ersetzt']);
  });
  it('QR-Prüfung meldet die alte Statik als veraltet', async () => {
    const c = await call('uPolier', 'GET', `/plan-revisions/${ID.docStatikV1}/check`);
    expect(c.body.is_current).toBe(false);
    expect(c.body.current_index).toBe('2');
    expect((await call('uPolier', 'GET', `/plan-revisions/${ID.docStatikV2}/check`)).body.is_current).toBe(true);
  });
  it('neue Version landet in „Zur Prüfung“; Freigabe schiebt die alte nach „Alt“; NU darf nicht hochladen', async () => {
    const pdf = await tinyPdf();
    expect((await upload('uElektro', '/document-revisions', { project_id: ID.project, document_id: ID.docStatik }, 'statik.pdf', pdf)).status).toBe(403);
    const up = await upload('uPolier', '/document-revisions', { project_id: ID.project, document_id: ID.docStatik }, 'statik-v3.pdf', pdf);
    expect(up.body.version_label).toBe('3');
    expect((await call('uPolier', 'POST', `/document-revisions/${up.body.revision_id}/decision`, { decision: 'freigeben', base_version: 1 })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', `/document-revisions/${up.body.revision_id}/decision`, { decision: 'freigeben', base_version: 1 })).status).toBe(200);
    const revs = (await tree('uPolier')).items.find((i: any) => i.id === ID.docStatik).revisions;
    expect(revs.map((r: any) => `${r.label}:${r.status}`)).toEqual(['Version 3:freigegeben', 'Version 2:ersetzt', 'Version 1:ersetzt']);
  });
});

describe('Stundenzettel', () => {
  const zettel = (company: string, extra: object = {}) => ({
    id: randomUUID(), project_id: ID.project, company_id: company, period_from: '2026-11-09', period_to: '2026-11-13',
    zeilen: [{ id: randomUUID(), datum: '2026-11-10', person: 'A. Helfer', von: '07:00', bis: '15:30', pause_min: 30, stunden: 8, taetigkeit: 'Aufräumen', bezug: 'regie' }],
    ...extra,
  });
  const list = async (u: keyof typeof ID) => (await call(u, 'GET', `/projects/${ID.project}/stundenzettel`)).body.zettel ?? [];

  it('NU sieht nur eigene Zettel; Bauherr hat keinen Zugriff', async () => {
    expect((await list('uFliesen'))).toEqual([]);
    expect((await list('uElektro')).map((z: any) => z.id)).toEqual([ID.szElektro]);
    expect((await call('uFliesen', 'GET', `/stundenzettel/${ID.szElektro}`)).status).toBe(404);
    expect((await call('uBauherr', 'PUT', '/stundenzettel', zettel(ID.coBauherr))).status).toBe(403);
  });
  it('NU reicht nur für die eigene Firma ein; Polier auch für Helfer anderer Firmen', async () => {
    expect((await call('uFliesen', 'PUT', '/stundenzettel', zettel(ID.coElektro))).status).toBe(403);
    expect((await call('uPolier', 'PUT', '/stundenzettel', zettel(ID.coOwn))).status).toBe(200);
  });
  it('eingereicht ist gesperrt; nur die Leitung entscheidet; Kürzen braucht Begründung', async () => {
    const z = zettel(ID.coFliesen);
    expect((await call('uFliesen', 'PUT', '/stundenzettel', z)).body.hours_total).toBe('8.00');
    expect((await call('uFliesen', 'POST', `/stundenzettel/${z.id}/submit`, { base_version: 1 })).status).toBe(200);
    expect((await call('uFliesen', 'PUT', '/stundenzettel', z)).status).toBe(409);
    expect((await call('uPolier', 'POST', `/stundenzettel/${z.id}/decision`, { decision: 'bestaetigen', base_version: 2 })).status).toBe(403);
    expect((await call('uFliesen', 'POST', `/stundenzettel/${z.id}/decision`, { decision: 'bestaetigen', base_version: 2 })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', `/stundenzettel/${z.id}/decision`, { decision: 'kuerzen', base_version: 2, zeilen: [{ id: z.zeilen[0]!.id, stunden_anerkannt: 6 }] })).status).toBe(422);
    const ok = await call('uBauleitung', 'POST', `/stundenzettel/${z.id}/decision`, { decision: 'kuerzen', reason: 'Pause 2 h laut Tagesbericht', base_version: 2, zeilen: [{ id: z.zeilen[0]!.id, stunden_anerkannt: 6 }] });
    expect(ok.body.status).toBe('gekuerzt');
    expect(Number(ok.body.hours_approved)).toBe(6);
    const seen = (await call('uFliesen', 'GET', `/stundenzettel/${z.id}`)).body;
    expect(seen.decision_reason).toBe('Pause 2 h laut Tagesbericht');
  });
});

describe('NU-Einreichungen: Nachträge und Rechnungen', () => {
  const list = async (u: keyof typeof ID) => (await call(u, 'GET', `/projects/${ID.project}/einreichungen`));
  it('NU sieht nur eigene; Polier und Bauherr sehen keine (Preise)', async () => {
    expect((await list('uElektro')).body.einreichungen.map((e: any) => e.id)).toEqual([ID.ezNachtrag]);
    expect((await list('uFliesen')).body.einreichungen.map((e: any) => e.id)).toEqual([ID.ezRechnung]);
    expect((await list('uPolier')).status).toBe(403);
    expect((await list('uBauherr')).status).toBe(403);
  });
  it('NU lädt Rechnung hoch; Leitung gibt frei; großer Nachtrag braucht die GF; Ablehnen nur mit Grund', async () => {
    const pdf = await tinyPdf();
    const r = await upload('uFliesen', '/einreichungen', { project_id: ID.project, kind: 'rechnung', rechnung_art: 'abschlag', title: '2. AR', amount_net: '8000' }, 'ar2.pdf', pdf);
    expect(r.status).toBe(200);
    expect((await call('uFliesen', 'POST', `/einreichungen/${r.body.id}/decision`, { decision: 'freigeben', base_version: 1 })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', `/einreichungen/${r.body.id}/decision`, { decision: 'freigeben', base_version: 1 })).body.status).toBe('freigegeben');
    const big = await upload('uElektro', '/einreichungen', { project_id: ID.project, kind: 'nachtrag', title: 'NT 02', amount_net: '60000' }, 'nt2.pdf', pdf);
    expect((await call('uProjektleitung', 'POST', `/einreichungen/${big.body.id}/decision`, { decision: 'freigeben', base_version: 1 })).body.status).toBe('gf_erforderlich');
    expect((await call('uBauleitung', 'POST', `/einreichungen/${ID.ezNachtrag}/decision`, { decision: 'ablehnen', base_version: 1 })).status).toBe(422);
  });
});

describe('Nachträge und Rechnungen: getrennt nummeriert, Entscheidung revidierbar', () => {
  it('Nachträge und Rechnungen haben eigene Nummernkreise', async () => {
    const pdf = await tinyPdf();
    const re = await upload('uFliesen', '/einreichungen', { project_id: ID.project, kind: 'rechnung', rechnung_art: 'abschlag', title: '2. AR', amount_net: '1000' }, 'ar2.pdf', pdf);
    const nt = await upload('uElektro', '/einreichungen', { project_id: ID.project, kind: 'nachtrag', title: 'NT 02', amount_net: '500' }, 'nt2.pdf', pdf);
    expect(re.body.number).toBe(2);
    expect(nt.body.number).toBe(2);
  });
  it('Leitung nimmt eine Freigabe mit Grund zurück; NU zieht nur unbearbeitete Einreichungen zurück', async () => {
    const ok = await call('uBauleitung', 'POST', `/einreichungen/${ID.ezNachtrag}/decision`, { decision: 'freigeben', base_version: 1 });
    expect(ok.body.status).toBe('freigegeben');
    expect((await call('uBauleitung', 'POST', `/einreichungen/${ID.ezNachtrag}/decision`, { decision: 'zuruecknehmen', base_version: 2 })).status).toBe(422);
    expect((await call('uElektro', 'POST', `/einreichungen/${ID.ezNachtrag}/decision`, { decision: 'zuruecknehmen', reason: 'x', base_version: 2 })).status).toBe(403);
    const back = await call('uBauleitung', 'POST', `/einreichungen/${ID.ezNachtrag}/decision`, { decision: 'zuruecknehmen', reason: 'Falsch geklickt', base_version: 2 });
    expect(back.body.status).toBe('in_pruefung');
    const [log] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uBauleitung}, true)`;
      return tx`SELECT action FROM audit_log WHERE entity_id = ${ID.ezNachtrag} ORDER BY id DESC LIMIT 1`;
    });
    expect(log!.action).toBe('entscheidung_zurueckgenommen');
    // Already in Prüfung: the NU can no longer withdraw it.
    expect((await call('uElektro', 'POST', `/einreichungen/${ID.ezNachtrag}/decision`, { decision: 'zurueckziehen', base_version: 3 })).status).toBe(409);
    const pdf = await tinyPdf();
    const nt = await upload('uElektro', '/einreichungen', { project_id: ID.project, kind: 'nachtrag', title: 'NT 03', amount_net: '100' }, 'nt3.pdf', pdf);
    expect((await call('uFliesen', 'POST', `/einreichungen/${nt.body.id}/decision`, { decision: 'zurueckziehen', base_version: 1 })).status).toBe(404);
    expect((await call('uElektro', 'POST', `/einreichungen/${nt.body.id}/decision`, { decision: 'zurueckziehen', base_version: 1 })).body.status).toBe('zurueckgezogen');
  });
});

describe('Dokumente: Ordner anlegen und einfacher Upload', () => {
  it('Leitung legt Ordner an (Regression RLS), Unterordner erbt „Pläne“; Polier und NU nicht', async () => {
    const f = await call('uBauleitung', 'POST', '/folders', { project_id: ID.project, parent_id: ID.fPlaene, name: 'Haustechnik' });
    expect(f.status).toBe(200);
    expect(f.body.kind).toBe('plaene');
    expect((await call('uProjektleitung', 'POST', '/folders', { project_id: ID.project, name: 'Gutachten' })).body.kind).toBe('dokumente');
    expect((await call('uPolier', 'POST', '/folders', { project_id: ID.project, name: 'X' })).status).toBe(403);
    expect((await call('uElektro', 'POST', '/folders', { project_id: ID.project, name: 'X' })).status).toBe(403);
  });
  it('PDF im Planordner wird ein Plan (unter „Pläne“), gleicher Name = neuer Index; sonst Dokument', async () => {
    const pdf = await tinyPdf();
    const neu = await upload('uPolier', '/dokumente/upload', { project_id: ID.project, folder_id: ID.fArchitektur }, 'Grundriss OG 1_Index_A.pdf', pdf);
    expect(neu.body).toMatchObject({ type: 'plan', name: 'Grundriss OG 1', label: 'Index A', isNew: true });
    const again = await upload('uPolier', '/dokumente/upload', { project_id: ID.project, folder_id: ID.fArchitektur }, 'Grundriss OG 1 Index B.pdf', pdf);
    expect(again.body).toMatchObject({ type: 'plan', isNew: false, label: 'Index B' });
    const doc = await upload('uPolier', '/dokumente/upload', { project_id: ID.project, folder_id: ID.fNachweise }, 'Wärmeschutznachweis.pdf', pdf);
    expect(doc.body).toMatchObject({ type: 'document', name: 'Wärmeschutznachweis', isNew: true });
    expect((await upload('uElektro', '/dokumente/upload', { project_id: ID.project, folder_id: ID.fArchitektur }, 'x.pdf', pdf)).status).toBe(403);
    // The new plan shows up in the project's plan list, with its folder.
    const plans = (await call('uPolier', 'GET', `/projects/${ID.project}`)).body.plans as any[];
    expect(plans.find((p) => p.name === 'Grundriss OG 1')?.folder_name).toBe('Architektur');
  });
});

describe('Nachunternehmer und Kosten: Preissperre', () => {
  it('NU-Verzeichnis: Leitung sieht Verträge, NU nur sich selbst ohne Preise, Bauherr keinen Zugriff', async () => {
    const bl = (await call('uBauleitung', 'GET', `/projects/${ID.project}/nachunternehmer`)).body.nu as any[];
    expect(bl.map((n) => n.name)).toEqual(['Elektro Blitz GmbH', 'Fliesen Fuchs GmbH']);
    expect(bl[0].auftrag).toBe(86500);
    const nu = (await call('uElektro', 'GET', `/projects/${ID.project}/nachunternehmer`)).body.nu as any[];
    expect(nu.map((n) => n.name)).toEqual(['Elektro Blitz GmbH']);
    expect(nu[0].auftrag).toBeNull();
    expect(nu[0].vertraege).toEqual([]);
    const polier = (await call('uPolier', 'GET', `/projects/${ID.project}/nachunternehmer`)).body.nu as any[];
    expect(polier.every((n) => n.auftrag === null)).toBe(true);
    expect((await call('uBauherr', 'GET', `/projects/${ID.project}/nachunternehmer`)).status).toBe(403);
  });
  it('NU anlegen und Vertrag erfassen nur durch die Leitung', async () => {
    const id = randomUUID();
    expect((await call('uPolier', 'PUT', '/nachunternehmer', { id, project_id: ID.project, name: 'Maler Meier', gewerk_ids: [] })).status).toBe(403);
    expect((await call('uBauleitung', 'PUT', '/nachunternehmer', { id, project_id: ID.project, name: 'Maler Meier', gewerk_ids: [ID.gwFliesen] })).status).toBe(200);
    expect((await call('uElektro', 'POST', '/vertraege', { project_id: ID.project, company_id: id, title: 'X', amount_net: 1 })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', '/vertraege', { project_id: ID.project, company_id: id, title: 'Malerarbeiten', amount_net: 12000, gewerk_id: ID.gwFliesen })).status).toBe(200);
    const nu = (await call('uBauleitung', 'GET', `/projects/${ID.project}/nachunternehmer`)).body.nu as any[];
    expect(nu.find((n) => n.id === id)?.auftrag).toBe(12000);
  });
  it('Kostenübersicht nur für Bau- und Projektleitung', async () => {
    expect((await call('uProjektleitung', 'GET', `/projects/${ID.project}/kosten`)).status).toBe(200);
    for (const u of ['uPolier', 'uElektro', 'uBauherr'] as const) expect((await call(u, 'GET', `/projects/${ID.project}/kosten`)).status).toBe(403);
    expect((await call('uPolier', 'PUT', `/gewerke/${ID.gwElektro}/budget`, { budget_net: 1 })).status).toBe(403);
  });
});

describe('Baustellen-Einkäufe', () => {
  const einkauf = (extra: object = {}) => ({ id: randomUUID(), project_id: ID.project, gekauft_von: 'Paul Polier', datum: '2026-11-10', haendler: 'Hornbach', betrag_brutto: 19.9, zweck: 'Kabelbinder', ...extra });
  it('Polier sieht eigene, Leitung alle; NU und Bauherr weder lesen noch erfassen', async () => {
    expect((await call('uPolier', 'POST', '/einkaeufe', einkauf())).status).toBe(200);
    const bl = (await call('uBauleitung', 'GET', `/projects/${ID.project}/einkaeufe`)).body.einkaeufe as any[];
    expect(bl.length).toBe(3);
    const own = await call('uBauleitung', 'POST', '/einkaeufe', einkauf({ gekauft_von: 'Bea' }));
    expect(own.status).toBe(200);
    expect(((await call('uPolier', 'GET', `/projects/${ID.project}/einkaeufe`)).body.einkaeufe as any[]).length).toBe(3); // not Bea's
    for (const u of ['uElektro', 'uBauherr'] as const) {
      expect((await call(u, 'GET', `/projects/${ID.project}/einkaeufe`)).status).toBe(403);
      expect((await call(u, 'POST', '/einkaeufe', einkauf())).status).toBe(403);
    }
  });
  it('Offline doppelt hochgeladen: nur ein Einkauf, Nummer vom Server', async () => {
    const e = einkauf();
    const a = await call('uPolier', 'POST', '/einkaeufe', e);
    const b = await call('uPolier', 'POST', '/einkaeufe', e);
    expect(a.body.number).toBe(3);
    expect(b.body.number).toBe(3);
  });
  it('nur die Leitung entscheidet; Ablehnen mit Grund; Entscheidung zurücknehmen', async () => {
    expect((await call('uPolier', 'POST', `/einkaeufe/${ID.ekBaumarkt}/decision`, { decision: 'freigeben', base_version: 1 })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', `/einkaeufe/${ID.ekBaumarkt}/decision`, { decision: 'ablehnen', base_version: 1 })).status).toBe(422);
    expect((await call('uBauleitung', 'POST', `/einkaeufe/${ID.ekBaumarkt}/decision`, { decision: 'freigeben', base_version: 1 })).body.status).toBe('freigegeben');
    expect((await call('uBauleitung', 'POST', `/einkaeufe/${ID.ekBaumarkt}/decision`, { decision: 'ablehnen', reason: 'x', base_version: 2 })).status).toBe(409);
    expect((await call('uBauleitung', 'POST', `/einkaeufe/${ID.ekBaumarkt}/decision`, { decision: 'zuruecknehmen', base_version: 2 })).body.status).toBe('eingereicht');
  });
});

describe('Fahrtenbuch', () => {
  it('Fahrer sieht eigene Fahrten, Leitung alle; NU hat kein Fahrtenbuch', async () => {
    const polier = (await call('uPolier', 'GET', '/fahrtenbuch')).body;
    expect(polier.fahrten.map((f: any) => f.fahrer_id)).toEqual([ID.uPolier]);
    expect(polier.fahrzeuge.length).toBe(4); // 2 vehicles, Radlader, mobile Tankstelle
    const bl = (await call('uBauleitung', 'GET', '/fahrtenbuch')).body;
    expect(bl.fahrten.length).toBe(2);
    expect((await call('uElektro', 'GET', '/fahrtenbuch')).status).toBe(403);
  });
  it('Fahrt nur als eigene Person; km-Lücke ist eine Warnung, kein Fehler; Fahrzeuge legt die Leitung an', async () => {
    const r = await call('uPolier', 'POST', '/fahrten', { id: randomUUID(), fahrzeug_id: ID.fzSprinter, datum: '2026-11-10', km_start: 48300, km_ende: 48350, zweck: 'Material' });
    expect(r.status).toBe(200);
    expect(r.body.fahrt.fahrer_id).toBe(ID.uPolier);
    expect(r.body.warnung).toBeTruthy();
    expect((await call('uPolier', 'POST', '/fahrten', { id: randomUUID(), fahrzeug_id: ID.fzSprinter, datum: '2026-11-10', km_start: 100, km_ende: 50, zweck: 'x' })).status).toBe(422);
    expect((await call('uElektro', 'POST', '/fahrten', { id: randomUUID(), fahrzeug_id: ID.fzSprinter, datum: '2026-11-10', km_start: 1, km_ende: 2, zweck: 'x' })).status).not.toBe(200);
    expect((await call('uPolier', 'POST', '/fahrzeuge', { kennzeichen: 'S-X 1', bezeichnung: 'Caddy' })).status).toBe(403);
    expect((await call('uProjektleitung', 'POST', '/fahrzeuge', { kennzeichen: 'S-X 1', bezeichnung: 'Caddy' })).status).toBe(200);
  });
});

describe('Besprechung: Art, Anwesenheit, Bemerkungen, nächster Termin', () => {
  it('Anwesenheit und Kopf nur im Entwurf und nur intern; Kalenderdatei für den nächsten Termin', async () => {
    const id = randomUUID();
    await call('uBauleitung', 'POST', '/besprechungen', { id, project_id: ID.project, kind: 'bau', title: 'Baubesprechung', held_at: '2026-11-12T08:00:00Z', company_ids: [ID.coElektro, ID.coBauherr] });
    expect((await call('uPolier', 'PUT', `/besprechungen/${id}/teilnehmer/${ID.coElektro}/anwesenheit`, { anwesend: true })).status).toBe(200);
    expect((await call('uElektro', 'PUT', `/besprechungen/${id}/teilnehmer/${ID.coElektro}/anwesenheit`, { anwesend: false })).status).toBe(404);
    const p = await call('uPolier', 'PATCH', `/besprechungen/${id}`, { base_version: 1, bemerkung: 'Zufahrt Nordtor', next_at: '2026-11-19T08:00:00Z' });
    expect(p.status).toBe(200);
    expect((await call('uPolier', 'PATCH', `/besprechungen/${id}`, { base_version: 1, place: 'x' })).status).toBe(409);
    // Changing participants keeps recorded attendance.
    await call('uBauleitung', 'PUT', `/besprechungen/${id}/teilnehmer`, { company_ids: [ID.coElektro] });
    const d = (await call('uBauleitung', 'GET', `/besprechungen/${id}`)).body;
    expect(d.kind).toBe('bau');
    expect(d.teilnehmer.map((t: any) => [t.id, t.anwesend])).toEqual([[ID.coElektro, true]]);
    const ics = await app.inject({ method: 'GET', url: `/besprechungen/${id}/naechster-termin.ics`, headers: { authorization: `Bearer ${tokens.uBauleitung}` } });
    expect(ics.body).toContain('DTSTART:20261119T080000Z');
    await call('uBauleitung', 'POST', `/besprechungen/${id}/send`, { base_version: 2 });
    expect((await call('uBauleitung', 'PATCH', `/besprechungen/${id}`, { base_version: 3, bemerkung: 'nachträglich' })).status).toBe(409);
    expect((await call('uBauleitung', 'PUT', `/besprechungen/${id}/teilnehmer/${ID.coElektro}/anwesenheit`, { anwesend: false })).status).toBe(409);
  });
});

describe('Mängelbericht aus Auswahl, sortiert und nach Ordnern', () => {
  const pdf = (u: keyof typeof ID, qs: string) =>
    app.inject({ method: 'GET', url: `/projects/${ID.project}/maengel/pdf?${qs}`, headers: { authorization: `Bearer ${tokens[u]}` } });
  it('nur ausgewählte Mängel; NU bekommt fremde Mängel auch über die Auswahl nicht', async () => {
    const own = await pdf('uElektro', `ids=${ID.mElektro},${ID.mFliesen}&sort=firma&gruppen=firma,monat`);
    expect(own.statusCode).toBe(200);
    expect(own.body.length).toBeGreaterThan(1000);
    expect((await pdf('uElektro', `ids=${ID.mFliesen}`)).statusCode).toBe(404); // RLS: not visible → nothing in the PDF
    expect((await pdf('uBauleitung', `ids=${ID.mFliesen},${ID.mElektro}&sort=datum_neu&gruppen=firma,tag`)).statusCode).toBe(200);
  });
  it('ungültige Sortierung oder Ordner werden abgelehnt', async () => {
    expect((await pdf('uBauleitung', 'sort=preis')).statusCode).toBe(422);
    expect((await pdf('uBauleitung', 'gruppen=firma,x')).statusCode).toBe(422);
  });
});

describe('Projekte anlegen und Struktur übernehmen', () => {
  const ALLE = ['orte', 'gewerke', 'ordner', 'nachunternehmer', 'team'];
  const neu = (u: keyof typeof ID, body: object = {}) => call(u, 'POST', '/projects', { id: randomUUID(), name: 'Wohnanlage Lindenhof BA 2', ...body });
  it('nur Bau-/Projektleitung der eigenen Firma legt Projekte an', async () => {
    for (const u of ['uPolier', 'uElektro', 'uBauherr'] as const) expect((await neu(u)).status).toBe(403);
    expect((await call('uPolier', 'GET', '/me')).body.canCreateProject).toBe(false);
    expect((await call('uProjektleitung', 'GET', '/me')).body.canCreateProject).toBe(true);
    const r = await neu('uProjektleitung');
    expect(r.status).toBe(200);
    const me = (await call('uProjektleitung', 'GET', '/me')).body.projects.find((p: any) => p.id === r.body.id);
    expect(me.role).toBe('projektleitung');
  });
  it('aus Vorlage: Orte, Gewerke, Ordner, NU und Team; zweimal übernehmen erzeugt keine Doppelten; NU-Zugänge nicht', async () => {
    const r = await neu('uBauleitung', { vorlage_id: ID.project, teile: ALLE });
    expect(r.body.uebernommen).toEqual({ orte: 6, gewerke: 2, ordner: 6, nachunternehmer: 2, team: 3 });
    const again = await call('uBauleitung', 'POST', `/projects/${r.body.id}/struktur-uebernehmen`, { from: ID.project, teile: ALLE });
    expect(again.body).toEqual({ orte: 0, gewerke: 0, ordner: 0, nachunternehmer: 0, team: 0 });
    const s = (await call('uBauleitung', 'GET', `/projects/${r.body.id}/struktur`)).body;
    expect(s.gewerke.map((g: any) => [g.name, g.firmen])).toEqual([['Elektro', ['Elektro Blitz GmbH']], ['Fliesen', ['Fliesen Fuchs GmbH']]]);
    // Polier came along with the team, the NU only as a firm (no access).
    expect((await call('uPolier', 'GET', `/projects/${r.body.id}/maengel`)).status).toBe(200);
    expect((await call('uElektro', 'GET', `/projects/${r.body.id}/maengel`)).status).toBe(403);
    // No Mängel, plans, contracts copied.
    expect((await call('uBauleitung', 'GET', `/projects/${r.body.id}/maengel`)).body).toEqual([]);
    expect((await call('uBauleitung', 'GET', `/projects/${r.body.id}/nachunternehmer`)).body.nu.every((n: any) => n.auftrag === 0)).toBe(true);
  });
  it('Vorlage muss ein eigenes Projekt sein; Struktur übernehmen nur als Leitung', async () => {
    const r = await neu('uBauleitung');
    // Fliesen (NU) cannot pull a structure into a project, Polier neither.
    expect((await call('uPolier', 'POST', `/projects/${ID.project}/struktur-uebernehmen`, { from: ID.otherProject, teile: ['orte'] })).status).toBe(403);
    expect((await neu('uProjektleitung', { vorlage_id: ID.otherProject, teile: ['orte'] })).status).toBe(403); // not a member of Bürohaus
    expect(r.status).toBe(200);
  });
});

describe('Struktur bearbeiten: Orte und Gewerke', () => {
  const loc = (u: keyof typeof ID, body: object) => call(u, 'POST', '/locations', { id: randomUUID(), project_id: ID.project, ...body });
  it('Leitung legt Orte an (nur feinere Unterorte), Polier und NU nicht', async () => {
    expect((await loc('uPolier', { kind: 'gebaeude', name: 'Haus B' })).status).toBe(403);
    expect((await loc('uElektro', { kind: 'gebaeude', name: 'Haus B' })).status).toBe(403);
    const haus = await loc('uBauleitung', { kind: 'gebaeude', name: 'Haus B' });
    expect(haus.status).toBe(200);
    expect((await loc('uBauleitung', { kind: 'gebaeude', name: 'X', parent_id: haus.body.id })).status).toBe(422);
    const eg = await loc('uBauleitung', { kind: 'geschoss', name: 'EG', parent_id: haus.body.id });
    expect(eg.status).toBe(200);
    expect((await call('uBauleitung', 'PATCH', `/locations/${eg.body.id}`, { name: 'Erdgeschoss' })).body.name).toBe('Erdgeschoss');
    // Parent with child: refused; leaf: deleted.
    const del = (id: string) => app.inject({ method: 'DELETE', url: `/locations/${id}`, headers: { authorization: `Bearer ${tokens.uBauleitung}` } });
    expect((await del(haus.body.id)).statusCode).toBe(409);
    expect((await del(eg.body.id)).statusCode).toBe(200);
  });
  it('benutzte Orte und Gewerke lassen sich nicht löschen; doppelte Gewerke nicht anlegen', async () => {
    const del = (url: string) => app.inject({ method: 'DELETE', url, headers: { authorization: `Bearer ${tokens.uBauleitung}` } });
    expect((await del(`/locations/${ID.raumBad}`)).statusCode).toBe(409); // Mangel M-001
    expect((await del(`/gewerke/${ID.gwFliesen}`)).statusCode).toBe(409);
    expect((await call('uBauleitung', 'POST', '/gewerke', { id: randomUUID(), project_id: ID.project, name: 'fliesen' })).status).toBe(409);
    const tb = await call('uBauleitung', 'POST', '/gewerke', { id: randomUUID(), project_id: ID.project, name: 'Trockenbau' });
    expect(tb.status).toBe(200);
    expect((await call('uPolier', 'POST', '/gewerke', { id: randomUUID(), project_id: ID.project, name: 'Maler' })).status).toBe(403);
    expect((await del(`/gewerke/${tb.body.id}`)).statusCode).toBe(200);
  });
});

describe('Nachunternehmer aus anderem Projekt übernehmen', () => {
  it('Bürohaus übernimmt Elektro aus Lindenhof; Firma ohne Zugang, ohne Preise', async () => {
    const k = (await call('uBauleitung', 'GET', `/projects/${ID.otherProject}/nu-kandidaten`)).body as any[];
    expect(k.map((n) => n.name)).toEqual(['Elektro Blitz GmbH', 'Fliesen Fuchs GmbH']);
    expect((await call('uElektro', 'GET', `/projects/${ID.otherProject}/nu-kandidaten`)).status).toBe(403);
    // Bürohaus gets an "Elektro" Gewerk: the firm's Gewerk is matched by name.
    await call('uBauleitung', 'POST', '/gewerke', { id: randomUUID(), project_id: ID.otherProject, name: 'Elektro' });
    const r = await call('uBauleitung', 'POST', `/projects/${ID.otherProject}/nu-uebernehmen`, { company_ids: [ID.coElektro] });
    expect(r.body.added).toBe(1);
    const nu = (await call('uBauleitung', 'GET', `/projects/${ID.otherProject}/nachunternehmer`)).body.nu as any[];
    expect(nu.map((n) => [n.name, n.gewerke, n.auftrag])).toEqual([['Elektro Blitz GmbH', ['Elektro'], 0]]);
    expect((await call('uElektro', 'GET', `/projects/${ID.otherProject}/maengel`)).status).toBe(403);
  });
});

describe('Anmeldung mit Passwort', () => {
  const post = (url: string, body: object) => app.inject({ method: 'POST', url, payload: body });
  it('falsches Passwort 401; richtiges liefert Token, das funktioniert; Abmelden beendet die Sitzung', async () => {
    expect((await post('/auth/login', { email: 'polier@example.test', password: 'falsch-falsch' })).statusCode).toBe(401);
    expect((await post('/auth/login', { email: 'niemand@example.test', password: TEST_PASSWORD })).statusCode).toBe(401);
    const r = (await post('/auth/login', { email: 'Polier@Example.test', password: TEST_PASSWORD })).json();
    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${r.token}` } });
    expect(me.json().user.id).toBe(ID.uPolier);
    expect((await post('/auth/refresh', { refresh: r.refresh })).statusCode).toBe(200);
    await post('/auth/logout', { refresh: r.refresh });
    expect((await post('/auth/refresh', { refresh: r.refresh })).statusCode).toBe(401);
  });
  it('gesperrter Zugang: weder Anmeldung noch Verlängerung', async () => {
    const r = (await post('/auth/login', { email: 'polier@example.test', password: TEST_PASSWORD })).json();
    await adminSql`UPDATE app_user SET active = false WHERE id = ${ID.uPolier}`;
    expect((await post('/auth/refresh', { refresh: r.refresh })).statusCode).toBe(403);
    expect((await post('/auth/login', { email: 'polier@example.test', password: TEST_PASSWORD })).statusCode).toBe(403);
  });
  it('Passwort zurücksetzen per Link; alter Login ungültig, Link nur einmal', async () => {
    expect((await post('/auth/passwort-vergessen', { email: 'gibtsnicht@example.test' })).json()).toEqual({ ok: true });
    await post('/auth/passwort-vergessen', { email: 'polier@example.test' });
    const [v] = await adminSql`SELECT identifier FROM auth_verification WHERE identifier LIKE 'reset-password:%' ORDER BY created_at DESC LIMIT 1`;
    const token = (v!.identifier as string).slice('reset-password:'.length);
    expect((await post('/auth/passwort-neu', { token, password: 'kurz' })).statusCode).toBe(422);
    expect((await post('/auth/passwort-neu', { token, password: 'Neues-Passwort-42' })).statusCode).toBe(200);
    expect((await post('/auth/passwort-neu', { token, password: 'Noch-eins-12345' })).statusCode).toBe(400);
    expect((await post('/auth/login', { email: 'polier@example.test', password: TEST_PASSWORD })).statusCode).toBe(401);
    expect((await post('/auth/login', { email: 'polier@example.test', password: 'Neues-Passwort-42' })).statusCode).toBe(200);
  });
});

describe('Einladungen und Zugänge', () => {
  const einladen = (u: keyof typeof ID, body: object) => call(u, 'POST', '/einladungen', { project_id: ID.project, ...body });
  const tokenOf = (link: string) => link.split('/einladung/')[1]!;
  it('nur die Leitung lädt ein; NU nur für Firmen des Projekts', async () => {
    expect((await einladen('uPolier', { email: 'neu@example.test', role: 'polier' })).status).toBe(403);
    expect((await einladen('uBauherr', { email: 'neu@example.test', role: 'nu', company_id: ID.coElektro })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', '/einladungen', { project_id: ID.otherProject, email: 'x@example.test', role: 'nu', company_id: ID.coElektro })).status).toBe(422);
    expect((await einladen('uBauleitung', { email: 'x@example.test', role: 'nu' })).status).toBe(422);
  });
  it('Monteur nimmt die Einladung an, ist sofort angemeldet und sieht nur die Mängel seiner Firma; Link nur einmal', async () => {
    const r = await einladen('uBauleitung', { email: 'monteur@fliesen-fuchs.example.test', name: 'Max Monteur', role: 'nu', company_id: ID.coFliesen });
    expect(r.body.status).toBe('eingeladen');
    const token = tokenOf(r.body.devLink);
    const info = await app.inject({ method: 'GET', url: `/auth/einladung/${token}` });
    expect(info.json()).toMatchObject({ project: 'Wohnanlage Lindenhof', company: 'Fliesen Fuchs GmbH', roleLabel: 'Nachunternehmer' });
    expect((await app.inject({ method: 'POST', url: `/auth/einladung/${token}`, payload: { name: 'Max Monteur', password: 'kurz' } })).statusCode).toBe(422);
    const ok = await app.inject({ method: 'POST', url: `/auth/einladung/${token}`, payload: { name: 'Max Monteur', password: 'Fliesen-sind-toll-1' } });
    expect(ok.statusCode).toBe(200);
    const m = await app.inject({ method: 'GET', url: `/projects/${ID.project}/maengel`, headers: { authorization: `Bearer ${ok.json().token}` } });
    expect(m.json().map((x: any) => x.number)).toEqual([1]);
    expect((await app.inject({ method: 'POST', url: `/auth/einladung/${token}`, payload: { name: 'Zweiter Versuch', password: 'Fliesen-sind-toll-1' } })).statusCode).toBe(410);
  });
  it('bestehender Zugang wird direkt hinzugefügt; zurückgezogene Einladung gilt nicht mehr', async () => {
    const r = await call('uBauleitung', 'POST', '/einladungen', { project_id: ID.otherProject, email: 'polier@example.test', role: 'polier' });
    expect(r.body.status).toBe('hinzugefuegt');
    expect((await call('uPolier', 'GET', `/projects/${ID.otherProject}/maengel`)).status).toBe(200);
    const inv = await einladen('uBauleitung', { email: 'spaeter@example.test', role: 'einkauf' });
    expect((await call('uBauleitung', 'POST', `/einladungen/${inv.body.id}/zurueckziehen`)).status).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/auth/einladung/${tokenOf(inv.body.devLink)}` })).statusCode).toBe(410);
  });
  it('Zugang entziehen: danach kein Zugriff; eigenen Zugang und letzte Leitung nicht', async () => {
    const z = (await call('uBauleitung', 'GET', `/projects/${ID.project}/zugaenge`)).body;
    const del = (u: keyof typeof ID, id: string) => app.inject({ method: 'DELETE', url: `/mitglieder/${id}`, headers: { authorization: `Bearer ${tokens[u]}` } });
    const polier = z.mitglieder.find((m: any) => m.user_id === ID.uPolier);
    const ich = z.mitglieder.find((m: any) => m.ich);
    expect((await del('uPolier', ich.id)).statusCode).toBe(403);
    expect((await del('uBauleitung', ich.id)).statusCode).toBe(422);
    expect((await del('uBauleitung', polier.id)).statusCode).toBe(200);
    expect((await call('uPolier', 'GET', `/projects/${ID.project}/maengel`)).status).toBe(403);
    expect((await call('uPolier', 'GET', `/projects/${ID.project}/zugaenge`)).status).toBe(403);
  });
});

describe('QR-Freimeldung je Mangelanzeige', () => {
  const sendAnzeige = async () => {
    const id = randomUUID();
    await call('uBauleitung', 'POST', '/mangelanzeigen', { id, project_id: ID.project, company_id: ID.coFliesen, mangel_ids: [ID.mFliesen], deadline: '2026-11-24' });
    await call('uBauleitung', 'POST', `/mangelanzeigen/${id}/send`, { base_version: 1 });
    const link = (await call('uBauleitung', 'GET', `/mangelanzeigen/${id}/link`)).body;
    return { id, link, token: (link.url as string).split('/freimeldung/')[1]! };
  };
  const pub = (url: string) => app.inject({ method: 'GET', url });
  const melden = (token: string, posId: string, fields: Record<string, string>, foto?: Buffer) => {
    const b = '----bap' + randomUUID();
    const parts = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
    const payload = Buffer.concat([
      Buffer.from(parts),
      ...(foto ? [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="nachweis.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), foto, Buffer.from('\r\n')] : []),
      Buffer.from(`--${b}--\r\n`),
    ]);
    return app.inject({ method: 'POST', url: `/public/freimeldung/${token}/positionen/${posId}`, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } });
  };
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

  it('Versand erzeugt Link + QR; nur die Leitung sieht und verwaltet ihn', async () => {
    const { id, link } = await sendAnzeige();
    expect(link.active).toBe(true);
    expect(link.qr).toMatch(/^data:image\/png;base64,/);
    expect((await call('uPolier', 'GET', `/mangelanzeigen/${id}/link`)).status).toBe(403);
    expect((await call('uFliesen', 'GET', `/mangelanzeigen/${id}/link`)).status).toBe(403);
    expect((await call('uFliesen', 'POST', `/mangelanzeigen/${id}/link`, { action: 'sperren' })).status).toBe(403);
  });
  it('der Link zeigt nur diese Anzeige, ohne Anmeldung; Fotos nur der eigenen Positionen', async () => {
    const { token } = await sendAnzeige();
    const r = await pub(`/public/freimeldung/${token}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().positions.map((p: any) => p.number)).toEqual([1]);
    expect(JSON.stringify(r.json())).not.toMatch(/amount|preis|vertrag/i);
    expect((await pub(`/public/freimeldung/${token}/foto/${randomUUID()}`)).statusCode).toBe(404);
    expect((await pub('/public/freimeldung/falscher-token-1234567890123456789012345')).statusCode).toBe(404);
  });
  it('„behoben“ braucht Name, Firma und Foto; setzt „Behoben gemeldet“; Bauleitung nimmt danach ab', async () => {
    const { id, token } = await sendAnzeige();
    const posId = (await pub(`/public/freimeldung/${token}`)).json().positions[0].id;
    expect((await melden(token, posId, { art: 'behoben', name: 'Max Monteur', firma: 'Fliesen Fuchs' })).statusCode).toBe(422);
    expect((await melden(token, posId, { art: 'behoben', name: 'M', firma: 'Fliesen Fuchs' }, jpg)).statusCode).toBe(422);
    const ok = await melden(token, posId, { art: 'behoben', name: 'Max Monteur', firma: 'Fliesen Fuchs', kommentar: 'Fuge neu verfugt' }, jpg);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('behoben_gemeldet');
    const m = (await maengel('uBauleitung')).find((x) => x.id === ID.mFliesen);
    expect(m.status).toBe('behoben_gemeldet');
    expect(m.fotos.some((f: any) => f.kind === 'nachweis')).toBe(true);
    const fm = (await call('uBauleitung', 'GET', `/mangelanzeigen/${id}/freimeldungen`)).body;
    expect(fm[0]).toMatchObject({ kind: 'behoben', melder_name: 'Max Monteur', melder_firma: 'Fliesen Fuchs' });
    expect((await call('uFliesen', 'GET', `/mangelanzeigen/${id}/freimeldungen`)).body.length).toBe(1);
    expect((await call('uElektro', 'GET', `/mangelanzeigen/${id}/freimeldungen`)).status).toBe(404);
    // Bauleitung accepts as usual.
    const t = await call('uBauleitung', 'POST', `/maengel/${ID.mFliesen}/transition`, { to: 'abgenommen', base_version: m.version });
    expect(t.body.ok ?? t.status === 200).toBeTruthy();
    expect((await melden(token, posId, { art: 'behoben', name: 'Max Monteur', firma: 'Fliesen Fuchs' }, jpg)).statusCode).toBe(409);
  });
  it('Rückfrage braucht einen Kommentar und setzt „Strittig“', async () => {
    const { token } = await sendAnzeige();
    const posId = (await pub(`/public/freimeldung/${token}`)).json().positions[0].id;
    expect((await melden(token, posId, { art: 'rueckfrage', name: 'Max Monteur', firma: 'Fliesen Fuchs' })).statusCode).toBe(422);
    const r = await melden(token, posId, { art: 'rueckfrage', name: 'Max Monteur', firma: 'Fliesen Fuchs', kommentar: 'Fuge gehört zum Sanitär' });
    expect(r.json().status).toBe('strittig');
  });
  it('gesperrter Link geht nicht; neu erzeugt: alter Link ungültig, neuer geht', async () => {
    const { id, token } = await sendAnzeige();
    await call('uBauleitung', 'POST', `/mangelanzeigen/${id}/link`, { action: 'sperren' });
    expect((await pub(`/public/freimeldung/${token}`)).statusCode).toBe(423);
    await call('uBauleitung', 'POST', `/mangelanzeigen/${id}/link`, { action: 'freigeben' });
    expect((await pub(`/public/freimeldung/${token}`)).statusCode).toBe(200);
    const neu = (await call('uBauleitung', 'POST', `/mangelanzeigen/${id}/link`, { action: 'neu' })).body;
    expect((await pub(`/public/freimeldung/${token}`)).statusCode).toBe(404);
    expect((await pub(`/public/freimeldung/${(neu.url as string).split('/freimeldung/')[1]}`)).statusCode).toBe(200);
  });
});

describe('Administrator', () => {
  it('sieht alle Projekte mit Bauleitungsrechten, ohne Mitglied zu sein', async () => {
    const me = (await call('uAdmin', 'GET', '/me')).body;
    expect(me.isAdmin).toBe(true);
    expect(me.projects.map((p: any) => p.role)).toEqual(['admin', 'admin']);
    expect((await maengel('uAdmin')).length).toBe(3);
    expect((await call('uAdmin', 'GET', `/projects/${ID.project}/kosten`)).status).toBe(200);
  });
  it('verwaltet Benutzer: sperren beendet Sitzungen; eigener Zugang bleibt; andere dürfen nicht', async () => {
    expect((await call('uBauleitung', 'GET', '/admin')).status).toBe(403);
    const o = (await call('uAdmin', 'GET', '/admin')).body;
    expect(o.users.length).toBe(8);
    const login = (await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'polier@example.test', password: TEST_PASSWORD } })).json();
    expect((await call('uAdmin', 'PATCH', `/admin/users/${ID.uPolier}`, { active: false })).status).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh: login.refresh } })).statusCode).toBe(401);
    expect((await call('uAdmin', 'PATCH', `/admin/users/${ID.uAdmin}`, { is_admin: false })).status).toBe(422);
    expect((await call('uAdmin', 'PATCH', `/admin/users/${ID.uElektro}`, { is_admin: true })).status).toBe(422);
    expect((await call('uBauleitung', 'PATCH', `/admin/users/${ID.uPolier}`, { active: true })).status).toBe(403);
  });
});

describe('Firmen-Admin eines Nachunternehmers', () => {
  it('lädt nur für die eigene Firma ein (immer als NU), sieht nur eigene Leute', async () => {
    const r = await call('uFliesen', 'POST', '/einladungen', { project_id: ID.project, email: 'geselle@fliesen-fuchs.example.test', role: 'polier' });
    expect(r.status).toBe(403);
    const ok = await call('uFliesen', 'POST', '/einladungen', { project_id: ID.project, email: 'geselle@fliesen-fuchs.example.test', role: 'nu', company_id: ID.coElektro });
    expect(ok.body.status).toBe('eingeladen');
    const accepted = await app.inject({ method: 'POST', url: `/auth/einladung/${ok.body.devLink.split('/einladung/')[1]}`, payload: { name: 'Gerd Geselle', password: 'Geselle-Passwort-1' } });
    const me = await app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${accepted.json().token}` } });
    expect(me.json().user.company).toBe('Fliesen Fuchs GmbH'); // own firm, not Elektro
    const z = (await call('uFliesen', 'GET', `/projects/${ID.project}/zugaenge`)).body;
    expect(z.firmAdmin).toBe(true);
    expect(z.mitglieder.every((m: any) => m.company === 'Fliesen Fuchs GmbH')).toBe(true);
  });
  it('ein NU ohne Firmen-Admin-Recht lädt nicht ein', async () => {
    await adminSql`UPDATE app_user SET company_admin = false WHERE id = ${ID.uElektro}`;
    expect((await call('uElektro', 'POST', '/einladungen', { project_id: ID.project, email: 'x@elektro-blitz.example.test', role: 'nu' })).status).toBe(403);
    expect((await call('uElektro', 'GET', `/projects/${ID.project}/zugaenge`)).status).toBe(403);
  });
});

describe('Bautagebuch', () => {
  const sig = { w: 300, h: 100, strokes: [[[0.1, 0.5], [0.4, 0.2], [0.7, 0.8], [0.9, 0.4]]] };
  const draft = (id: string, extra: object = {}) => ({
    id, project_id: ID.project, datum: '2026-11-10', bereich: 'Bauteil A', wetter: { text: 'bewölkt', temp_min: 4, temp_max: 9 },
    personal: [{ firma: 'Eigene', anzahl: 3 }], geraete: [{ name: 'Kran', anzahl: 1 }], leistungen: [{ text: 'Estrich 1. OG' }], ...extra,
  });
  it('nur interne Rollen: NU und Bauherr sehen und schreiben nichts', async () => {
    const id = randomUUID();
    expect((await call('uPolier', 'PUT', '/tagesberichte', draft(id))).status).toBe(200);
    for (const u of ['uElektro', 'uBauherr'] as const) {
      const l = await call(u, 'GET', `/projects/${ID.project}/tagesberichte`);
      expect(u === 'uBauherr' ? l.body.length : l.status).toBe(u === 'uBauherr' ? 0 : 403); // Bauherr: only released ones
      expect((await call(u, 'GET', `/tagesberichte/${id}`)).status).toBe(404);
      expect((await call(u, 'PUT', '/tagesberichte', draft(randomUUID(), { datum: '2026-11-09' }))).status).toBe(403);
    }
    expect((await call('uProjektleitung', 'GET', `/projects/${ID.project}/tagesberichte`)).body).toHaveLength(1);
  });
  it('Polier unterschreibt → gesperrt; Änderung wird Konflikt, nur Nachtrag; Bauleitung zeichnet gegen; PDF', async () => {
    const id = randomUUID();
    await call('uPolier', 'PUT', '/tagesberichte', draft(id));
    expect((await call('uPolier', 'POST', `/tagesberichte/${id}/unterschreiben`, { signature: { w: 10, h: 10, strokes: [[[0, 0], [0.01, 0.01]]] }, base_version: 1 })).status).toBe(422);
    const s = await call('uPolier', 'POST', `/tagesberichte/${id}/unterschreiben`, { signature: sig, base_version: 1 });
    expect(s.body.status).toBe('unterschrieben');
    const ch = await call('uPolier', 'PUT', '/tagesberichte', draft(id, { version: 2, bereich: 'geändert' }));
    expect(ch.status).toBe(409);
    expect((await call('uPolier', 'POST', `/tagesberichte/${id}/gegenzeichnen`, { signature: sig, base_version: 2 })).status).toBe(403);
    expect((await call('uPolier', 'POST', `/tagesberichte/${id}/nachtrag`, { text: 'Lieferung Fliesen kam 16 Uhr' })).status).toBe(200);
    const c = await call('uBauleitung', 'POST', `/tagesberichte/${id}/gegenzeichnen`, { signature: sig, base_version: 2 });
    expect(c.body.countersigned_by).toBe(ID.uBauleitung);
    const g = await call('uBauleitung', 'GET', `/tagesberichte/${id}`);
    expect(g.body.nachtraege).toHaveLength(1);
    expect(g.body.bereich).toBe('Bauteil A');
    const pdf = await app.inject({ method: 'GET', url: `/tagesberichte/${id}/pdf`, headers: { authorization: `Bearer ${tokens.uBauleitung}` } });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const audit = await adminSql`SELECT action FROM audit_log WHERE entity = 'tagesbericht' AND entity_id = ${id} ORDER BY id`;
    expect(audit.map((a) => a.action)).toEqual(['angelegt', 'unterschrieben', 'nachtrag', 'gegengezeichnet']);
  });
  it('offline vom Gerät: Entwurf und Unterschrift über die Upload-Warteschlange, doppelt gesendet nur einmal; zweiter Bericht am selben Tag wird Konflikt', async () => {
    const id = randomUUID();
    const d = draft(id);
    const save = (bid: string, base = 0) => ({ op: 'PUT', table: 'tagesbericht_action', id: randomUUID(), data: { bericht_id: bid, action: 'speichern', base_version: base, occurred_at: '2026-11-10T16:00:00Z', payload: JSON.stringify({ ...d, id: bid }) } });
    expect((await call('uPolier', 'POST', '/sync/upload', { ops: [save(id)] })).status).toBe(200);
    const act = { op: 'PUT', table: 'tagesbericht_action', id: randomUUID(), data: { bericht_id: id, action: 'unterschreiben', base_version: 1, payload: JSON.stringify({ signature: sig }) } };
    await call('uPolier', 'POST', '/sync/upload', { ops: [act] });
    await call('uPolier', 'POST', '/sync/upload', { ops: [act] });
    const g = await call('uPolier', 'GET', `/tagesberichte/${id}`);
    expect(g.body.status).toBe('unterschrieben');
    expect(g.body.version).toBe(2);
    const other = randomUUID();
    await call('uPolier', 'POST', '/sync/upload', { ops: [save(other)] });
    // stale draft edit from a second device (base 1, server is at 2 after signing) → conflict, not overwritten
    await call('uBauleitung', 'POST', '/sync/upload', { ops: [save(id, 1)] });
    expect((await adminSql`SELECT count(*)::int AS n FROM sync_conflict WHERE entity = 'tagesbericht' AND entity_id = ${id}`)[0]!.n).toBe(1);
    const [k] = await adminSql`SELECT reason FROM sync_conflict WHERE entity = 'tagesbericht' AND entity_id = ${other}`;
    expect(k?.reason).toMatch(/schon einen Tagesbericht/);
  });
});

describe('Rechte pro Person', () => {
  const member = async (user: string) => (await adminSql`SELECT id FROM project_member WHERE project_id = ${ID.project} AND user_id = ${user}`)[0]!.id as string;
  it('Leitung schaltet Dokumente für den Polier ab: Server liefert nichts mehr; /me zeigt den Bereich nicht', async () => {
    const id = await member(ID.uPolier);
    expect((await call('uBauleitung', 'PATCH', `/mitglieder/${id}`, { m_dokumente: false })).status).toBe(200);
    const tree = await call('uPolier', 'GET', `/projects/${ID.project}/dokumente`);
    expect(tree.status === 403 || (tree.body.folders ?? tree.body.ordner ?? []).length === 0).toBe(true);
    expect((await adminSql`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'project_member' AND action = 'rechte_geaendert'`)[0]!.n).toBe(1);
    const me = await call('uPolier', 'GET', '/me');
    expect(me.body.projects.find((p: any) => p.id === ID.project).module).not.toContain('dokumente');
  });
  it('Polier und NU ohne Firmen-Admin dürfen keine Rechte ändern; Firmen-Admin nur eigene Leute und keine Rolle', async () => {
    const id = await member(ID.uElektro);
    expect((await call('uPolier', 'PATCH', `/mitglieder/${id}`, { m_plaene: false })).status).toBe(403);
    expect((await call('uElektro', 'PATCH', `/mitglieder/${await member(ID.uFliesen)}`, { m_plaene: false })).status).toBe(403);
    expect((await call('uElektro', 'PATCH', `/mitglieder/${await member(ID.uPolier)}`, { m_plaene: false })).status).toBe(403);
  });
  it('Rolle muss zur Firma passen; letzte Leitung bleibt', async () => {
    expect((await call('uBauleitung', 'PATCH', `/mitglieder/${await member(ID.uElektro)}`, { role: 'polier' })).status).toBe(422);
    expect((await call('uBauleitung', 'PATCH', `/mitglieder/${await member(ID.uPolier)}`, { role: 'einkauf' })).status).toBe(200);
  });
  it('Admin ordnet Benutzer Projekten zu; nur der Admin', async () => {
    const [p2] = await adminSql`SELECT id FROM project WHERE id <> ${ID.project} LIMIT 1`;
    if (!p2) return;
    expect((await call('uBauleitung', 'POST', `/admin/users/${ID.uPolier}/projekte`, { project_id: p2.id, role: 'polier' })).status).toBe(403);
    expect((await call('uAdmin', 'POST', `/admin/users/${ID.uPolier}/projekte`, { project_id: p2.id, role: 'polier' })).status).toBe(200);
    expect((await call('uPolier', 'GET', '/me')).body.projects.map((p: any) => p.id)).toContain(p2.id);
  });
  it('Fahrtenbuch nur für freigeschaltete Personen', async () => {
    expect((await call('uPolier', 'GET', '/fahrtenbuch')).status).toBe(200);
    await call('uAdmin', 'PATCH', `/admin/users/${ID.uPolier}`, { fahrtenbuch: false });
    expect((await call('uPolier', 'GET', '/fahrtenbuch')).status).toBe(403);
  });
  it('Kontakte: NU pflegt eigene, sieht keine fremden; Polier sieht alle', async () => {
    expect((await call('uElektro', 'GET', '/kontakte')).body.every((k: any) => k.company_id === ID.coElektro)).toBe(true);
    expect((await call('uPolier', 'GET', `/kontakte?project=${ID.project}`)).body.length).toBe(3);
    expect((await call('uElektro', 'PUT', '/kontakte', { id: randomUUID(), company_id: ID.coFliesen, name: 'Fremd' })).status).toBe(403);
    expect((await call('uElektro', 'PUT', '/kontakte', { id: randomUUID(), company_id: ID.coElektro, name: 'Neuer Monteur', telefon: '0711 1234' })).status).toBe(200);
  });
});

describe('Besprechung: Fotos, Bauherr-Freigabe, Gegenzeichnung', () => {
  const sig = { w: 300, h: 100, strokes: [[[0.1, 0.5], [0.4, 0.2], [0.7, 0.8], [0.9, 0.4]]] };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  it('Foto am Punkt: intern hochladen, NU sieht es am sichtbaren Punkt; NU darf nicht hochladen', async () => {
    const d = (await call('uPolier', 'GET', `/besprechungen/${ID.bespr1}`)).body;
    const p2 = d.punkte.find((p: any) => p.number === 2);
    expect((await upload('uPolier', `/besprechung-punkte/${p2.id}/fotos`, {}, 'foto.png', png)).status).toBe(200);
    expect((await upload('uElektro', `/besprechung-punkte/${p2.id}/fotos`, {}, 'foto.png', png)).status).toBe(403);
    const el = (await call('uElektro', 'GET', `/besprechungen/${ID.bespr1}`)).body;
    const f = el.punkte.find((p: any) => p.number === 2).fotos[0];
    const r = await app.inject({ method: 'GET', url: `/besprechung-fotos/${f.id}`, headers: { authorization: `Bearer ${tokens.uElektro}` } });
    expect(r.statusCode).toBe(200);
    const pdf = await app.inject({ method: 'GET', url: `/besprechungen/${ID.bespr1}/pdf`, headers: { authorization: `Bearer ${tokens.uElektro}` } });
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
  it('Bauherr sieht das Protokoll erst nach Freigabe (ohne interne Punkte) und zeichnet gegen', async () => {
    expect((await call('uBauherr', 'GET', `/besprechungen/${ID.bespr1}`)).status).toBe(404);
    expect((await call('uPolier', 'POST', `/besprechungen/${ID.bespr1}/bauherr-freigabe`, { freigabe: true })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', `/besprechungen/${ID.bespr1}/bauherr-freigabe`, { freigabe: true })).status).toBe(200);
    const bh = await call('uBauherr', 'GET', `/besprechungen/${ID.bespr1}`);
    expect(bh.status).toBe(200);
    expect(bh.body.punkte.map((p: any) => p.number).sort()).toEqual([1, 2, 3, 4]);
    expect(bh.body.can_countersign).toBe(true);
    expect((await call('uElektro', 'POST', `/besprechungen/${ID.bespr1}/gegenzeichnen`, { signature: sig })).status).toBe(409);
    expect((await call('uBauherr', 'POST', `/besprechungen/${ID.bespr1}/gegenzeichnen`, { signature: sig })).status).toBe(200);
    expect((await call('uBauherr', 'POST', `/besprechungen/${ID.bespr1}/gegenzeichnen`, { signature: sig })).status).toBe(409);
    expect((await call('uBauleitung', 'POST', `/besprechungen/${ID.bespr1}/bauherr-freigabe`, { freigabe: false })).status).toBe(409);
  });
});

describe('Bautagebuch: Vorlagen, Bauherr, Ablage', () => {
  const sig = { w: 300, h: 100, strokes: [[[0.1, 0.5], [0.4, 0.2], [0.7, 0.8], [0.9, 0.4]]] };
  const signed = async () => {
    const id = randomUUID();
    await call('uPolier', 'PUT', '/tagesberichte', { id, project_id: ID.project, datum: '2026-11-12', bereich: 'Haus A', wetter: { text: 'sonnig' },
      personal: [{ firma: 'Eigene', anzahl: 4 }], geraete: [], leistungen: [{ text: 'Estrich' }], behinderungen: 'Fenster fehlen' });
    await call('uPolier', 'POST', `/tagesberichte/${id}/unterschreiben`, { signature: sig, base_version: 1 });
    return id;
  };
  it('Unterschrift legt PDF unter Dokumente › Bautagebuch › 2026 › KW 46 ab; Nachtrag erzeugt neue Version', async () => {
    const id = await signed();
    const docs = await adminSql`SELECT d.name, f.name AS kw, (SELECT count(*)::int FROM document_revision r WHERE r.document_id = d.id) AS n
      FROM document d JOIN folder f ON f.id = d.folder_id WHERE d.project_id = ${ID.project} AND f.name LIKE 'KW%'`;
    expect(docs).toEqual([{ name: '12.11.2026 Donnerstag', kw: 'KW 46', n: 1 }]);
    await call('uPolier', 'POST', `/tagesberichte/${id}/nachtrag`, { text: 'Fenster kamen 15 Uhr' });
    expect((await adminSql`SELECT count(*)::int AS n FROM document_revision r JOIN document d ON d.id = r.document_id WHERE d.name = '12.11.2026 Donnerstag'`)[0]!.n).toBe(2);
  });
  it('Bauherr sieht nur freigegebene Abschnitte und zeichnet gegen', async () => {
    const id = await signed();
    expect((await call('uBauherr', 'GET', `/tagesberichte/${id}`)).status).toBe(404);
    expect((await call('uPolier', 'POST', `/tagesberichte/${id}/bauherr-freigabe`, { freigabe: true })).status).toBe(403);
    expect((await call('uBauleitung', 'POST', `/tagesberichte/${id}/bauherr-freigabe`, { freigabe: true, abschnitte: ['wetter', 'leistungen'] })).status).toBe(200);
    const bh = (await call('uBauherr', 'GET', `/tagesberichte/${id}`)).body;
    expect(bh.wetter.text).toBe('sonnig');
    expect(bh.personal).toEqual([]);
    expect(bh.behinderungen).toBeNull();
    expect((await call('uBauherr', 'GET', `/projects/${ID.project}/tagesberichte`)).body).toHaveLength(1);
    expect((await call('uBauherr', 'POST', `/tagesberichte/${id}/bauherr-gegenzeichnen`, { signature: sig })).status).toBe(200);
    expect((await call('uElektro', 'GET', `/tagesberichte/${id}`)).status).toBe(404);
  });
  it('Vorlagen: Polier legt Projekt-Vorlage an, Firmenvorlage nur Leitung; NU sieht keine', async () => {
    const v = { id: randomUUID(), name: 'Standard Rohbau', project_id: ID.project, inhalt: { bereich: 'Haus A', geraete: [{ name: 'Kran', anzahl: 1 }] } };
    expect((await call('uPolier', 'PUT', '/tagesbericht-vorlagen', v)).status).toBe(200);
    expect((await call('uPolier', 'PUT', '/tagesbericht-vorlagen', { ...v, id: randomUUID(), project_id: null })).status).toBe(403);
    expect((await call('uPolier', 'GET', `/projects/${ID.project}/tagesberichte/vorschlag?datum=2026-11-13`)).body.vorlagen).toHaveLength(1);
    expect((await call('uElektro', 'PUT', '/tagesbericht-vorlagen', { ...v, id: randomUUID() })).status).toBe(403);
  });
});

describe('Maschinen und mobile Tankstelle', () => {
  it('Radlader: Betriebsstunden Pflicht, Diesel aus mobiler Tankstelle; Bestand und l/h', async () => {
    const t = (body: object) => call('uPolier', 'POST', '/tankvorgaenge', { id: randomUUID(), datum: '2026-11-12', ...body });
    expect((await t({ fahrzeug_id: ID.fzRadlader, liter: 90 })).status).toBe(422);
    const ok = await t({ fahrzeug_id: ID.fzRadlader, liter: 90, betriebsstunden: 1220, quelle_id: ID.fzTankstelle });
    expect(ok.body.error ?? ok.status).toBe(200);
    expect(ok.body.warnung).toBeNull();
    expect((await t({ fahrzeug_id: ID.fzRadlader, liter: 90, betriebsstunden: 1230, quelle_id: ID.fzSprinter })).status).toBe(422);
    const fb = (await call('uPolier', 'GET', '/fahrtenbuch')).body;
    expect(fb.fahrzeuge.find((f: any) => f.id === ID.fzTankstelle).bestand).toBe(615);
    expect(fb.tanken.find((x: any) => x.bh === 1220).verbrauch_h).toBe(9);
    const zuviel = await t({ fahrzeug_id: ID.fzRadlader, liter: 700, betriebsstunden: 1300, quelle_id: ID.fzTankstelle });
    expect(zuviel.body.warnung).toMatch(/nur 615 l/);
  });
});

describe('Einkauf: LV, Anfrage per Link, Preisspiegel', () => {
  const lvBody = () => ({ id: randomUUID(), project_id: ID.project, titel: 'Estricharbeiten Haus A', angebotsfrist: '2026-11-30', gewerk_id: ID.gwFliesen,
    positionen: [{ id: randomUUID(), oz: '01.0010', kurztext: 'Zementestrich 50 mm', menge: 100, einheit: 'm2' }, { id: randomUUID(), oz: '01.0020', kurztext: 'Randstreifen', menge: 10, einheit: 'm' }] });
  const pub = (token: string, method: 'GET' | 'POST', body?: object) => app.inject({ method, url: `/public/angebot/${token}`, payload: body }).then((r) => ({ status: r.statusCode, body: r.json() as any }));
  it('Polier und NU dürfen kein LV anlegen; Leitung schon', async () => {
    expect((await call('uPolier', 'PUT', '/lv', lvBody())).status).toBe(403);
    expect((await call('uElektro', 'PUT', '/lv', lvBody())).status).toBe(403);
    expect((await call('uBauleitung', 'PUT', '/lv', lvBody())).status).toBe(200);
  });
  it('Anfrage per Link: Bieter sieht nur eigenes; Preisspiegel mit günstigstem; NU sieht keine fremden Preise; Vergabe', async () => {
    const b = lvBody();
    await call('uBauleitung', 'PUT', '/lv', b);
    expect((await call('uBauleitung', 'POST', `/lv/${b.id}/anfragen`, { company_ids: [ID.coElektro, ID.coFliesen] })).status).toBe(200);
    expect((await call('uBauleitung', 'PUT', '/lv', { ...b, positionen: [] })).status).toBe(409); // positions locked after sending
    const links = await adminSql`SELECT company_id, token FROM lv_anfrage WHERE lv_id = ${b.id}`;
    const tEl = links.find((t) => t.company_id === ID.coElektro)!.token as string;
    const tFl = links.find((t) => t.company_id === ID.coFliesen)!.token as string;
    const view = await pub(tEl, 'GET');
    expect(view.body.positionen).toHaveLength(2);
    // LV as PDF to fill in by hand: bidder copy via link, neutral copy for the Leitung only
    const pdfPub = await app.inject({ method: 'GET', url: `/public/angebot/${tEl}/pdf` });
    expect(pdfPub.statusCode).toBe(200);
    expect(pdfPub.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await app.inject({ method: 'GET', url: '/public/angebot/falsch/pdf' })).statusCode).toBe(404);
    const pdfIntern = await app.inject({ method: 'GET', url: `/lv/${b.id}/pdf`, headers: { authorization: `Bearer ${tokens.uBauleitung}` } });
    expect(pdfIntern.rawPayload.subarray(0, 4).toString(), pdfIntern.body).toBe('%PDF');
    expect((await app.inject({ method: 'GET', url: `/lv/${b.id}/pdf`, headers: { authorization: `Bearer ${tokens.uPolier}` } })).statusCode).toBeGreaterThanOrEqual(403);
    expect((await pub(tEl, 'POST', { name: 'Erik', preise: {} })).status).toBe(422);
    expect((await pub(tEl, 'POST', { name: 'Erik', preise: { [b.positionen[0]!.id]: 30, [b.positionen[1]!.id]: 5 } })).status).toBe(200); // 3050
    expect((await pub(tFl, 'POST', { name: 'Fiona', preise: { [b.positionen[0]!.id]: 28, [b.positionen[1]!.id]: 6 }, nachlass_prozent: 3 })).status).toBe(200); // 2860 → 2774.2
    expect((await pub(tEl, 'GET')).body.preise[b.positionen[0]!.id]).toBe(30);
    const sp = (await call('uBauleitung', 'GET', `/lv/${b.id}/preisspiegel`)).body;
    expect(sp.spiegel.guenstigstes).toBe(sp.angebote.find((a: any) => a.company_id === ID.coFliesen).id);
    expect(sp.spiegel.summen.find((s: any) => s.company === 'Fliesen Fuchs GmbH').summe_nach_nachlass).toBe(2774.2);
    // NU: only own requests, never the Preisspiegel or others' offers
    expect((await call('uElektro', 'GET', `/lv/${b.id}/preisspiegel`)).status).toBe(403);
    const nuList = (await call('uElektro', 'GET', `/projects/${ID.project}/lv`)).body;
    expect(nuList).toHaveLength(1);
    const others = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.user_id', ${ID.uElektro}, true)`;
      await tx`SET LOCAL ROLE bap_app`;
      return tx`SELECT company_id FROM angebot WHERE lv_id = ${b.id}`;
    });
    expect(others.map((o) => o.company_id)).toEqual([ID.coElektro]);
    expect([403, 404]).toContain((await call('uPolier', 'GET', `/lv/${b.id}/preisspiegel`)).status); // RLS hides the LV
    expect((await call('uBauleitung', 'POST', `/lv/${b.id}/vergeben`, { company_id: ID.coFliesen })).status).toBe(200);
    expect((await pub(tEl, 'POST', { name: 'Erik', preise: { [b.positionen[0]!.id]: 1 } })).status).toBe(409);
  });
});

describe('Raum-QR-Etiketten', () => {
  it('PDF für Bauleitung und Polier, nicht für NU; Format nur Leitung; unpassendes Raster abgelehnt', async () => {
    const r = await app.inject({ method: 'GET', url: `/projects/${ID.project}/raum-etiketten.pdf`, headers: { authorization: `Bearer ${tokens.uPolier}` } });
    expect(r.headers['content-type']).toBe('application/pdf');
    expect((await call('uElektro', 'GET', `/projects/${ID.project}/raum-etiketten.pdf`)).status).toBe(403);
    expect((await call('uPolier', 'PUT', `/projects/${ID.project}/etiketten-format`, { spalten: 3 })).status).toBe(403);
    expect((await call('uBauleitung', 'PUT', `/projects/${ID.project}/etiketten-format`, { spalten: 6, zeilen: 16, rand_links_mm: 50 })).status).toBe(422);
    expect((await call('uBauleitung', 'PUT', `/projects/${ID.project}/etiketten-format`, { spalten: 3, zeilen: 10 })).body.spalten).toBe(3);
    expect((await call('uPolier', 'GET', `/projects/${ID.project}/etiketten-format`)).body.zeilen).toBe(10);
  });
});

describe('Nachträglich bearbeiten', () => {
  it('Mangel: Polier ändert Text, Ort und Priorität; NU nicht; Protokoll', async () => {
    const m = (await maengel('uPolier')).find((x) => x.number === 2);
    const r = await call('uPolier', 'PATCH', `/maengel/${m.id}`, { base_version: m.version, description: 'Steckdose neben Herd fehlt (2-fach)', priority: 'normal' });
    expect(r.status).toBe(200);
    expect(r.body.description).toMatch(/2-fach/);
    expect((await call('uElektro', 'PATCH', `/maengel/${m.id}`, { base_version: r.body.version, description: 'x' })).status).toBe(409);
    expect((await adminSql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = ${m.id} AND action = 'geaendert'`)[0]!.n).toBe(1);
  });
  it('Fahrt und Tanken: eigene korrigieren, fremde nicht (außer Leitung); Einkauf nur solange eingereicht', async () => {
    const f = '00000000-0000-4000-8000-000000000c01';
    expect((await call('uPolier', 'PATCH', `/fahrten/${f}`, { km_ende: 48270, zweck: 'Material und Container' })).body.km_ende).toBe(48270);
    expect((await call('uBauleitung', 'PATCH', `/fahrten/${f}`, { zweck: 'korrigiert durch BL' })).status).toBe(200);
    expect((await call('uPolier', 'PATCH', '/fahrten/00000000-0000-4000-8000-000000000c02', { zweck: 'fremd' })).status).toBe(404); // not even visible
    expect((await call('uPolier', 'PATCH', '/fahrten/' + f, { km_ende: 100 })).status).not.toBe(200); // end before start
    expect((await call('uPolier', 'PATCH', '/tankvorgaenge/00000000-0000-4000-8000-000000000d04', { betriebsstunden: 1212 })).status).toBe(200);
    expect((await call('uPolier', 'PATCH', `/einkaeufe/${ID.ekBaumarkt}`, { betrag_brutto: 89.9 })).status).toBe(200);
    expect((await call('uPolier', 'PATCH', `/einkaeufe/${ID.ekTanke}`, { betrag_brutto: 1 })).status).toBe(409); // already freigegeben
  });
});

describe('Bautagebuch im Firmenformat', () => {
  it('Blatt-Nr. läuft je Projekt hoch; Arbeitseinsatz nur für den Bauherrn sichtbar, wenn Personal freigegeben', async () => {
    const mk = async (datum: string) => {
      const id = randomUUID();
      await call('uPolier', 'PUT', '/tagesberichte', { id, project_id: ID.project, datum, einsatz: { von: '06:45', bis: '16:00', aufsicht: 1, arbeiter: 4 },
        wetter: { messungen: [{ zeit: '06:30', witterung: 'bewölkt', temp: 8 }] }, besuche: 'BG Bau', anordnungen: 'PSA tragen' });
      return id;
    };
    const a = await mk('2026-11-12');
    const b = await mk('2026-11-13');
    const ga = (await call('uPolier', 'GET', `/tagesberichte/${a}`)).body;
    expect(ga.blatt_nr).toBe(1);
    expect((await call('uPolier', 'GET', `/tagesberichte/${b}`)).body.blatt_nr).toBe(2);
    expect(ga.einsatz.arbeiter).toBe(4);
    expect(ga.besuche).toBe('BG Bau');
    const sig = { w: 300, h: 100, strokes: [[[0.1, 0.5], [0.4, 0.2], [0.7, 0.8], [0.9, 0.4]]] };
    await call('uPolier', 'POST', `/tagesberichte/${a}/unterschreiben`, { signature: sig, base_version: 1 });
    await call('uBauleitung', 'POST', `/tagesberichte/${a}/bauherr-freigabe`, { freigabe: true, abschnitte: ['wetter', 'besuche'] });
    const bh = (await call('uBauherr', 'GET', `/tagesberichte/${a}`)).body;
    expect(bh.einsatz).toEqual({});
    expect(bh.besuche).toBe('BG Bau');
    expect(bh.anordnungen).toBeNull();
  });
});

describe('Besprechung nach Konzept', () => {
  it('Teilaufgaben je Firma: NU der Teilaufgabe sieht den Punkt; Mail-Vorschau mit Vorlage; Verteiler nur Leitung', async () => {
    const r = await call('uPolier', 'POST', '/besprechungen', { id: randomUUID(), project_id: ID.project, held_at: '2026-11-17T09:00:00+01:00', previous_id: ID.bespr1 });
    const id = randomUUID();
    const add = await call('uPolier', 'POST', '/punkte', { id, besprechung_id: r.body.id, text: 'Doppelboden 4. OG vorbereiten', responsible_company_id: ID.coOwn, status: 'wichtig',
      notiz: 'Abhängig von Estrich', eigen_anteil: 'Schotts herstellen', kontrolle: 'BL am 20.11.',
      teilaufgaben: [{ company_id: ID.coElektro, text: 'Bodentanks setzen', status: 'in_arbeit', due_date: '2026-11-19' }] });
    expect(add.status).toBe(200);
    expect(add.body.support_company_ids).toEqual([ID.coElektro]);
    const det = (await call('uPolier', 'GET', `/besprechungen/${r.body.id}`)).body;
    const p = det.punkte.find((x: any) => x.id === id);
    expect(p.teilaufgaben[0].company).toBe('Elektro Blitz GmbH');
    const mail = (await call('uBauleitung', 'GET', `/besprechungen/${r.body.id}/mail`)).body;
    expect(mail.text).toMatch(/ALLGEMEINE INFORMATIONEN/);
    expect(mail.text).toMatch(/Anteil Elektro Blitz GmbH: Bodentanks setzen/);
    expect(mail.text).not.toMatch(/Container und Lagerfläche/); // erledigt → not in the mail
    expect((await call('uPolier', 'PUT', `/projects/${ID.project}/verteiler`, { id: randomUUID(), name: 'X', email: 'x@example.test' })).status).toBe(403);
    expect((await call('uBauleitung', 'PUT', `/projects/${ID.project}/verteiler`, { id: randomUUID(), name: 'Petra PL', email: 'pl@example.test', kategorie: 'projektleiter' })).status).toBe(200);
    expect((await call('uBauleitung', 'PUT', `/projects/${ID.project}/mail-vorlage`, { preset: 'kurz', intro: 'Hallo zusammen,', outro: 'Danke.', signatur: 'Viele Grüße' })).status).toBe(200);
    expect((await call('uBauleitung', 'GET', `/besprechungen/${r.body.id}/mail`)).body.text).toMatch(/^Hallo zusammen,/);
    const sent = await call('uBauleitung', 'POST', `/besprechungen/${r.body.id}/send`, { base_version: (await call('uBauleitung', 'GET', `/besprechungen/${r.body.id}`)).body.version });
    expect(sent.status).toBe(200);
    expect(sent.body.mails.some((m: any) => m.to.includes('pl@example.test'))).toBe(true);
    const el = (await call('uElektro', 'GET', `/besprechungen/${r.body.id}`)).body;
    expect(el.punkte.find((x: any) => x.id === id).mine).toBe(true);
  });
});

describe('LV-Ordner, Gliederung, Stammleistungen', () => {
  it('Ordner nur Einkauf/Leitung; LV mit Titel/Untertitel bekommt OZ automatisch; Kopie; Bibliothek', async () => {
    const o = randomUUID();
    expect((await call('uPolier', 'PUT', `/projects/${ID.project}/lv-ordner`, { id: o, name: 'Rohbau' })).status).toBe(403);
    expect((await call('uBauleitung', 'PUT', `/projects/${ID.project}/lv-ordner`, { id: o, name: 'Rohbau' })).status).toBe(200);
    const id = randomUUID();
    const r = await call('uBauleitung', 'PUT', '/lv', { id, project_id: ID.project, titel: 'Estrich', ordner_id: o, auto_oz: true, positionen: [
      { id: randomUUID(), art: 'titel', kurztext: 'Estricharbeiten' },
      { id: randomUUID(), art: 'untertitel', kurztext: 'EG' },
      { id: randomUUID(), art: 'position', kurztext: 'Zementestrich 50 mm', menge: 100, einheit: 'm2' },
      { id: randomUUID(), art: 'text', kurztext: 'Hinweis: Estrich nach DIN 18560' },
      { id: randomUUID(), art: 'position', kurztext: 'Randstreifen', menge: 30, einheit: 'm' },
    ] });
    expect(r.status).toBe(200);
    expect(r.body.positionen.map((p: any) => p.oz)).toEqual(['01', '01.01', '01.01.0010', '', '01.01.0020']);
    expect((await call('uBauleitung', 'GET', `/projects/${ID.project}/lv`)).body.find((l: any) => l.id === id).positionen).toBe(2);
    expect((await call('uBauleitung', 'DELETE', `/lv-ordner/${o}`)).status).toBe(409); // not empty
    const k = await call('uBauleitung', 'POST', `/lv/${id}/kopie`, { project_id: ID.project, ordner_id: o });
    expect((await call('uBauleitung', 'GET', `/lv/${k.body.id}`)).body.positionen).toHaveLength(5);
    expect((await call('uPolier', 'PUT', '/stammleistungen', { id: randomUUID(), kurztext: 'X', einheit: 'St' })).status).toBe(403);
    expect((await call('uBauleitung', 'PUT', '/stammleistungen', { id: randomUUID(), kategorie: 'Estrich', kurztext: 'Zementestrich CT-C25-F4 50 mm', einheit: 'm2' })).status).toBe(200);
    expect((await call('uBauleitung', 'GET', '/stammleistungen?q=zement')).body).toHaveLength(1);
    expect((await call('uElektro', 'GET', '/stammleistungen')).status).toBe(403);
    const paket = [{ kurztext: 'Aushub', einheit: 'm3', faktor: 0.4 }, { kurztext: 'Beton C30/37', einheit: 'm3', faktor: 0.25 }];
    expect((await call('uBauleitung', 'PUT', '/stammleistungen', { id: randomUUID(), kategorie: 'Rohbau', kurztext: 'Bodenplatte', einheit: 'm2', paket })).status).toBe(200);
    const bp = ((await call('uBauleitung', 'GET', '/stammleistungen?q=bodenplatte')).body as { paket: unknown[] }[]);
    expect(bp[0]?.paket).toEqual(paket);
    expect((await call('uBauleitung', 'PUT', '/stammleistungen', { id: randomUUID(), kurztext: 'X', einheit: 'St', paket: [{ kurztext: '', einheit: 'm3', faktor: 1 }] })).status).toBe(422);
  });
});

describe('Preisspiegel mit Kalkulation und erfassten Angeboten', () => {
  it('Kalkulation links, Angebot per Hand erfassen, Abweichung; NU/Polier ausgeschlossen', async () => {
    const id = randomUUID(); const p1 = randomUUID(); const p2 = randomUUID();
    await call('uBauleitung', 'PUT', '/lv', { id, project_id: ID.project, titel: 'Bodenplatte', auto_oz: true, positionen: [
      { id: randomUUID(), art: 'titel', kurztext: 'Rohbau' },
      { id: p1, art: 'position', kurztext: 'Aushub', menge: 48, einheit: 'm3' },
      { id: p2, art: 'position', kurztext: 'Beton C30/37', menge: 30, einheit: 'm3' },
    ] });
    expect((await call('uPolier', 'PUT', `/lv/${id}/kalkulation`, { preise: { [p1]: 20 } })).status).toBeGreaterThanOrEqual(403);
    expect((await call('uBauleitung', 'PUT', `/lv/${id}/kalkulation`, { preise: { [p1]: 20, [p2]: 150, [randomUUID()]: 5 } })).status).toBe(200);
    // offer by mail, entered by the Bauleitung (locks the draft)
    expect((await call('uElektro', 'POST', `/lv/${id}/angebote`, { company_id: ID.coElektro, preise: { [p1]: 1 } })).status).toBeGreaterThanOrEqual(403);
    expect((await call('uBauleitung', 'POST', `/lv/${id}/angebote`, { company_id: ID.coFliesen, preise: { [p1]: 22, [p2]: 165 }, nachlass_prozent: 0 })).status).toBe(200);
    const sp = (await call('uBauleitung', 'GET', `/lv/${id}/preisspiegel`)).body;
    expect(sp.lv.status).toBe('angefragt');
    expect(sp.kalkulation.summe).toBe(48 * 20 + 30 * 150);
    expect(Object.keys(sp.kalkulation.preise)).toHaveLength(2);
    expect(sp.angebote).toHaveLength(1);
    expect(sp.spiegel.abweichung[sp.angebote[0].id]).toBe(10);
    // after sending, the calculation stays editable; NU never sees it
    expect((await call('uBauleitung', 'PUT', `/lv/${id}/kalkulation`, { preise: { [p1]: 21, [p2]: 150 } })).status).toBe(200);
    expect((await call('uElektro', 'GET', `/lv/${id}/preisspiegel`)).status).toBeGreaterThanOrEqual(403);
  });
});

describe('Bestellanforderung, Einkaufsportal, Mitteilungen', () => {
  it('Polier fordert an → Einkauf benachrichtigt → LV → angefragt → bestellt → Polier benachrichtigt; NU/Bauherr ausgeschlossen', async () => {
    const id = randomUUID();
    const body = { id, project_id: ID.project, titel: 'Schalungsplatten', positionen: [{ text: 'Schalungsplatte 3S 21 mm', menge: 40, einheit: 'St' }], dringend: true, benoetigt_am: '2026-11-25' };
    expect((await call('uElektro', 'POST', '/bestellanforderungen', { ...body, id: randomUUID() })).status).toBe(403);
    expect((await call('uBauherr', 'POST', '/bestellanforderungen', { ...body, id: randomUUID() })).status).toBe(403);
    const r = await call('uPolier', 'POST', '/bestellanforderungen', body);
    expect(r.status).toBe(200);
    expect(r.body.number).toBe(2);
    expect((await call('uPolier', 'POST', '/bestellanforderungen', body)).body.number).toBe(2); // idempotent (offline re-upload)
    expect((await call('uElektro', 'GET', `/projects/${ID.project}/bestellanforderungen`)).status).toBe(403);
    expect((await call('uElektro', 'GET', `/bestellanforderungen/${id}`)).status).toBe(404); // RLS hides it
    // Einkauf: notification + portal over all sites
    const m = (await call('uEinkauf', 'GET', '/mitteilungen')).body;
    expect(m.ungelesen).toBeGreaterThanOrEqual(1);
    expect(m.nachrichten[0].titel).toContain('DRINGEND');
    expect((await call('uBauleitung', 'GET', '/mitteilungen')).body.ungelesen).toBeGreaterThanOrEqual(1); // Leitung informed in the app
    expect((await call('uPolier', 'GET', '/mitteilungen')).body.ungelesen).toBe(0); // never the sender
    const portal = (await call('uEinkauf', 'GET', '/einkaufsportal')).body;
    expect(portal.baustellen.map((b: any) => b.id).sort()).toEqual([ID.project, ID.otherProject].sort());
    expect(portal.baustellen.find((b: any) => b.id === ID.project).neu).toBe(2);
    expect((await call('uPolier', 'GET', '/einkaufsportal')).status).toBe(403);
    expect((await call('uElektro', 'GET', '/einkaufsportal')).status).toBe(403);
    // Polier may not move it on, only withdraw
    expect((await call('uPolier', 'POST', `/bestellanforderungen/${id}/status`, { status: 'bestellt', base_version: 1, lieferant: 'X' })).status).toBe(409);
    // Einkauf: LV from the request, send → angefragt
    const lv = await call('uEinkauf', 'POST', `/bestellanforderungen/${id}/lv`, {});
    expect(lv.status).toBe(200);
    expect((await call('uEinkauf', 'GET', `/lv/${lv.body.lv_id}`)).body.positionen[0].menge).toBe(40);
    await call('uEinkauf', 'POST', `/lv/${lv.body.lv_id}/anfragen`, { company_ids: [ID.coFliesen] });
    let b = (await call('uEinkauf', 'GET', `/bestellanforderungen/${id}`)).body;
    expect(b.status).toBe('angefragt');
    expect((await call('uEinkauf', 'POST', `/bestellanforderungen/${id}/status`, { status: 'bestellt', base_version: b.version })).status).toBe(422); // Lieferant fehlt
    const best = await call('uEinkauf', 'POST', `/bestellanforderungen/${id}/status`, { status: 'bestellt', base_version: b.version, lieferant: 'Baustoff Huber', bestell_nr: 'B-4711', liefertermin: '2026-11-24' });
    expect(best.status).toBe(200);
    const pm = (await call('uPolier', 'GET', '/mitteilungen')).body;
    expect(pm.ungelesen).toBe(1);
    expect(pm.nachrichten[0].text).toContain('Baustoff Huber');
    expect((await call('uPolier', 'POST', `/mitteilungen/alle/gelesen`, {})).status).toBe(200);
    expect((await call('uPolier', 'GET', '/mitteilungen')).body.ungelesen).toBe(0);
    // withdraw only while new
    const seed = (await call('uPolier', 'GET', `/bestellanforderungen/${ID.banf1}`)).body;
    expect((await call('uPolier', 'POST', `/bestellanforderungen/${ID.banf1}/status`, { status: 'zurueckgezogen', base_version: seed.version })).status).toBe(200);
    // offline from the app: row as PowerSync uploads it (positionen as JSON text, dringend as 0/1), twice
    const off = randomUUID();
    const op = { op: 'PUT', table: 'bestellanforderung', id: off, data: { project_id: ID.project, titel: 'Fugenband', beschreibung: null, positionen: JSON.stringify([{ text: 'Fugenband 25 m', menge: 2, einheit: 'Rolle' }]),
      benoetigt_am: null, dringend: 1, status: 'offen', created_by: ID.uPolier, created_at: '2026-11-12T07:00:00Z' } };
    expect((await call('uPolier', 'POST', '/sync/upload', { ops: [op] })).body.results[0].ok).toBe(true);
    await call('uPolier', 'POST', '/sync/upload', { ops: [op] });
    const offRow = (await call('uEinkauf', 'GET', `/bestellanforderungen/${off}`)).body;
    expect(offRow.dringend).toBe(true);
    expect(offRow.positionen[0].einheit).toBe('Rolle');
    expect((await call('uEinkauf', 'GET', `/projects/${ID.project}/bestellanforderungen`)).body.filter((x: any) => x.titel === 'Fugenband')).toHaveLength(1);
    const audit = await adminSql`SELECT action FROM audit_log WHERE entity = 'bestellanforderung' AND entity_id = ${id} ORDER BY occurred_at`;
    expect(audit.map((a) => a.action)).toContain('status:bestellt');
  });
});

describe('Fotodokumentation', () => {
  it('intern auf dem Plan; Raum aus Plan; 360° aus der Datei; Mangel aus Foto; NU/Bauherr/Einkauf ausgeschlossen', async () => {
    const id = randomUUID();
    const body = { id, project_id: ID.project, plan_id: ID.planEg, pin_x: 0.4, pin_y: 0.5, kategorie: 'geschlossene_wand', titel: 'Wand Bad vor Beplankung' };
    for (const u of ['uElektro', 'uBauherr', 'uEinkauf'] as const) expect((await call(u, 'POST', '/fotodoku', { ...body, id: randomUUID() })).status).toBe(403);
    const r = await call('uPolier', 'POST', '/fotodoku', body);
    expect(r.status).toBe(200);
    expect(r.body.location_id).not.toBeNull(); // from the plan
    expect((await call('uPolier', 'POST', '/fotodoku', body)).status).toBe(200); // idempotent
    // 360° JPEG header: SOF0 with 5760 x 2880
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0x40, 0x16, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
    const up = await upload('uPolier', `/fotodoku/${id}/datei`, {}, 'pano.jpg', jpg);
    expect(up.status).toBe(200);
    expect(up.body.ist_360).toBe(true);
    expect(up.body.width).toBe(5760);
    const list = (await call('uBauleitung', 'GET', `/projects/${ID.project}/fotodoku?plan=${ID.planEg}`)).body;
    expect(list.map((f: any) => f.id)).toContain(id);
    expect((await call('uElektro', 'GET', `/projects/${ID.project}/fotodoku`)).status).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/fotodoku/${id}/datei`, headers: { authorization: `Bearer ${tokens.uElektro}` } })).statusCode).toBe(404);
    // Mangel from the photo: same pin, photo copied
    const m = await call('uBauleitung', 'POST', `/fotodoku/${id}/mangel`, { description: 'Dämmung fehlt im Gefach', gewerk_id: ID.gwFliesen });
    expect(m.status).toBe(200);
    const mangel = (await call('uBauleitung', 'GET', `/projects/${ID.project}/maengel`)).body.find((x: any) => x.id === m.body.mangel_id);
    expect(mangel.pin_x).toBeCloseTo(0.4);
    expect((await call('uBauleitung', 'POST', `/fotodoku/${id}/mangel`, { description: 'x', gewerk_id: ID.gwFliesen })).status).toBe(409);
    // trash: others' photos only the Bauleitung
    const other = randomUUID();
    await call('uBauleitung', 'POST', '/fotodoku', { ...body, id: other });
    expect((await call('uPolier', 'DELETE', `/fotodoku/${other}`)).status).toBe(403);
    expect((await call('uPolier', 'DELETE', `/fotodoku/${id}`)).status).toBe(200);
    expect((await call('uBauleitung', 'GET', `/projects/${ID.project}/fotodoku`)).body.map((f: any) => f.id)).not.toContain(id);
    // offline upload from the app
    const off = randomUUID();
    const res = await call('uPolier', 'POST', '/sync/upload', { ops: [{ op: 'PUT', table: 'foto_doku', id: off, data: { project_id: ID.project, plan_id: ID.planEg, pin_x: 0.1, pin_y: 0.1, pin_page: 1, kategorie: 'schacht', titel: null, notiz: null, ist_360: 0, location_id: null, gewerk_id: null, created_by: ID.uPolier, taken_at: '2026-11-12T08:00:00.000Z' } }] });
    expect(res.body.results[0].ok).toBe(true);
  });
});
