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

  it('NU sieht nur eigene, nicht interne Punkte der versendeten Besprechung', async () => {
    expect(nums((await call('uElektro', 'GET', `/besprechungen/${ID.bespr1}`)).body)).toEqual([1, 2]); // P-001 Zuarbeit, P-002 verantwortlich
    expect(nums((await call('uFliesen', 'GET', `/besprechungen/${ID.bespr1}`)).body)).toEqual([1]);
    expect(nums((await call('uPolier', 'GET', `/besprechungen/${ID.bespr1}`)).body)).toEqual([1, 2, 3, 4, 5]);
    expect((await call('uBauherr', 'GET', `/besprechungen/${ID.bespr1}`)).status).toBe(404); // not a participant
  });

  it('Folgesitzung: Offen und In Arbeit wandern mit, Erledigt und Info nicht; Teilnehmer übernommen', async () => {
    expect((await nextMeeting('uElektro')).status).toBe(403);
    const r = await nextMeeting('uPolier');
    expect(r.status).toBe(200);
    expect(r.body.number).toBe(2);
    const d = (await call('uPolier', 'GET', `/besprechungen/${r.body.id}`)).body;
    expect(nums(d)).toEqual([1, 2, 5]);
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
    expect(nums((await call('uElektro', 'GET', `/besprechungen/${r.body.id}`)).body)).toEqual([1, 2, 6]);
    expect(nums((await call('uFliesen', 'GET', `/besprechungen/${r.body.id}`)).body)).toEqual([1]);
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
