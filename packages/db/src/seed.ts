import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ADMIN_URL, connect } from './index';
import { hashPassword } from 'better-auth/crypto';
import { ID, TEST_PASSWORD } from './seed-ids';

const sql = connect(ADMIN_URL, 1);
const storage = fileURLToPath(new URL('../../../storage/plans', import.meta.url));
const docStorage = fileURLToPath(new URL('../../../storage/dokumente', import.meta.url));

/** Simple A4 PDF for demo documents (Statik, Nachweise, Nachträge, Rechnungen). */
async function makeDocPdf(dir: string, file: string, title: string, lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText(title, { x: 56, y: 770, size: 18, font: bold });
  lines.forEach((l, i) => page.drawText(l, { x: 56, y: 730 - i * 18, size: 11, font }));
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/${file}`, await doc.save());
}

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
  await tx`UPDATE plan SET current_revision_id = NULL, folder_id = NULL`;
  await tx`UPDATE document SET current_revision_id = NULL`;
  for (const t of [
    'auth_session', 'auth_account', 'auth_verification', 'einladung', 'freimeldung', 'anzeige_link', 'besprechung_teilaufgabe', 'besprechung_verteiler', 'besprechung_punkt_foto', 'tagesbericht_vorlage', 'tagesbericht_action', 'tagesbericht_foto', 'tagesbericht_nachtrag', 'tagesbericht',
    'tenant_einstellung', 'foto_doku', 'benachrichtigung', 'bestellanforderung', 'angebot_preis', 'lv_kalkulation', 'angebot', 'lv_anfrage', 'lv_position', 'lv', 'lv_ordner', 'lv_stammleistung', 'company_kontakt', 'tankvorgang', 'fahrt', 'fahrzeug', 'einkauf', 'vertrag', 'project_company',
    'einreichung', 'stundenzettel_zeile', 'stundenzettel', 'document_revision', 'document', 'folder',
    'besprechung_eintrag', 'besprechung_punkt', 'besprechung_teilnehmer', 'besprechung', 'plan_revision',
    'mangelanzeige_position', 'mangelanzeige', 'location_area', 'mangel_foto', 'mangel_note', 'mangel', 'sync_conflict', 'audit_log',
    'plan', 'gewerk_company', 'gewerk', 'project_counter', 'project_member', 'location', 'project', 'app_user', 'company', 'tenant',
  ]) {
    await tx.unsafe(`DELETE FROM ${t}`);
  }
  await tx`INSERT INTO tenant (id, name) VALUES (${ID.tenant}, 'Muster Bau GmbH')`;
  await tx`INSERT INTO company ${tx([
    { id: ID.coOwn, tenant_id: ID.tenant, name: 'Muster Bau GmbH', kind: 'own', email: null, contact_person: null, phone: null, address: null },
    { id: ID.coElektro, tenant_id: ID.tenant, name: 'Elektro Blitz GmbH', kind: 'nu', email: 'info@elektro-blitz.example.test', contact_person: 'Erik Elektro', phone: '0711 123456', address: 'Industriestr. 4, 70565 Stuttgart' },
    { id: ID.coFliesen, tenant_id: ID.tenant, name: 'Fliesen Fuchs GmbH', kind: 'nu', email: 'buero@fliesen-fuchs.example.test', contact_person: 'Fiona Fliesen', phone: '0711 654321', address: 'Am Markt 9, 71032 Böblingen' },
    { id: ID.coBauherr, tenant_id: ID.tenant, name: 'Wohnbau Süd AG', kind: 'bauherr', email: null, contact_person: null, phone: null, address: null },
  ])}`;
  await tx`INSERT INTO app_user ${tx([
    { id: ID.uBauleitung, tenant_id: ID.tenant, company_id: ID.coOwn, email: 'bauleitung@example.test', name: 'Bea Bauleitung' },
    { id: ID.uPolier, tenant_id: ID.tenant, company_id: ID.coOwn, email: 'polier@example.test', name: 'Paul Polier' },
    { id: ID.uElektro, tenant_id: ID.tenant, company_id: ID.coElektro, email: 'elektro@example.test', name: 'Erik Elektro' },
    { id: ID.uFliesen, tenant_id: ID.tenant, company_id: ID.coFliesen, email: 'fliesen@example.test', name: 'Fiona Fliesen' },
    { id: ID.uBauherr, tenant_id: ID.tenant, company_id: ID.coBauherr, email: 'bauherr@example.test', name: 'Hanna Bauherr' },
    { id: ID.uProjektleitung, tenant_id: ID.tenant, company_id: ID.coOwn, email: 'projektleitung@example.test', name: 'Petra Projektleitung' },
    { id: ID.uAdmin, tenant_id: ID.tenant, company_id: ID.coOwn, email: 'admin@example.test', name: 'Anna Admin' },
    { id: ID.uEinkauf, tenant_id: ID.tenant, company_id: ID.coOwn, email: 'einkauf@example.test', name: 'Erika Einkauf' },
  ])}`;
  // Administrator of the whole app (all projects, all users) and the two NU owners as firm admins.
  await tx`UPDATE app_user SET is_admin = true WHERE id = ${ID.uAdmin}`;
  await tx`UPDATE app_user SET company_admin = true WHERE id IN (${ID.uElektro}, ${ID.uFliesen})`;
  // Fahrtenbuch is granted per person by the administrator.
  await tx`UPDATE app_user SET fahrtenbuch = true WHERE id IN (${ID.uPolier}, ${ID.uBauleitung}, ${ID.uProjektleitung})`;
  // Real sign-in for local testing: every test user has the same development password (never used in production).
  const pw = await hashPassword(TEST_PASSWORD);
  await tx`INSERT INTO auth_account ${tx(
    [ID.uBauleitung, ID.uPolier, ID.uElektro, ID.uFliesen, ID.uBauherr, ID.uProjektleitung, ID.uAdmin, ID.uEinkauf].map((u) => ({
      id: u, user_id: u, account_id: u, provider_id: 'credential', password: pw,
    })),
  )}`;
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
    { project_id: ID.project, user_id: ID.uProjektleitung, company_id: ID.coOwn, role: 'projektleitung' },
    { project_id: ID.otherProject, user_id: ID.uBauleitung, company_id: ID.coOwn, role: 'bauleitung' },
    // Einkauf: one user for all sites (Einkaufsportal over every project he is assigned to).
    { project_id: ID.project, user_id: ID.uEinkauf, company_id: ID.coOwn, role: 'einkauf' },
    { project_id: ID.otherProject, user_id: ID.uEinkauf, company_id: ID.coOwn, role: 'einkauf' },
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
    { id: ID.gwElektro, project_id: ID.project, name: 'Elektro', budget_net: 95000 },
    { id: ID.gwFliesen, project_id: ID.project, name: 'Fliesen', budget_net: 60000 },
  ])}`;
  await tx`INSERT INTO project_company ${tx([ID.coElektro, ID.coFliesen, ID.coOwn, ID.coBauherr].map((company_id) => ({ project_id: ID.project, company_id })))}`;
  await tx`INSERT INTO vertrag ${tx([
    { id: ID.vtElektro, project_id: ID.project, company_id: ID.coElektro, gewerk_id: ID.gwElektro, title: 'Elektroinstallation Haus A', amount_net: 86500, signed_on: '2026-07-01', created_by: ID.uBauleitung },
    { id: ID.vtFliesen, project_id: ID.project, company_id: ID.coFliesen, gewerk_id: ID.gwFliesen, title: 'Fliesenarbeiten Haus A', amount_net: 41300, signed_on: '2026-08-15', created_by: ID.uBauleitung },
  ])}`;
  await tx`INSERT INTO gewerk_company ${tx([
    { gewerk_id: ID.gwElektro, company_id: ID.coElektro },
    { gewerk_id: ID.gwFliesen, company_id: ID.coFliesen },
  ])}`;
  // Folder structure (proposal D5). Every folder shows replaced versions under "Alt".
  const folder = (id: string, name: string, sort: number, parent_id: string | null, nu: boolean, bh: boolean, kind = 'dokumente') =>
    ({ id, project_id: ID.project, parent_id, name, sort, visible_to_nu: nu, visible_to_bauherr: bh, kind });
  await tx`INSERT INTO folder ${tx([
    folder(ID.fPlaene, 'Pläne', 1, null, true, true, 'plaene'),
    folder(ID.fArchitektur, 'Architektur', 1, ID.fPlaene, true, true, 'plaene'),
    folder(ID.fTragwerk, 'Tragwerk', 2, ID.fPlaene, true, false, 'plaene'),
    folder(ID.fStatik, 'Statik', 2, null, true, false),
    folder(ID.fNachweise, 'Nachweise', 3, null, false, false),
    folder(ID.fVertraege, 'Verträge', 4, null, false, false),
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
  await tx`UPDATE plan SET current_revision_id = ${ID.revEgA}, released_at = '2026-10-02T08:00:00Z', folder_id = ${ID.fArchitektur} WHERE id = ${ID.planEg}`;

  // Documents: Statik with an old and a current version, a Brandschutznachweis.
  await tx`INSERT INTO document (id, project_id, folder_id, name) VALUES
    (${ID.docStatik}, ${ID.project}, ${ID.fStatik}, 'Statische Berechnung Haus A'),
    (${ID.docBrandschutz}, ${ID.project}, ${ID.fNachweise}, 'Brandschutznachweis')`;
  const rev = (id: string, document_id: string, version_label: string, file_key: string, status: string, at: string) => ({
    id, document_id, project_id: ID.project, version_label, file_key, file_name: file_key, mime: 'application/pdf', size_bytes: 2000, status,
    uploaded_by: ID.uBauleitung, uploaded_at: at, decided_by: ID.uBauleitung, decided_at: at, comment: null,
  });
  await tx`INSERT INTO document_revision ${tx([
    rev(ID.docStatikV1, ID.docStatik, '1', 'statik-v1.pdf', 'ersetzt', '2026-09-01T08:00:00Z'),
    rev(ID.docStatikV2, ID.docStatik, '2', 'statik-v2.pdf', 'freigegeben', '2026-10-20T08:00:00Z'),
    rev(ID.docBrandschutzV1, ID.docBrandschutz, '1', 'brandschutz-v1.pdf', 'freigegeben', '2026-09-15T08:00:00Z'),
  ] as never)}`;
  await tx`UPDATE document SET current_revision_id = ${ID.docStatikV2} WHERE id = ${ID.docStatik}`;
  await tx`UPDATE document SET current_revision_id = ${ID.docBrandschutzV1} WHERE id = ${ID.docBrandschutz}`;

  // Stundenzettel of Elektro Blitz (submitted) for last week.
  await tx`INSERT INTO stundenzettel (id, project_id, number, company_id, period_from, period_to, status, hours_total, submitted_by, submitted_at, created_by, created_at)
           VALUES (${ID.szElektro}, ${ID.project}, 1, ${ID.coElektro}, '2026-11-02', '2026-11-06', 'eingereicht', 30, ${ID.uElektro}, '2026-11-07T15:00:00Z', ${ID.uElektro}, '2026-11-07T14:00:00Z')`;
  const zeile = (n: number, datum: string, person: string, stunden: number, taetigkeit: string, bezug: string) => ({
    id: `00000000-0000-4000-8000-00000000071${n}`, zettel_id: ID.szElektro, project_id: ID.project, company_id: ID.coElektro, datum, person,
    von: '07:00', bis: stunden > 8 ? '17:00' : '15:30', pause_min: 30, stunden, taetigkeit, location_id: ID.eg, bezug, sort: n,
  });
  await tx`INSERT INTO stundenzettel_zeile ${tx([
    zeile(1, '2026-11-03', 'M. Wagner', 8, 'Leerrohre EG verlegen', 'hauptauftrag'),
    zeile(2, '2026-11-03', 'T. Kaya', 8, 'Leerrohre EG verlegen', 'hauptauftrag'),
    zeile(3, '2026-11-04', 'M. Wagner', 8, 'Schlitze Küche nachstemmen', 'regie'),
    zeile(4, '2026-11-05', 'M. Wagner', 6, 'Unterverteilung setzen', 'hauptauftrag'),
  ] as never)}`;

  // NU-Einreichungen: a Nachtrag and an Abschlagsrechnung.
  await tx`INSERT INTO einreichung (id, project_id, number, company_id, kind, rechnung_art, title, amount_net, file_key, file_name, status, submitted_by, submitted_at) VALUES
    (${ID.ezNachtrag}, ${ID.project}, 1, ${ID.coElektro}, 'nachtrag', NULL, 'Nachtrag 01 – Mehrmengen Leerrohr Küche', 4850.00, 'nachtrag-elektro-01.pdf', 'Nachtrag_01_Elektro_Blitz.pdf', 'eingereicht', ${ID.uElektro}, '2026-11-08T09:00:00Z'),
    (${ID.ezRechnung}, ${ID.project}, 1, ${ID.coFliesen}, 'rechnung', 'abschlag', '1. Abschlagsrechnung Fliesenarbeiten', 12400.00, 'rechnung-fliesen-ar1.pdf', '1_AR_Fliesen_Fuchs.pdf', 'in_pruefung', ${ID.uFliesen}, '2026-11-06T10:00:00Z')`;
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
    m(ID.mFliesen, 1, { description: 'Fliesenfuge an der Dusche gerissen', created_at: '2026-10-14T09:20:00Z' }),
    m(ID.mElektro, 2, { description: 'Steckdose neben Herd fehlt', location_id: ID.raumKueche, gewerk_id: ID.gwElektro,
      assigned_company_id: ID.coElektro, pin_x: 0.22, pin_y: 0.65, priority: 'kritisch', due_date: '2026-11-06', visible_to_bauherr: true, created_at: '2026-11-02T07:45:00Z' }),
    m(ID.mUnconfirmed, 3, { description: 'Lichtschalter schief montiert', location_id: ID.raumWohnen, gewerk_id: ID.gwElektro,
      assigned_company_id: ID.coElektro, assignment_confirmed: false, status: 'neu', pin_x: 0.6, pin_y: 0.5,
      created_by: ID.uBauherr, creator_role: 'bauherr', reporter_company_id: ID.coBauherr, due_date: null, created_at: '2026-11-09T15:10:00Z' }),
  ])}`;
  await tx`INSERT INTO project_counter (project_id, mangel, besprechung, punkt, stundenzettel, nachtrag, rechnung, einkauf, bestellanforderung) VALUES (${ID.project}, 3, 1, 5, 1, 1, 1, 2, 1)`;

  // Contacts of the NU on site (callable from the app).
  await tx`INSERT INTO company_kontakt ${tx([
    { id: '00000000-0000-4000-8000-000000000e51', tenant_id: ID.tenant, company_id: ID.coElektro, name: 'Klaus Kabel', funktion: 'Vorarbeiter', telefon: '+49 711 555 0101', created_by: ID.uElektro },
    { id: '00000000-0000-4000-8000-000000000e52', tenant_id: ID.tenant, company_id: ID.coElektro, name: 'Murat Strom', funktion: 'Monteur', telefon: '+49 711 555 0102', created_by: ID.uElektro },
    { id: '00000000-0000-4000-8000-000000000e53', tenant_id: ID.tenant, company_id: ID.coFliesen, name: 'Lena Fuge', funktion: 'Vorarbeiterin', telefon: '+49 711 555 0201', created_by: ID.uFliesen },
  ] as never)}`;

  // Bestellanforderung from the Polier, still open for the Einkauf (docs/fachkonzept/12).
  await tx`INSERT INTO bestellanforderung ${tx({
    id: ID.banf1, tenant_id: ID.tenant, project_id: ID.project, number: 1, titel: 'Bauzaun und Schuttmulde', beschreibung: 'Für den Abbruch im EG',
    positionen: tx.json([{ text: 'Bauzaunelemente 3,5 m mit Füßen', menge: 20, einheit: 'St' }, { text: 'Schuttmulde 7 m³ inkl. Abfuhr', menge: 2, einheit: 'St' }] as never),
    location_id: ID.eg, benoetigt_am: '2026-11-20', dringend: true, created_by: ID.uPolier,
  } as never)}`;

  // Baustellen-Einkäufe and Fahrtenbuch (docs/fachkonzept/14).
  await tx`INSERT INTO einkauf ${tx([
    { id: ID.ekBaumarkt, project_id: ID.project, number: 1, gekauft_von: 'Paul Polier', datum: '2026-11-05', haendler: 'Bauhaus Stuttgart', betrag_brutto: 84.9, mwst_satz: 19,
      gewerk_id: null, zweck: 'Abdeckfolie und Klebeband', zahlungsart: 'privat', status: 'eingereicht', created_by: ID.uPolier },
    { id: ID.ekTanke, project_id: ID.project, number: 2, gekauft_von: 'Paul Polier', datum: '2026-11-03', haendler: 'Würth', betrag_brutto: 212.3, mwst_satz: 19,
      gewerk_id: ID.gwElektro, zweck: 'Dübel und Schrauben für Unterverteilung', zahlungsart: 'firmenkarte', status: 'freigegeben', created_by: ID.uPolier,
      decided_by: ID.uBauleitung, decided_at: '2026-11-04T08:00:00Z' },
  ] as never)}`;
  await tx`INSERT INTO fahrzeug ${tx([
    { id: ID.fzSprinter, tenant_id: ID.tenant, kennzeichen: 'S-MB 2041', bezeichnung: 'Mercedes Sprinter', kraftstoff: 'diesel', fahrer_id: ID.uPolier, art: 'fahrzeug', kapazitaet_l: null },
    { id: ID.fzGolf, tenant_id: ID.tenant, kennzeichen: 'S-MB 118', bezeichnung: 'VW Golf Variant', kraftstoff: 'benzin', fahrer_id: ID.uBauleitung, art: 'fahrzeug', kapazitaet_l: null },
    { id: ID.fzRadlader, tenant_id: ID.tenant, kennzeichen: 'RL-07', bezeichnung: 'Radlader Liebherr L 506', kraftstoff: 'diesel', fahrer_id: ID.uPolier, art: 'maschine', kapazitaet_l: null },
    { id: ID.fzTankstelle, tenant_id: ID.tenant, kennzeichen: 'TS-1', bezeichnung: 'Mobile Tankstelle 1.000 l', kraftstoff: 'diesel', fahrer_id: null, art: 'tankstelle', kapazitaet_l: 1000 },
  ] as never)}`;
  await tx`INSERT INTO fahrt ${tx([
    { id: '00000000-0000-4000-8000-000000000c01', tenant_id: ID.tenant, fahrzeug_id: ID.fzSprinter, fahrer_id: ID.uPolier, datum: '2026-11-09', km_start: 48210, km_ende: 48262, project_id: ID.project, zweck: 'Baustelle Lindenhof, Material' },
    { id: '00000000-0000-4000-8000-000000000c02', tenant_id: ID.tenant, fahrzeug_id: ID.fzGolf, fahrer_id: ID.uBauleitung, datum: '2026-11-09', km_start: 23110, km_ende: 23148, project_id: ID.project, zweck: 'Baubesprechung' },
  ] as never)}`;
  await tx`INSERT INTO tankvorgang ${tx([
    { id: '00000000-0000-4000-8000-000000000d01', tenant_id: ID.tenant, fahrzeug_id: ID.fzSprinter, fahrer_id: ID.uPolier, datum: '2026-11-02', liter: 68.4, betrag_brutto: 112.86, km_stand: 47740, tankstelle: 'Aral Vaihingen', project_id: null },
    { id: '00000000-0000-4000-8000-000000000d02', tenant_id: ID.tenant, fahrzeug_id: ID.fzSprinter, fahrer_id: ID.uPolier, datum: '2026-11-09', liter: 61.2, betrag_brutto: 101.6, km_stand: 48262, tankstelle: 'Shell Möhringen', project_id: ID.project },
  ] as never)}`;
  // Mobile station filled with 800 l, the Radlader got 95 l from it.
  await tx`INSERT INTO tankvorgang ${tx([
    { id: '00000000-0000-4000-8000-000000000d03', tenant_id: ID.tenant, fahrzeug_id: ID.fzTankstelle, fahrer_id: ID.uPolier, datum: '2026-11-04', liter: 800, betrag_brutto: 1240, km_stand: null, betriebsstunden: null, tankstelle: 'Lieferung Diesel Müller', quelle_id: null, project_id: ID.project },
    { id: '00000000-0000-4000-8000-000000000d04', tenant_id: ID.tenant, fahrzeug_id: ID.fzRadlader, fahrer_id: ID.uPolier, datum: '2026-11-06', liter: 95, betrag_brutto: null, km_stand: null, betriebsstunden: 1210, tankstelle: null, quelle_id: ID.fzTankstelle, project_id: ID.project },
  ] as never)}`;

  // NU-Besprechung Nr. 1 (last week), already sent. Points in the structure of the user's template.
  await tx`INSERT INTO besprechung (id, tenant_id, project_id, number, kind, title, held_at, place, status, sent_at, sent_by, created_by)
           VALUES (${ID.bespr1}, ${ID.tenant}, ${ID.project}, 1, 'nu', 'NU-Besprechung', '2026-11-03T09:00:00Z', 'Baucontainer',
                   'versendet', '2026-11-03T12:00:00Z', ${ID.uBauleitung}, ${ID.uBauleitung})`;
  await tx`INSERT INTO besprechung_teilnehmer ${tx([ID.coElektro, ID.coFliesen, ID.coOwn].map((company_id) => ({ besprechung_id: ID.bespr1, project_id: ID.project, company_id })))}`;
  const pk = (id: string, number: number, extra: Record<string, unknown>) => ({
    id, project_id: ID.project, number, first_besprechung_id: ID.bespr1, location_id: ID.eg, gewerk_id: null, text: '',
    responsible_company_id: null, support_company_ids: [], status: 'in_arbeit', due_date: null, internal: false, published: true,
    kontakt: null, notiz: null, eigen_anteil: null, kontrolle: null, plan_id: null, pin_page: null, pin_x: null, pin_y: null, created_by: ID.uBauleitung, created_at: '2026-11-03T09:10:00Z', ...extra,
  });
  const punkte = [
    pk(ID.p1, 1, { text: 'Abdichtung Bad vor Fliesenarbeiten prüfen und freimelden', gewerk_id: ID.gwFliesen, responsible_company_id: ID.coFliesen,
      support_company_ids: [ID.coElektro], status: 'in_arbeit', due_date: '2026-11-12', plan_id: ID.planEg, pin_page: 1, pin_x: 0.15, pin_y: 0.25,
      kontakt: 'Lena Fuge', notiz: 'Folgegewerk Fliesen erst nach Freigabe der Abdichtung.', eigen_anteil: 'Abdichtung abnehmen und Protokoll erstellen.', kontrolle: 'BL bis 12.11.' }),
    pk(ID.p2, 2, { text: 'Leerrohre Küche setzen (Herdanschluss, Arbeitsplatte)', gewerk_id: ID.gwElektro, responsible_company_id: ID.coElektro,
      status: 'wichtig', due_date: '2026-11-07', plan_id: ID.planEg, pin_page: 1, pin_x: 0.25, pin_y: 0.75 }),
    pk(ID.p3, 3, { text: 'Container und Lagerfläche vor Haus A räumen', location_id: null, responsible_company_id: ID.coOwn, status: 'erledigt' }),
    pk(ID.p4, 4, { text: 'Estrich OG 1 ab 17.11. begehbar', location_id: ID.og1, status: 'nicht_faellig' }),
    pk(ID.p5, 5, { text: 'Nachtrag Elektro (Mehrmengen Leerrohr) prüfen', location_id: null, gewerk_id: ID.gwElektro, responsible_company_id: ID.coOwn,
      internal: true, published: false }),
  ];
  await tx`INSERT INTO besprechung_punkt ${tx(punkte as never)}`;
  // Sub-task of the supporting firm (concept: "Beteiligte / unterstützende Firmen und Teilaufgaben").
  await tx`INSERT INTO besprechung_teilaufgabe ${tx([{ id: '00000000-0000-4000-8000-000000000f71', punkt_id: ID.p1, project_id: ID.project, company_id: ID.coElektro,
    text: 'Leerrohre im Bad vor der Abdichtung setzen', status: 'erledigt', due_date: '2026-11-08', sort: 0 }] as never)}`;
  await tx`UPDATE besprechung SET allgemein = ${tx.json(['Auf der Baustelle gilt Helmpflicht und PSA.', 'Zufahrt über Tor 2, Anlieferungen bitte vorher anmelden.'] as never)},
             protokollfuehrung = 'Bea Bauleitung', dokumentenstand = 'Stand 03.11.2026' WHERE id = ${ID.bespr1}`;
  await tx`INSERT INTO besprechung_eintrag ${tx(punkte.map((p) => ({ besprechung_id: ID.bespr1, punkt_id: p.id, project_id: ID.project, carried: false,
    status_snapshot: p.status, text_snapshot: p.text })))}`;
  await tx`INSERT INTO mangel_note (id, mangel_id, project_id, text, created_by)
           VALUES (gen_random_uuid(), ${ID.mFliesen}, ${ID.project}, 'Intern: NU war schon zweimal zu spät – ggf. Einbehalt', ${ID.uBauleitung})`;
});
await makePlanPdf('A');
await makePlanPdf('B');
await makeDocPdf(docStorage, 'statik-v1.pdf', 'Statische Berechnung Haus A – Version 1', ['Pos. 1–12 Decken und Unterzüge', 'Stand 01.09.2026']);
await makeDocPdf(docStorage, 'statik-v2.pdf', 'Statische Berechnung Haus A – Version 2', ['Pos. 1–14 Decken und Unterzüge', 'Neu: Pos. 13/14 Wechsel Treppenauge', 'Stand 20.10.2026']);
await makeDocPdf(docStorage, 'brandschutz-v1.pdf', 'Brandschutznachweis Haus A', ['Gebäudeklasse 3', 'Stand 15.09.2026']);
const einrStorage = fileURLToPath(new URL('../../../storage/einreichungen', import.meta.url));
await makeDocPdf(einrStorage, 'nachtrag-elektro-01.pdf', 'Nachtrag 01 – Elektro Blitz GmbH', ['Mehrmengen Leerrohr Küche: 4.850,00 EUR netto']);
await makeDocPdf(einrStorage, 'rechnung-fliesen-ar1.pdf', '1. Abschlagsrechnung – Fliesen Fuchs GmbH', ['Leistungsstand 30 %: 12.400,00 EUR netto']);
console.log('seed ok');
await sql.end();
