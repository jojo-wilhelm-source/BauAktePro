import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ADMIN_URL, connect } from './index';
import { ID } from './seed-ids';

const sql = connect(ADMIN_URL, 1);
const storage = fileURLToPath(new URL('../../../storage/plans', import.meta.url));

/** A simple floor plan (A3 landscape) so the Durchstich has something to pin on. */
async function makePlanPdf(index: 'A' | 'B') {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1191, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const wall = { borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 4 };
  page.drawRectangle({ x: 80, y: 120, width: 1000, height: 600, ...wall });
  page.drawRectangle({ x: 80, y: 120, width: 350, height: 300, ...wall });
  page.drawRectangle({ x: 80, y: 420, width: 350, height: 300, ...wall });
  page.drawText('Bad', { x: 220, y: 560, size: 28, font: bold });
  page.drawText('Küche'.replace('ü', 'ue'), { x: 200, y: 260, size: 28, font: bold });
  page.drawText('Wohnen', { x: 680, y: 420, size: 28, font: bold });
  if (index === 'B') {
    // Index B: additional door between Bad and Wohnen, marked as change.
    page.drawRectangle({ x: 425, y: 500, width: 10, height: 80, color: rgb(1, 1, 1) });
    page.drawText('Tür neu (Index B)'.replace('ü', 'ue'), { x: 445, y: 535, size: 14, font, color: rgb(0.8, 0.1, 0.1) });
  }
  page.drawText(`Wohnanlage Lindenhof · Haus A · Grundriss EG · Index ${index}`, { x: 80, y: 60, size: 16, font });
  await mkdir(storage, { recursive: true });
  await writeFile(`${storage}/grundriss-eg-${index.toLowerCase()}.pdf`, await doc.save());
}

