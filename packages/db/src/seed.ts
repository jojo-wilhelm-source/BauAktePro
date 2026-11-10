import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ADMIN_URL, connect } from './index';
import { ID } from './seed-ids';

const sql = connect(ADMIN_URL, 1);
const storage = fileURLToPath(new URL('../../../storage/plans', import.meta.url));

/** A simple floor plan (A3 landscape) so the Durchstich has something to pin on. */
async function makePlanPdf() {
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
  page.drawText('Wohnanlage Lindenhof · Haus A · Grundriss EG · Index A', { x: 80, y: 60, size: 16, font });
  await mkdir(storage, { recursive: true });
  await writeFile(`${storage}/grundriss-eg-a.pdf`, await doc.save());
}

await sql.begin(async (tx) => {
  await tx`TRUNCATE mangelanzeige_position, mangelanzeige, location_area, tenant, company, app_user, project, project_member, location, gewerk, gewerk_company, plan, mangel, mangel_note, audit_log, sync_conflict, project_counter CASCADE`;
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
  await tx`INSERT INTO project_counter (project_id, mangel) VALUES (${ID.project}, 3)`;
  await tx`INSERT INTO mangel_note (id, mangel_id, project_id, text, created_by)
           VALUES (gen_random_uuid(), ${ID.mFliesen}, ${ID.project}, 'Intern: NU war schon zweimal zu spät – ggf. Einbehalt', ${ID.uBauleitung})`;
});
await makePlanPdf();
console.log('seed ok');
await sql.end();