await sql.begin(async (tx) => {
  // DELETE instead of TRUNCATE: PowerSync replicates row deletes, so devices drop old test data too.
  // Order: children first. plan.current_revision_id is cleared before plan_revision is deleted.
  await tx`UPDATE plan SET current_revision_id = NULL`;
  for (const t of [
    'besprechung_eintrag', 'besprechung_punkt', 'besprechung_teilnehmer', 'besprechung', 'plan_revision',
    'mangelanzeige_position', 'mangelanzeige', 'location_area', 'mangel_note', 'mangel', 'sync_conflict', 'audit_log',
    'plan', 'gewerk_company', 'gewerk', 'project_counter', 'project_member', 'location', 'project', 'app_user', 'company', 'tenant',
  ]) {
    await tx.unsafe(`DELETE FROM ${t}`);
  }
  await tx`INSERT INTO tenant (id, name) VALUES (${ID.tenant}, 'Muster Bau GmbH')`;
  await tx`INSERT INTO company ${tx([
    { id: ID.coOwn, tenant_id: ID.tenant, name: 'Muster Bau GmbH', kind: 'own', email: null },
    { id: ID.coElektro, tenant_id: ID.tenant, name: 'Elektro Blitz GmbH', kind: 'nu', email: 'info@elektro-blitz.example.test' },
    { id: ID.coFliesen, tenant_id: ID.tenant, name: 'Fliesen Fuchs GmbH', kind: 'nu', email: 'buero@fliesen-fuchs.example.test' },
    { id: ID.coBauherr, tenant_id: ID.tenant, name: 'Wohnbau Süd AG', kind: 'bauherr', email: null },
  ])}`;
  await tx`INSERT INTO app_user ${tx([
    { id: ID.uBauleitung, tenant_id: ID.tenant, company_id: ID.coOwn, email: 'bauleitung@example.test', name: 'Bea Bauleitung' },
    { id: ID.uPolier, tenant_id: ID.tenant, company_id: ID.coOwn, email: 'polier@example.test', name: 'Paul Polier' },
    { id: ID.uElektro, tenant_id: ID.tenant, company_id: ID.coElektro, email: 'elektro@example.test', name: 'Erik Elektro' },
    { id: ID.uFliesen, tenant_id: ID.tenant, company_id: ID.coFliesen, email: 'fliesen@example.test', name: 'Fiona Fliesen' },
    { id: ID.uBauherr, tenant_id: ID.tenant, company_id: ID.coBauherr, email: 'bauherr@example.test', name: 'Hanna Bauherr' },
  ])}`;
  await tx`INSERT INTO project ${tx([
    { id: ID.project, tenant_id: ID.tenant, name: 'Wohnanlage Lindenhof' },
    { id: ID.otherProject, tenant_id: ID.tenant, name: 'Bürohaus Am Markt' },
  ])}`;
  await tx`INSERT INTO project_member ${tx([
    { project_id: ID.project, user_id: ID.uBauleitung, company_id: ID.coOwn, role: 'bauleitung' },
    { project_id: ID.project, user_id: ID.uPolier, company_id: ID.coOwn, role: 'polier' },
    { project_id: ID.project, user_id: ID.uElektro, company_id: ID.coElektro, role: 'nu' },
    { project_id: ID.project, user_id: ID.uFliesen, company_id: ID.coFliesen, role: 'nu' },
    { project_id: ID.project, user_id: ID.uBauherr, company_id: ID.coBauherr, role: 'bauherr' },
    { project_id: ID.otherProject, user_id: ID.uBauleitung, company_id: ID.coOwn, role: 'bauleitung' },
  ])}`;
  await tx`INSERT INTO location ${tx([
    { id: ID.haus, project_id: ID.project, parent_id: null, kind: 'gebaeude', name: 'Haus A', sort: 1 },
    { id: ID.eg, project_id: ID.project, parent_id: ID.haus, kind: 'geschoss', name: 'EG', sort: 1 },
    { id: ID.og1, project_id: ID.project, parent_id: ID.haus, kind: 'geschoss', name: 'OG 1', sort: 2 },
    { id: ID.raumBad, project_id: ID.project, parent_id: ID.eg, kind: 'raum', name: 'Bad', sort: 1 },
    { id: ID.raumKueche, project_id: ID.project, parent_id: ID.eg, kind: 'raum', name: 'Küche', sort: 2 },
    { id: ID.raumWohnen, project_id: ID.project, parent_id: ID.eg, kind: 'raum', name: 'Wohnen', sort: 3 },
  ])}`;
  await tx`INSERT INTO gewerk ${tx([
    { id: ID.gwElektro, project_id: ID.project, name: 'Elektro' },
    { id: ID.gwFliesen, project_id: ID.project, name: 'Fliesen' },
  ])}`;
  await tx`INSERT INTO gewerk_company ${tx([
    { gewerk_id: ID.gwElektro, company_id: ID.coElektro },
    { gewerk_id: ID.gwFliesen, company_id: ID.coFliesen },
  ])}`;
  await tx`INSERT INTO plan (id, project_id, location_id, name, plan_index, file_key, visible_to_nu, visible_to_bauherr)
           VALUES (${ID.planEg}, ${ID.project}, ${ID.eg}, 'Grundriss EG', 'A', 'grundriss-eg-a.pdf', true, true)`;
  // Index A released, Index B uploaded by the Polier and waiting for review ("Eingang / Zur Prüfung").
  await tx`INSERT INTO plan_revision ${tx([
    { id: ID.revEgA, plan_id: ID.planEg, project_id: ID.project, plan_index: 'A', file_key: 'grundriss-eg-a.pdf', status: 'freigegeben',
      uploaded_by: ID.uBauleitung, uploaded_at: '2026-10-01T08:00:00Z', decided_by: ID.uBauleitung, decided_at: '2026-10-02T08:00:00Z', comment: null },
    { id: ID.revEgB, plan_id: ID.planEg, project_id: ID.project, plan_index: 'B', file_key: 'grundriss-eg-b.pdf', status: 'zur_pruefung',
      uploaded_by: ID.uPolier, uploaded_at: '2026-11-09T14:00:00Z', comment: 'Neue Tür Bad/Wohnen laut Architekt', decided_by: null, decided_at: null },
  ] as never)}`;
  await tx`UPDATE plan SET current_revision_id = ${ID.revEgA}, released_at = '2026-10-02T08:00:00Z' WHERE id = ${ID.planEg}`;
  // Room areas = the rectangles drawn in makePlanPdf (page 1191×842 pt, converted to top-left relative coordinates).
  const area = (location_id: string, x0: number, yTop: number, x1: number, yBottom: number) => ({
    project_id: ID.project, location_id, plan_id: ID.planEg, page: 1,
    x0: x0 / 1191, x1: x1 / 1191, y0: 1 - yTop / 842, y1: 1 - yBottom / 842,
  });
  await tx`INSERT INTO location_area ${tx([
    area(ID.raumBad, 80, 720, 430, 420),
    area(ID.raumKueche, 80, 420, 430, 120),
    area(ID.raumWohnen, 430, 720, 1080, 120),
  ])}`;
  const m = (id: string, n: number, extra: Record<string, unknown>) => ({
    id, project_id: ID.project, number: n, location_id: ID.raumBad, gewerk_id: ID.gwFliesen, priority: 'normal',
    status: 'zugewiesen', plan_id: ID.planEg, pin_page: 1, pin_x: 0.2, pin_y: 0.3, assigned_company_id: ID.coFliesen,
    assignment_confirmed: true, reporter_company_id: ID.coOwn, created_by: ID.uPolier, creator_role: 'polier',
    visible_to_bauherr: false, due_date: '2026-10-28', description: '', ...extra,
  });
  await tx`INSERT INTO mangel ${tx([
    m(ID.mFliesen, 1, { description: 'Fliesenfuge an der Dusche gerissen' }),
    m(ID.mElektro, 2, { description: 'Steckdose neben Herd fehlt', location_id: ID.raumKueche, gewerk_id: ID.gwElektro,
      assigned_company_id: ID.coElektro, pin_x: 0.22, pin_y: 0.65, priority: 'kritisch', due_date: '2026-11-06', visible_to_bauherr: true }),
    m(ID.mUnconfirmed, 3, { description: 'Lichtschalter schief montiert', location_id: ID.raumWohnen, gewerk_id: ID.gwElektro,
      assigned_company_id: ID.coElektro, assignment_confirmed: false, status: 'neu', pin_x: 0.6, pin_y: 0.5,
      created_by: ID.uBauherr, creator_role: 'bauherr', reporter_company_id: ID.coBauherr, due_date: null }),
  ])}`;
  await tx`INSERT INTO project_counter (project_id, mangel, besprechung, punkt) VALUES (${ID.project}, 3, 1, 5)`;

  // NU-Besprechung Nr. 1 (last week), already sent. Points in the structure of the user's template.
  await tx`INSERT INTO besprechung (id, tenant_id, project_id, number, kind, title, held_at, place, status, sent_at, sent_by, created_by)
           VALUES (${ID.bespr1}, ${ID.tenant}, ${ID.project}, 1, 'nu', 'NU-Besprechung', '2026-11-03T09:00:00Z', 'Baucontainer',
                   'versendet', '2026-11-03T12:00:00Z', ${ID.uBauleitung}, ${ID.uBauleitung})`;
  await tx`INSERT INTO besprechung_teilnehmer ${tx([ID.coElektro, ID.coFliesen, ID.coOwn].map((company_id) => ({ besprechung_id: ID.bespr1, project_id: ID.project, company_id })))}`;
  const pk = (id: string, number: number, extra: Record<string, unknown>) => ({
    id, project_id: ID.project, number, first_besprechung_id: ID.bespr1, location_id: ID.eg, gewerk_id: null, text: '',
    responsible_company_id: null, support_company_ids: [], status: 'offen', due_date: null, internal: false, published: true,
    plan_id: null, pin_page: null, pin_x: null, pin_y: null, created_by: ID.uBauleitung, created_at: '2026-11-03T09:10:00Z', ...extra,
  });
  const punkte = [
    pk(ID.p1, 1, { text: 'Abdichtung Bad vor Fliesenarbeiten prüfen und freimelden', gewerk_id: ID.gwFliesen, responsible_company_id: ID.coFliesen,
      support_company_ids: [ID.coElektro], status: 'in_arbeit', due_date: '2026-11-12', plan_id: ID.planEg, pin_page: 1, pin_x: 0.15, pin_y: 0.25 }),
    pk(ID.p2, 2, { text: 'Leerrohre Küche setzen (Herdanschluss, Arbeitsplatte)', gewerk_id: ID.gwElektro, responsible_company_id: ID.coElektro,
      status: 'offen', due_date: '2026-11-07', plan_id: ID.planEg, pin_page: 1, pin_x: 0.25, pin_y: 0.75 }),
    pk(ID.p3, 3, { text: 'Container und Lagerfläche vor Haus A räumen', location_id: null, responsible_company_id: ID.coOwn, status: 'erledigt' }),
    pk(ID.p4, 4, { text: 'Estrich OG 1 ab 17.11. begehbar', location_id: ID.og1, status: 'info' }),
    pk(ID.p5, 5, { text: 'Nachtrag Elektro (Mehrmengen Leerrohr) prüfen', location_id: null, gewerk_id: ID.gwElektro, responsible_company_id: ID.coOwn,
      internal: true, published: false }),
  ];
  await tx`INSERT INTO besprechung_punkt ${tx(punkte as never)}`;
  await tx`INSERT INTO besprechung_eintrag ${tx(punkte.map((p) => ({ besprechung_id: ID.bespr1, punkt_id: p.id, project_id: ID.project, carried: false,
    status_snapshot: p.status, text_snapshot: p.text })))}`;
  await tx`INSERT INTO mangel_note (id, mangel_id, project_id, text, created_by)
           VALUES (gen_random_uuid(), ${ID.mFliesen}, ${ID.project}, 'Intern: NU war schon zweimal zu spät – ggf. Einbehalt', ${ID.uBauleitung})`;
});
await makePlanPdf('A');
await makePlanPdf('B');
console.log('seed ok');
await sql.end();
