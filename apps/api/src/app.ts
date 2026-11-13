import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { asUser, ADMIN_URL, connect, type Sql } from '@bap/db';
import { aktiveModule, allowedTransitions, escalation, type MangelStatus, type Priority, type ProjectRole } from '@bap/domain';
import { issueToken, jwks, verifyToken } from './auth';
import { addFoto, fotoFile } from './foto-service';
import { createFolder, decideDocument, documentFile, dokumenteTree, smartUpload, uploadDocument } from './dokumente-service';
import { attachToZettel, decideZettel, listZettel, saveZettel, submitZettel, zettelAttachment, zettelDetails } from './stunden-service';
import { editEinkauf, editFahrt, editTanken, addFahrt, addFahrzeug, addTanken, addVertrag, attachBeleg, belegFile, createEinkauf, decideEinkauf, fahrtenbuch, kosten, listEinkaeufe, listNu, saveNu, setBudget } from './betrieb-service';
import { decideEinreichung, einreichungFile, listEinreichungen, submitEinreichung } from './einreichung-service';
import { anzeigeDetails, anzeigePdf, maengelBericht, PLAN_DIR, createAnzeige, patchAnzeige, sendAnzeige } from './anzeige-service';
import { etikettenPdf, getFormat as getEtikettenFormat, saveFormat as saveEtikettenFormat } from './etiketten-service';
import { ladeEinstellungen, protokoll, saveEinstellungen, systemUebersicht } from './system-service';
import { bauherrCockpit, leitungCockpit, polierCockpit } from './cockpit-service';
import { createFotodoku, editFotodoku, fotodokuDatei, fotodokuFile, listFotodoku, mangelAusFoto, removeFotodoku } from './fotodoku-service';
import { anzahlUngelesen, banfZuLv, createBanf, editBanf, einkaufsportal, getBanf, listBanf, listNachrichten, nachrichtGelesen, statusBanf } from './bestellung-service';
import { erfasseAngebot, lvPdfIntern, publicLvPdf, saveKalkulation, copyLv, listOrdner, listStamm, removeOrdner, removeStamm, saveOrdner, saveStamm, angebotPdf, getLv, listLv, lvPreisspiegel, publicAnfrage, saveLv, sendAnfragen, submitAngebot, vergeben } from './lv-service';
import { listKontakte, removeKontakt, saveKontakt } from './kontakt-service';
import { adminAssign, adminOverview, adminUpdateUser, ownCompany, ownLogo, updateOwnCompany } from './admin-service';
import { startPage } from './start-service';
import { addFoto as addTbFoto, bauherrFreigabe as tbBauherrFreigabe, bauherrZeichnen as tbBauherrZeichnen, removeVorlage as removeTbVorlage, saveVorlage as saveTbVorlage, addNachtrag, berichtPdf, fotoFile as tbFotoFile, getBericht, listBerichte, saveBericht, signBericht, vorschlag } from './bautagebuch-service';
import { changeLink, linkInfo, listFreimeldungen, publicAnzeige, publicFoto, submitFreimeldung } from './freimeldung-service';
import { acceptInvitation, createAuth, forgotPassword, invitationInfo, invite, login, logout, refresh, removeMember, resetPassword, revokeInvitation, updateMember, zugaenge } from './anmeldung';
import {
  addGewerk, addLocation, canCreateProject, createProject, deleteGewerk, deleteLocation, nuKandidaten, nuUebernehmen, renameGewerk,
  renameLocation, renameProject, structure, takeOverStructure,
} from './projekt-service';
import { getMailVorlage, listVerteiler, mailVorschau, removeVerteiler, saveMailVorlage, saveVerteiler, addPunkt, addPunktFoto, bauherrFreigabe, bauherrGegenzeichnen, besprechungDetails, punktFotoFile, createBesprechung, listBesprechungen, nextTerminIcs, patchBesprechung, patchPunkt, protokollPdf, sendBesprechung, setAnwesenheit, setTeilnehmer } from './besprechung-service';
import { checkRevision, decideRevision, listPlans, stampedRevisionPdf, uploadRevision } from './plan-service';
import { actorFor, createMangel, HttpError, patchMangel, setNachfrist, transitionMangel, type WriteMeta } from './mangel-service';


declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const meta = (req: FastifyRequest, occurredAt?: string | null): WriteMeta => ({
  occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
  deviceId: (req.headers['x-device-id'] as string | undefined) ?? 'web',
});

/** Reads a multipart upload: file + the form fields sent BEFORE the file. */
async function readUpload(req: FastifyRequest) {
  const file = await req.file();
  if (!file) throw new HttpError(422, 'Keine Datei');
  const bytes = await file.toBuffer();
  const fields = Object.fromEntries(Object.entries(file.fields).flatMap(([k, v]) => (v && 'value' in (v as object) ? [[k, (v as { value: string }).value]] : [])));
  return { bytes, name: file.filename, fields };
}

/** At most 30 reports per link and IP within 10 minutes (the link is public). */
const publicHits = new Map<string, { n: number; until: number }>();
function throttlePublic(key: string) {
  const now = Date.now();
  const h = publicHits.get(key);
  if (!h || h.until < now) return void publicHits.set(key, { n: 1, until: now + 10 * 60 * 1000 });
  if (++h.n > 30) throw new HttpError(429, 'Zu viele Meldungen in kurzer Zeit. Bitte später erneut versuchen.');
}

const contentDisposition = (name: string) => `inline; filename*=UTF-8''${encodeURIComponent(name)}`;

export function buildApp(sql: Sql) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.register(cors, { origin: true, allowedHeaders: ['authorization', 'content-type', 'x-device-id'] });
  app.register(multipart, { limits: { fileSize: 300 * 1024 * 1024, files: 1 } }); // A0 plans can be large

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.status(422).send({ error: 'Ungültige Eingabe', details: err.issues });
    // Row level security / permission refused by the database: never a 500.
    if ((err as { code?: string }).code === '42501') return reply.status(403).send({ error: (err as Error).message || 'Keine Berechtigung' });
    app.log.error(err);
    return reply.status(500).send({ error: 'Interner Fehler' });
  });

  // --- public ---------------------------------------------------------------
  app.get('/health', async () => ({ ok: true }));
  app.get('/auth/jwks', async () => jwks());

  /** DURCHSTICH ONLY: login by e-mail of a seeded test user, no password. Disabled in production. */
  const admin = connect(ADMIN_URL, 1);
  app.post('/auth/dev-login', async (req, reply) => {
    if (process.env.NODE_ENV === 'production') return reply.status(404).send();
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const [u] = await admin`SELECT id FROM app_user WHERE email = ${email}`;
    if (!u) throw new HttpError(401, 'Unbekannter Testbenutzer');
    return { token: await issueToken(u.id as string), userId: u.id };
  });

  // --- Anmeldung (public; docs/fachkonzept/01) --------------------------------
  const authP = createAuth();
  const ipOf = (req: { ip: string; headers: Record<string, unknown> }) => String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0]!.trim();
  app.post('/auth/login', async (req) => login(await authP, admin, req.body, ipOf(req), req.headers['user-agent']));
  app.post('/auth/refresh', async (req) => refresh(admin, req.body));
  app.post('/auth/logout', async (req) => logout(admin, req.body));
  app.post('/auth/passwort-vergessen', async (req) => forgotPassword(await authP, req.body, ipOf(req)));
  app.post('/auth/passwort-neu', async (req) => resetPassword(await authP, req.body));
  app.get<{ Params: { token: string } }>('/auth/einladung/:token', async (req) => invitationInfo(admin, req.params.token));
  app.post<{ Params: { token: string } }>('/auth/einladung/:token', async (req) => {
    const body = z.object({ password: z.string() }).passthrough().parse(req.body);
    await acceptInvitation(admin, req.params.token, req.body, ipOf(req));
    const info = await admin`SELECT email FROM einladung WHERE token_hash = ${createHash('sha256').update(req.params.token).digest('hex')}`;
    // Signed in right away (same answer as /auth/login).
    return login(await authP, admin, { email: info[0]!.email, password: body.password }, ipOf(req), req.headers['user-agent']);
  });

  // --- QR-Freimeldung (public, bound to the link token; docs/fachkonzept/04) ----------
  // Offer via link (no account, token-bound; also used from the NU portal).
  app.get<{ Params: { token: string } }>('/public/angebot/:token', async (req) => publicAnfrage(admin, req.params.token));
  app.get<{ Params: { token: string } }>('/public/angebot/:token/pdf', async (req, reply) => {
    const pdf = await publicLvPdf(admin, req.params.token);
    reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${pdf.name}"`);
    return reply.send(Buffer.from(pdf.bytes));
  });
  app.post<{ Params: { token: string } }>('/public/angebot/:token', async (req) => {
    if (req.isMultipart()) {
      const u = await readUpload(req);
      const fields = { ...u.fields, preise: u.fields.preise ? JSON.parse(u.fields.preise) : {} };
      return submitAngebot(admin, req.params.token, fields, u, req.userId ?? null);
    }
    return submitAngebot(admin, req.params.token, req.body, null, req.userId ?? null);
  });
  app.get<{ Params: { token: string } }>('/public/freimeldung/:token', async (req) => publicAnzeige(admin, req.params.token));
  app.get<{ Params: { token: string; fotoId: string } }>('/public/freimeldung/:token/foto/:fotoId', async (req, reply) => {
    const f = await publicFoto(admin, req.params.token, z.string().uuid().parse(req.params.fotoId));
    reply.header('content-type', f.type).header('cache-control', 'private, max-age=3600');
    return reply.send(f.bytes);
  });
  app.post<{ Params: { token: string; posId: string } }>('/public/freimeldung/:token/positionen/:posId', async (req) => {
    const posId = z.string().uuid().parse(req.params.posId);
    let fields: Record<string, string> = {};
    let file: { bytes: Buffer; name: string } | null = null;
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') file = { bytes: await part.toBuffer(), name: part.filename };
        else fields[part.fieldname] = String(part.value);
      }
    } else fields = (req.body ?? {}) as Record<string, string>;
    throttlePublic(`${ipOf(req)}|${req.params.token}`);
    return submitFreimeldung(admin, req.params.token, posId, fields, file, ipOf(req), null);
  });

  // --- authenticated --------------------------------------------------------
  app.addHook('onRequest', async (req) => {
    if (req.url === '/health' || req.url.startsWith('/auth/') || req.url.startsWith('/public/')) return;
    const h = req.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query as Record<string, string>)?.token;
    if (!token) throw new HttpError(401, 'Nicht angemeldet');
    try {
      req.userId = await verifyToken(token);
    } catch {
      throw new HttpError(401, 'Sitzung abgelaufen');
    }
  });

  app.get('/me', async (req) =>
    asUser(sql, req.userId, async (tx) => {
      const [user] = await tx`
        SELECT u.id, u.name, u.email, u.is_admin, u.company_admin, u.fahrtenbuch, c.name AS company, c.kind AS company_kind
        FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = ${req.userId}`;
      // RLS: members see their projects; the administrator sees all projects of the company.
      const projects = await tx`
        SELECT p.id, p.name, coalesce(pm.role, 'admin') AS role, pm.m_plaene, pm.m_dokumente, pm.m_besprechungen, pm.m_bautagebuch, pm.m_stunden, pm.m_nachtraege, pm.m_kosten
        FROM project p LEFT JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = ${req.userId}
        ORDER BY p.name`;
      // Areas switched on for this person (role + switches); the UI hides the rest, RLS enforces it.
      const list = projects.map((p) => ({ id: p.id, name: p.name, role: p.role, module: aktiveModule(p.role as string, p as never) }));
      return { user, projects: list, fahrtenbuch: !!user?.fahrtenbuch || !!user?.is_admin, canCreateProject: await canCreateProject(tx), isAdmin: !!user?.is_admin, companyAdmin: !!user?.company_admin };
    }),
  );

  // --- Besprechung: mail template, distribution list, mail preview (concept points 7/8) ----
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/mail-vorlage', async (req) => asUser(sql, req.userId, (tx) => getMailVorlage(tx, req.userId, req.params.projectId)));
  app.put<{ Params: { projectId: string } }>('/projects/:projectId/mail-vorlage', async (req) => asUser(sql, req.userId, (tx) => saveMailVorlage(tx, req.userId, req.params.projectId, req.body)));
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/verteiler', async (req) => asUser(sql, req.userId, (tx) => listVerteiler(tx, req.userId, req.params.projectId)));
  app.put<{ Params: { projectId: string } }>('/projects/:projectId/verteiler', async (req) => asUser(sql, req.userId, (tx) => saveVerteiler(tx, req.userId, req.params.projectId, req.body)));
  app.delete<{ Params: { id: string } }>('/verteiler/:id', async (req) => asUser(sql, req.userId, (tx) => removeVerteiler(tx, req.userId, req.params.id)));
  app.get<{ Params: { id: string } }>('/besprechungen/:id/mail', async (req) => asUser(sql, req.userId, (tx) => mailVorschau(tx, req.userId, req.params.id)));

  // --- Besprechungen: photos on Punkte, release to the Bauherr, countersignature ---------
  app.post<{ Params: { id: string } }>('/besprechung-punkte/:id/fotos', async (req) => {
    const u = await readUpload(req);
    return asUser(sql, req.userId, (tx) => addPunktFoto(tx, req.userId, req.params.id, u, u.fields.caption ?? null, u.fields.id));
  });
  app.get<{ Params: { id: string } }>('/besprechung-fotos/:id', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => punktFotoFile(tx, req.params.id));
    reply.header('content-type', f.type).header('cache-control', 'private, max-age=86400');
    return reply.send(f.bytes);
  });
  app.post<{ Params: { id: string } }>('/besprechungen/:id/bauherr-freigabe', async (req) =>
    asUser(sql, req.userId, (tx) => bauherrFreigabe(tx, req.userId, req.params.id, z.object({ freigabe: z.boolean() }).parse(req.body).freigabe, meta(req))));
  app.post<{ Params: { id: string } }>('/besprechungen/:id/gegenzeichnen', async (req) => asUser(sql, req.userId, (tx) => bauherrGegenzeichnen(tx, req.userId, req.params.id, req.body, meta(req))));

  // --- Raum-QR-Etiketten -----------------------------------------------------------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/etiketten-format', async (req) => asUser(sql, req.userId, (tx) => getEtikettenFormat(tx, req.userId, req.params.projectId)));
  app.put<{ Params: { projectId: string } }>('/projects/:projectId/etiketten-format', async (req) => asUser(sql, req.userId, (tx) => saveEtikettenFormat(tx, req.userId, req.params.projectId, req.body)));
  app.get<{ Params: { projectId: string }; Querystring: { unter?: string; format?: string } }>('/projects/:projectId/raum-etiketten.pdf', async (req, reply) => {
    const bytes = await asUser(sql, req.userId, (tx) => etikettenPdf(tx, req.userId, req.params.projectId, req.query));
    reply.header('content-type', 'application/pdf').header('content-disposition', 'inline; filename="Raum-Etiketten.pdf"');
    return reply.send(Buffer.from(bytes));
  });

  // --- Einkauf: LV, Anfragen, Preisspiegel ------------------------------------------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/lv', async (req) => asUser(sql, req.userId, (tx) => listLv(tx, req.userId, req.params.projectId)));
  app.put('/lv', async (req) => asUser(sql, req.userId, (tx) => saveLv(tx, req.userId, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/lv/:id', async (req) => asUser(sql, req.userId, (tx) => getLv(tx, req.userId, req.params.id)));
  app.post<{ Params: { id: string } }>('/lv/:id/anfragen', async (req) => asUser(sql, req.userId, (tx) => sendAnfragen(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/lv-ordner', async (req) => asUser(sql, req.userId, (tx) => listOrdner(tx, req.userId, req.params.projectId)));
  app.put<{ Params: { projectId: string } }>('/projects/:projectId/lv-ordner', async (req) => asUser(sql, req.userId, (tx) => saveOrdner(tx, req.userId, req.params.projectId, req.body)));
  app.delete<{ Params: { id: string } }>('/lv-ordner/:id', async (req) => asUser(sql, req.userId, (tx) => removeOrdner(tx, req.params.id)));
  app.post<{ Params: { id: string } }>('/lv/:id/kopie', async (req) => asUser(sql, req.userId, (tx) => copyLv(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Querystring: { q?: string } }>('/stammleistungen', async (req) => asUser(sql, req.userId, (tx) => listStamm(tx, req.query.q)));
  app.put('/stammleistungen', async (req) => asUser(sql, req.userId, (tx) => saveStamm(tx, req.userId, req.body)));
  app.delete<{ Params: { id: string } }>('/stammleistungen/:id', async (req) => asUser(sql, req.userId, (tx) => removeStamm(tx, req.params.id)));
  app.get<{ Params: { id: string } }>('/lv/:id/preisspiegel', async (req) => asUser(sql, req.userId, (tx) => lvPreisspiegel(tx, req.userId, req.params.id)));
  // --- Fotodokumentation (docs/fachkonzept/16) ---------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { plan?: string; kategorie?: string; ort?: string } }>('/projects/:id/fotodoku', async (req) => asUser(sql, req.userId, (tx) => listFotodoku(tx, req.userId, req.params.id, req.query)));
  app.post('/fotodoku', async (req) => asUser(sql, req.userId, (tx) => createFotodoku(tx, req.userId, req.body, meta(req))));
  app.patch<{ Params: { id: string } }>('/fotodoku/:id', async (req) => asUser(sql, req.userId, (tx) => editFotodoku(tx, req.userId, req.params.id, req.body, meta(req))));
  app.delete<{ Params: { id: string } }>('/fotodoku/:id', async (req) => asUser(sql, req.userId, (tx) => removeFotodoku(tx, req.userId, req.params.id, meta(req))));
  app.post<{ Params: { id: string } }>('/fotodoku/:id/datei', async (req) => {
    const u = await readUpload(req);
    return asUser(sql, req.userId, (tx) => fotodokuDatei(tx, req.userId, req.params.id, u.bytes));
  });
  app.get<{ Params: { id: string }; Querystring: { vorschau?: string } }>('/fotodoku/:id/datei', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => fotodokuFile(tx, req.params.id, req.query.vorschau === '1'));
    reply.header('content-type', f.type).header('cache-control', 'private, max-age=604800, immutable');
    return reply.send(f.bytes);
  });
  app.post<{ Params: { id: string } }>('/fotodoku/:id/mangel', async (req) => asUser(sql, req.userId, (tx) => mangelAusFoto(tx, req.userId, req.params.id, req.body, meta(req))));

  // --- Bestellanforderungen, Einkaufsportal, Mitteilungen (docs/fachkonzept/12, 04) -------------------
  app.get<{ Params: { id: string } }>('/projects/:id/bestellanforderungen', async (req) => asUser(sql, req.userId, (tx) => listBanf(tx, req.userId, req.params.id)));
  app.post('/bestellanforderungen', async (req) => asUser(sql, req.userId, (tx) => createBanf(tx, req.userId, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/bestellanforderungen/:id', async (req) => asUser(sql, req.userId, (tx) => getBanf(tx, req.params.id)));
  app.patch<{ Params: { id: string } }>('/bestellanforderungen/:id', async (req) => asUser(sql, req.userId, (tx) => editBanf(tx, req.userId, req.params.id, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/bestellanforderungen/:id/status', async (req) => asUser(sql, req.userId, (tx) => statusBanf(tx, req.userId, req.params.id, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/bestellanforderungen/:id/lv', async (req) => asUser(sql, req.userId, (tx) => banfZuLv(tx, req.userId, req.params.id, meta(req))));
  app.get<{ Querystring: { status?: string } }>('/einkaufsportal', async (req) => asUser(sql, req.userId, (tx) => einkaufsportal(tx, req.query)));
  app.get('/mitteilungen/anzahl', async (req) => asUser(sql, req.userId, (tx) => anzahlUngelesen(tx, req.userId)));
  app.get('/mitteilungen', async (req) => asUser(sql, req.userId, (tx) => listNachrichten(tx, req.userId)));
  app.post<{ Params: { id: string } }>('/mitteilungen/:id/gelesen', async (req) => asUser(sql, req.userId, (tx) => nachrichtGelesen(tx, req.userId, req.params.id === 'alle' ? 'alle' : z.string().uuid().parse(req.params.id))));
  app.put<{ Params: { id: string } }>('/lv/:id/kalkulation', async (req) => asUser(sql, req.userId, (tx) => saveKalkulation(tx, req.userId, req.params.id, req.body)));
  app.post<{ Params: { id: string } }>('/lv/:id/angebote', async (req) => asUser(sql, req.userId, (tx) => erfasseAngebot(tx, req.userId, req.params.id, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/lv/:id/vergeben', async (req) => asUser(sql, req.userId, (tx) => vergeben(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/lv/:id/pdf', async (req, reply) => {
    const pdf = await asUser(sql, req.userId, (tx) => lvPdfIntern(tx, req.userId, req.params.id));
    reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${pdf.name}"`);
    return reply.send(Buffer.from(pdf.bytes));
  });
  app.get<{ Params: { id: string } }>('/angebote/:id/pdf', async (req, reply) => {
    const bytes = await asUser(sql, req.userId, (tx) => angebotPdf(tx, req.params.id));
    reply.header('content-type', 'application/pdf');
    return reply.send(bytes);
  });

  // --- Bautagebuch (docs/fachkonzept/07) ---------------------------------------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/tagesberichte', async (req) => asUser(sql, req.userId, (tx) => listBerichte(tx, req.userId, req.params.projectId)));
  app.get<{ Params: { projectId: string }; Querystring: { datum: string } }>('/projects/:projectId/tagesberichte/vorschlag', async (req) =>
    asUser(sql, req.userId, (tx) => vorschlag(tx, req.userId, req.params.projectId, z.string().date().parse(req.query.datum))));
  app.get<{ Params: { id: string } }>('/tagesberichte/:id', async (req) => asUser(sql, req.userId, (tx) => getBericht(tx, req.userId, req.params.id)));
  app.put('/tagesberichte', async (req, reply) => {
    const r = await asUser(sql, req.userId, (tx) => saveBericht(tx, req.userId, req.body, meta(req)));
    return r.ok ? r.bericht : reply.status(409).send({ error: r.reason });
  });
  for (const kind of ['unterschreiben', 'gegenzeichnen'] as const) {
    app.post<{ Params: { id: string } }>(`/tagesberichte/:id/${kind}`, async (req, reply) => {
      const r = await asUser(sql, req.userId, (tx) => signBericht(tx, req.userId, req.params.id, kind, req.body, meta(req)));
      return r.ok ? r.bericht : reply.status(409).send({ error: r.reason });
    });
  }
  app.post<{ Params: { id: string } }>('/tagesberichte/:id/nachtrag', async (req) => asUser(sql, req.userId, (tx) => addNachtrag(tx, req.userId, req.params.id, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/tagesberichte/:id/fotos', async (req) => {
    const u = await readUpload(req);
    return asUser(sql, req.userId, (tx) => addTbFoto(tx, req.userId, req.params.id, u, u.fields.caption ?? null));
  });
  app.get<{ Params: { id: string } }>('/tagesbericht-fotos/:id', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => tbFotoFile(tx, req.params.id));
    reply.header('content-type', f.type);
    return reply.send(f.bytes);
  });
  app.put('/tagesbericht-vorlagen', async (req) => asUser(sql, req.userId, (tx) => saveTbVorlage(tx, req.userId, req.body)));
  app.delete<{ Params: { id: string } }>('/tagesbericht-vorlagen/:id', async (req) => asUser(sql, req.userId, (tx) => removeTbVorlage(tx, req.params.id)));
  app.post<{ Params: { id: string } }>('/tagesberichte/:id/bauherr-freigabe', async (req) => asUser(sql, req.userId, (tx) => tbBauherrFreigabe(tx, req.userId, req.params.id, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/tagesberichte/:id/bauherr-gegenzeichnen', async (req) => asUser(sql, req.userId, (tx) => tbBauherrZeichnen(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/tagesberichte/:id/pdf', async (req, reply) => {
    const bytes = await asUser(sql, req.userId, (tx) => berichtPdf(tx, req.userId, req.params.id));
    reply.header('content-type', 'application/pdf').header('content-disposition', 'inline; filename="Bautagebuch.pdf"');
    return reply.send(Buffer.from(bytes));
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/cockpit/bauherr', async (req) => asUser(sql, req.userId, (tx) => bauherrCockpit(tx, req.userId, req.params.projectId)));
  // --- IT administration (settings, system overview, audit log) ---------------------------------
  app.get('/einstellungen', async (req) => asUser(sql, req.userId, (tx) => ladeEinstellungen(tx)));
  app.put('/admin/einstellungen', async (req) => asUser(sql, req.userId, (tx) => saveEinstellungen(tx, req.userId, req.body, meta(req))));
  app.get('/admin/system', async (req) => asUser(sql, req.userId, (tx) => systemUebersicht(tx)));
  app.get('/admin/protokoll', async (req) => asUser(sql, req.userId, (tx) => protokoll(tx, req.query)));
  app.get('/cockpit/leitung', async (req) => asUser(sql, req.userId, (tx) => leitungCockpit(tx)));
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/cockpit/polier', async (req) => asUser(sql, req.userId, (tx) => polierCockpit(tx, req.userId, req.params.projectId)));
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/start', async (req) => asUser(sql, req.userId, (tx) => startPage(tx, req.userId, req.params.projectId)));

  // --- Administration -------------------------------------------------------------
  app.get('/admin', async (req) => asUser(sql, req.userId, (tx) => adminOverview(tx)));
  app.patch<{ Params: { id: string } }>('/admin/users/:id', async (req) => asUser(sql, req.userId, (tx) => adminUpdateUser(tx, req.userId, req.params.id, req.body, meta(req))));

  // --- Freimelde-Link je Mangelanzeige (Leitung) -------------------------------------
  app.get<{ Params: { id: string } }>('/mangelanzeigen/:id/link', async (req) => asUser(sql, req.userId, (tx) => linkInfo(tx, req.userId, req.params.id)));
  app.post<{ Params: { id: string } }>('/mangelanzeigen/:id/link', async (req) => asUser(sql, req.userId, (tx) => changeLink(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/mangelanzeigen/:id/freimeldungen', async (req) => asUser(sql, req.userId, (tx) => listFreimeldungen(tx, req.userId, req.params.id)));

  // --- Zugänge: Einladungen, Mitglieder ---------------------------------------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/zugaenge', async (req) => asUser(sql, req.userId, (tx) => zugaenge(tx, req.userId, req.params.projectId)));
  app.post('/einladungen', async (req) => asUser(sql, req.userId, (tx) => invite(tx, req.userId, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/einladungen/:id/zurueckziehen', async (req) => asUser(sql, req.userId, (tx) => revokeInvitation(tx, req.userId, req.params.id, meta(req))));
  app.get<{ Querystring: { project?: string } }>('/kontakte', async (req) => asUser(sql, req.userId, (tx) => listKontakte(tx, req.query.project)));
  app.put('/kontakte', async (req) => asUser(sql, req.userId, (tx) => saveKontakt(tx, req.userId, req.body)));
  app.delete<{ Params: { id: string } }>('/kontakte/:id', async (req) => asUser(sql, req.userId, (tx) => removeKontakt(tx, req.params.id)));
  app.patch<{ Params: { id: string } }>('/mitglieder/:id', async (req) => asUser(sql, req.userId, (tx) => updateMember(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get('/firma', async (req) => asUser(sql, req.userId, (tx) => ownCompany(tx)));
  app.get('/firma/logo', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => ownLogo(tx));
    reply.header('content-type', f.type);
    return reply.send(f.bytes);
  });
  app.post('/admin/firma', async (req) => {
    if (req.isMultipart()) {
      const u = await readUpload(req);
      return asUser(sql, req.userId, (tx) => updateOwnCompany(tx, u.fields, u));
    }
    return asUser(sql, req.userId, (tx) => updateOwnCompany(tx, req.body, null));
  });
  app.post<{ Params: { id: string } }>('/admin/users/:id/projekte', async (req) => asUser(sql, req.userId, (tx) => adminAssign(tx, req.userId, req.params.id, req.body, meta(req))));
  app.delete<{ Params: { id: string } }>('/mitglieder/:id', async (req) => asUser(sql, req.userId, (tx) => removeMember(tx, req.userId, req.params.id, meta(req))));

  // --- Projekte und Struktur (docs/fachkonzept/01, 02) --------------------------------
  app.post('/projects', async (req) => asUser(sql, req.userId, (tx) => createProject(tx, req.userId, req.body, meta(req))));
  app.patch<{ Params: { projectId: string } }>('/projects/:projectId', async (req) => asUser(sql, req.userId, (tx) => renameProject(tx, req.userId, req.params.projectId, req.body, meta(req))));
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/struktur', async (req) => asUser(sql, req.userId, (tx) => structure(tx, req.userId, req.params.projectId)));
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/struktur-uebernehmen', async (req) =>
    asUser(sql, req.userId, (tx) => takeOverStructure(tx, req.userId, req.params.projectId, req.body, meta(req))));
  app.post('/locations', async (req) => asUser(sql, req.userId, (tx) => addLocation(tx, req.userId, req.body, meta(req))));
  app.patch<{ Params: { id: string } }>('/locations/:id', async (req) => asUser(sql, req.userId, (tx) => renameLocation(tx, req.userId, req.params.id, req.body, meta(req))));
  app.delete<{ Params: { id: string } }>('/locations/:id', async (req) => {
    await asUser(sql, req.userId, (tx) => deleteLocation(tx, req.userId, req.params.id, meta(req)));
    return { ok: true };
  });
  app.post('/gewerke', async (req) => asUser(sql, req.userId, (tx) => addGewerk(tx, req.userId, req.body, meta(req))));
  app.patch<{ Params: { id: string } }>('/gewerke/:id', async (req) => asUser(sql, req.userId, (tx) => renameGewerk(tx, req.userId, req.params.id, req.body, meta(req))));
  app.delete<{ Params: { id: string } }>('/gewerke/:id', async (req) => {
    await asUser(sql, req.userId, (tx) => deleteGewerk(tx, req.userId, req.params.id, meta(req)));
    return { ok: true };
  });
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/nu-kandidaten', async (req) => asUser(sql, req.userId, (tx) => nuKandidaten(tx, req.userId, req.params.projectId)));
  app.post<{ Params: { projectId: string } }>('/projects/:projectId/nu-uebernehmen', async (req) =>
    asUser(sql, req.userId, (tx) => nuUebernehmen(tx, req.userId, req.params.projectId, req.body, meta(req))));

  app.get<{ Params: { projectId: string } }>('/projects/:projectId', async (req) =>
    asUser(sql, req.userId, async (tx) => {
      const actor = await actorFor(tx, req.userId, req.params.projectId);
      const p = req.params.projectId;
      const [project] = await tx`SELECT id, name FROM project WHERE id = ${p}`;
      return {
        project,
        role: actor.role,
        roleLabel: actor.roleLabel,
        companyId: actor.companyId,
        locations: await tx`SELECT id, parent_id, kind, name, nummer FROM location WHERE project_id = ${p} ORDER BY sort, name`,
        gewerke: await tx`SELECT id, name FROM gewerk WHERE project_id = ${p} ORDER BY name`,
        gewerkCompanies: await tx`SELECT gc.gewerk_id, gc.company_id FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE g.project_id = ${p}`,
        companies: await tx`
          SELECT DISTINCT c.id, c.name, c.kind, c.email FROM company c
          WHERE EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = c.id AND pm.project_id = ${p})
             OR EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = ${p})
          ORDER BY c.name`,
        // Plans come from the Dokumente folders (docs/fachkonzept/03); folder name groups them on the plan page.
        plans: await tx`
          SELECT p.id, p.location_id, p.name, p.plan_index, p.page_count, f.name AS folder_name, p.current_revision_id IS NOT NULL AS released
          FROM plan p LEFT JOIN folder f ON f.id = p.folder_id
          WHERE p.project_id = ${p} ORDER BY f.sort NULLS LAST, f.name, p.name`,
        locationAreas: await tx`SELECT location_id, plan_id, page, x0, y0, x1, y1 FROM location_area WHERE project_id = ${p}`,
      };
    }),
  );

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/maengel', async (req) =>
    asUser(sql, req.userId, async (tx) => {
      const actor = await actorFor(tx, req.userId, req.params.projectId);
      const rows = await tx`
        SELECT m.*, l.name AS location_name, g.name AS gewerk_name, c.name AS assigned_company_name, u.name AS created_by_name,
               an.id AS anzeige_id, an.number AS anzeige_number, an.status AS anzeige_status, an.sent_at AS anzeige_sent_at,
               coalesce((SELECT json_agg(json_build_object('id', f.id, 'kind', f.kind, 'taken_at', f.taken_at) ORDER BY f.taken_at)
                         FROM mangel_foto f WHERE f.mangel_id = m.id), '[]') AS fotos
        FROM mangel m
        LEFT JOIN LATERAL (
          SELECT a.id, a.number, a.status, a.sent_at FROM mangelanzeige_position p JOIN mangelanzeige a ON a.id = p.anzeige_id
          WHERE p.mangel_id = m.id ORDER BY (a.status = 'versendet') DESC, a.created_at DESC LIMIT 1
        ) an ON true
        JOIN location l ON l.id = m.location_id
        JOIN gewerk g ON g.id = m.gewerk_id
        LEFT JOIN company c ON c.id = m.assigned_company_id
        LEFT JOIN app_user u ON u.id = m.created_by
        WHERE m.project_id = ${req.params.projectId} AND m.deleted_at IS NULL
        ORDER BY m.number`;
      const notes = actor.role === 'bauleitung' || actor.role === 'polier'
        ? await tx`SELECT mangel_id, text, created_at FROM mangel_note WHERE project_id = ${req.params.projectId} ORDER BY created_at`
        : [];
      return rows.map((m) => ({
        ...m,
        escalation: escalation({ status: m.status as MangelStatus, due_date: iso(m.due_date), nachfrist_date: iso(m.nachfrist_date), priority: m.priority as Priority }),
        allowed_transitions: allowedTransitions(
          { role: actor.role, userId: actor.userId, companyId: actor.companyId },
          { status: m.status as MangelStatus, createdBy: m.created_by as string, creatorRole: m.creator_role as ProjectRole, assignedCompanyId: m.assigned_company_id as string | null },
        ),
        notes: notes.filter((n) => n.mangel_id === m.id),
      }));
    }),
  );

  app.post('/maengel', async (req) => asUser(sql, req.userId, (tx) => createMangel(tx, req.userId, req.body, meta(req))));

  app.patch<{ Params: { id: string } }>('/maengel/:id', async (req, reply) => {
    const { base_version, ...fields } = z.object({ base_version: z.number().int() }).passthrough().parse(req.body);
    const r = await asUser(sql, req.userId, (tx) => patchMangel(tx, req.userId, req.params.id, base_version, fields, meta(req)));
    return r.ok ? r.mangel : reply.status(409).send(r);
  });

  app.post<{ Params: { id: string } }>('/maengel/:id/transition', async (req, reply) => {
    const r = await asUser(sql, req.userId, (tx) => transitionMangel(tx, req.userId, req.params.id, req.body, meta(req)));
    return r.ok ? r.mangel : reply.status(409).send(r);
  });

  app.post<{ Params: { id: string } }>('/maengel/:id/nachfrist', async (req, reply) => {
    const b = z.object({ date: z.string().date(), base_version: z.number().int() }).parse(req.body);
    const r = await asUser(sql, req.userId, (tx) => setNachfrist(tx, req.userId, req.params.id, b.date, b.base_version, meta(req)));
    return r.ok ? r.mangel : reply.status(409).send(r);
  });

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/conflicts', async (req) =>
    asUser(sql, req.userId, (tx) => tx`
      SELECT sc.*, u.name AS actor_name, m.number FROM sync_conflict sc
      JOIN app_user u ON u.id = sc.actor_id LEFT JOIN mangel m ON m.id = sc.entity_id
      WHERE sc.project_id = ${req.params.projectId} AND sc.resolved_at IS NULL ORDER BY sc.created_at DESC`),
  );

  app.post<{ Params: { id: string } }>('/conflicts/:id/resolve', async (req) =>
    asUser(sql, req.userId, async (tx) => {
      const [c] = await tx`UPDATE sync_conflict SET resolved_at = now(), resolved_by = ${req.userId} WHERE id = ${req.params.id} RETURNING id`;
      if (!c) throw new HttpError(404, 'Konflikt nicht gefunden oder keine Berechtigung');
      return { ok: true };
    }),
  );

  /** Plan file. Access check via RLS on plan. (Later: object storage with signed URLs.) */
  app.get<{ Params: { id: string } }>('/plans/:id/file', async (req, reply) => {
    const plan = await asUser(sql, req.userId, async (tx) => (await tx`SELECT file_key, name FROM plan WHERE id = ${req.params.id}`)[0]);
    if (!plan) throw new HttpError(404, 'Plan nicht gefunden');
    reply.header('content-type', 'application/pdf');
    return reply.send(createReadStream(PLAN_DIR + (plan.file_key as string).replace(/[^a-z0-9._-]/gi, '')));
  });

  // --- Fotos & Mängelbericht (docs/fachkonzept/04) -------------------------------
  app.post<{ Params: { id: string } }>('/maengel/:id/fotos', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(422, 'Kein Foto');
    const bytes = await file.toBuffer();
    const fields = Object.fromEntries(Object.entries(file.fields).flatMap(([k, v]) => (v && 'value' in (v as object) ? [[k, (v as { value: string }).value]] : [])));
    return asUser(sql, req.userId, (tx) => addFoto(tx, req.userId, req.params.id, fields, bytes, meta(req, fields.taken_at as string | undefined)));
  });
  app.get<{ Params: { id: string } }>('/fotos/:id/file', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => fotoFile(tx, req.params.id));
    reply.header('content-type', f.type).header('cache-control', 'private, max-age=86400');
    return reply.send(f.bytes);
  });
  /** Mängelbericht: ids = selection (else all visible), sort and gruppen (folders, e.g. "firma,monat") as in the list. */
  app.get<{ Params: { projectId: string }; Querystring: { ids?: string; sort?: string; gruppen?: string } }>('/projects/:projectId/maengel/pdf', async (req, reply) => {
    const ids = (req.query.ids ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x));
    const q = z.object({
      sort: z.enum(['nummer', 'firma', 'datum_neu', 'datum_alt', 'frist', 'ort']).optional(),
      gruppen: z.string().optional().transform((v) => (v ? v.split(',') : [])).pipe(z.array(z.enum(['firma', 'geschoss', 'ort', 'gewerk', 'monat', 'tag', 'status'])).max(3)),
    }).parse(req.query);
    const bytes = await asUser(sql, req.userId, (tx) => maengelBericht(tx, req.userId, req.params.projectId, ids, { sort: q.sort, gruppen: q.gruppen }));
    reply.header('content-type', 'application/pdf').header('content-disposition', 'inline; filename="Maengelbericht.pdf"');
    return reply.send(Buffer.from(bytes));
  });

  // --- Mangelanzeigen (docs/fachkonzept/04-maengel.md) --------------------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/mangelanzeigen', async (req) =>
    asUser(sql, req.userId, async (tx) => {
      await actorFor(tx, req.userId, req.params.projectId);
      return tx`
        SELECT a.id, a.number, a.status, a.deadline, a.company_id, c.name AS company_name, a.recipient_email, a.sent_at, a.created_at, a.version,
               (SELECT count(*)::int FROM mangelanzeige_position p WHERE p.anzeige_id = a.id) AS positions
        FROM mangelanzeige a JOIN company c ON c.id = a.company_id
        WHERE a.project_id = ${req.params.projectId} ORDER BY a.created_at DESC`;
    }),
  );
  app.get<{ Params: { id: string } }>('/mangelanzeigen/:id', async (req) => asUser(sql, req.userId, (tx) => anzeigeDetails(tx, req.params.id)));
  app.post('/mangelanzeigen', async (req) => asUser(sql, req.userId, (tx) => createAnzeige(tx, req.userId, req.body, meta(req))));
  app.patch<{ Params: { id: string } }>('/mangelanzeigen/:id', async (req) => {
    const { base_version, ...fields } = z.object({ base_version: z.number().int() }).passthrough().parse(req.body);
    return asUser(sql, req.userId, (tx) => patchAnzeige(tx, req.userId, req.params.id, base_version, fields, meta(req)));
  });
  app.post<{ Params: { id: string } }>('/mangelanzeigen/:id/send', async (req) => {
    const { base_version } = z.object({ base_version: z.number().int() }).parse(req.body);
    return asUser(sql, req.userId, (tx) => sendAnzeige(tx, req.userId, req.params.id, base_version, meta(req)));
  });
  app.get<{ Params: { id: string } }>('/mangelanzeigen/:id/pdf', async (req, reply) => {
    const pdf = await asUser(sql, req.userId, (tx) => anzeigePdf(tx, req.userId, req.params.id));
    reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${pdf.name}"`);
    return reply.send(typeof pdf.bytes === 'string' ? createReadStream(pdf.bytes) : Buffer.from(pdf.bytes));
  });

  // --- Pläne: register, revisions, approval, QR check (docs/fachkonzept/03) -------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/plaene', async (req) => asUser(sql, req.userId, (tx) => listPlans(tx, req.userId, req.params.projectId)));
  app.post('/plan-revisions', async (req) => {
    const file = await req.file();
    if (!file) throw new HttpError(422, 'Keine Datei');
    const bytes = await file.toBuffer();
    const fields = Object.fromEntries(Object.entries(file.fields).flatMap(([k, v]) => (v && 'value' in (v as object) ? [[k, (v as { value: string }).value]] : [])));
    return asUser(sql, req.userId, (tx) => uploadRevision(tx, req.userId, fields, bytes, meta(req)));
  });
  app.post<{ Params: { id: string } }>('/plan-revisions/:id/decision', async (req) =>
    asUser(sql, req.userId, (tx) => decideRevision(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/plan-revisions/:id/check', async (req) => asUser(sql, req.userId, (tx) => checkRevision(tx, req.params.id)));
  app.get<{ Params: { id: string } }>('/plan-revisions/:id/pdf', async (req, reply) => {
    const pdf = await asUser(sql, req.userId, async (tx) => {
      const [r] = await tx`SELECT id FROM plan_revision WHERE id = ${req.params.id}`; // RLS: NU/Bauherr only the released one
      if (!r) throw new HttpError(404, 'Planstand nicht gefunden');
      return stampedRevisionPdf(tx, req.params.id);
    });
    reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${encodeURIComponent(pdf.name)}"`);
    return reply.send(Buffer.from(pdf.bytes));
  });

  // --- Dokumente: folders, versions, "Alt", QR (docs/fachkonzept/03) ---------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/dokumente', async (req) => asUser(sql, req.userId, (tx) => dokumenteTree(tx, req.userId, req.params.projectId)));
  app.post('/folders', async (req) => asUser(sql, req.userId, (tx) => createFolder(tx, req.userId, req.body, meta(req))));
  app.post('/document-revisions', async (req) => {
    const u = await readUpload(req);
    return asUser(sql, req.userId, (tx) => uploadDocument(tx, req.userId, u.fields, u, meta(req)));
  });
  app.post('/dokumente/upload', async (req) => {
    const u = await readUpload(req);
    return asUser(sql, req.userId, (tx) => smartUpload(tx, req.userId, u.fields, u, meta(req)));
  });
  app.post<{ Params: { id: string } }>('/document-revisions/:id/decision', async (req) => asUser(sql, req.userId, (tx) => decideDocument(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/document-revisions/:id/file', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => documentFile(tx, req.params.id));
    reply.header('content-type', f.mime).header('content-disposition', contentDisposition(f.name));
    return reply.send(f.bytes);
  });

  // --- Stundenzettel (docs/fachkonzept/08) -------------------------------------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/stundenzettel', async (req) => asUser(sql, req.userId, (tx) => listZettel(tx, req.userId, req.params.projectId)));
  app.get<{ Params: { id: string } }>('/stundenzettel/:id', async (req) => asUser(sql, req.userId, (tx) => zettelDetails(tx, req.userId, req.params.id)));
  app.put('/stundenzettel', async (req) => asUser(sql, req.userId, (tx) => saveZettel(tx, req.userId, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/stundenzettel/:id/submit', async (req) => {
    const { base_version } = z.object({ base_version: z.number().int() }).parse(req.body);
    return asUser(sql, req.userId, (tx) => submitZettel(tx, req.userId, req.params.id, base_version, meta(req)));
  });
  app.post<{ Params: { id: string } }>('/stundenzettel/:id/decision', async (req) => asUser(sql, req.userId, (tx) => decideZettel(tx, req.userId, req.params.id, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/stundenzettel/:id/anhang', async (req) => {
    const u = await readUpload(req);
    return asUser(sql, req.userId, (tx) => attachToZettel(tx, req.userId, req.params.id, u, meta(req)));
  });
  app.get<{ Params: { id: string } }>('/stundenzettel/:id/anhang', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => zettelAttachment(tx, req.params.id));
    reply.header('content-type', f.mime);
    return reply.send(f.bytes);
  });

  // --- NU-Einreichungen: Nachträge und Rechnungen (docs/fachkonzept/11) ----------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/einreichungen', async (req) => asUser(sql, req.userId, (tx) => listEinreichungen(tx, req.userId, req.params.projectId)));
  app.post('/einreichungen', async (req) => {
    const u = await readUpload(req);
    return asUser(sql, req.userId, (tx) => submitEinreichung(tx, req.userId, u.fields, u, meta(req)));
  });
  app.post<{ Params: { id: string } }>('/einreichungen/:id/decision', async (req) => asUser(sql, req.userId, (tx) => decideEinreichung(tx, req.userId, req.params.id, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/einreichungen/:id/file', async (req, reply) => {
    const f = await asUser(sql, req.userId, (tx) => einreichungFile(tx, req.params.id));
    reply.header('content-type', f.mime).header('content-disposition', contentDisposition(f.name));
    return reply.send(f.bytes);
  });

  // --- Nachunternehmer, Einkäufe, Fahrtenbuch, Kosten (docs/fachkonzept/11, 14) ---------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/nachunternehmer', async (req) => asUser(sql, req.userId, (tx) => listNu(tx, req.userId, req.params.projectId)));
  app.put('/nachunternehmer', async (req) => asUser(sql, req.userId, (tx) => saveNu(tx, req.userId, req.body, meta(req))));
  app.post('/vertraege', async (req) => asUser(sql, req.userId, (tx) => addVertrag(tx, req.userId, req.body, meta(req))));
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/einkaeufe', async (req) => asUser(sql, req.userId, (tx) => listEinkaeufe(tx, req.userId, req.params.projectId)));
  app.post('/einkaeufe', async (req) => asUser(sql, req.userId, (tx) => createEinkauf(tx, req.userId, req.body, meta(req))));
  app.post<{ Params: { id: string } }>('/einkaeufe/:id/decision', async (req) => asUser(sql, req.userId, (tx) => decideEinkauf(tx, req.userId, req.params.id, req.body, meta(req))));
  for (const kind of ['einkauf', 'tankvorgang'] as const) {
    const base = kind === 'einkauf' ? '/einkaeufe' : '/tankvorgaenge';
    app.post<{ Params: { id: string } }>(`${base}/:id/beleg`, async (req) => {
      const u = await readUpload(req);
      return asUser(sql, req.userId, (tx) => attachBeleg(tx, kind, req.params.id, u));
    });
    app.get<{ Params: { id: string } }>(`${base}/:id/beleg`, async (req, reply) => {
      const f = await asUser(sql, req.userId, (tx) => belegFile(tx, kind, req.params.id));
      reply.header('content-type', f.mime);
      return reply.send(f.bytes);
    });
  }
  app.get('/fahrtenbuch', async (req) => asUser(sql, req.userId, (tx) => fahrtenbuch(tx, req.userId)));
  app.post('/fahrzeuge', async (req) => asUser(sql, req.userId, (tx) => addFahrzeug(tx, req.userId, req.body)));
  app.post('/fahrten', async (req) => asUser(sql, req.userId, (tx) => addFahrt(tx, req.userId, req.body)));
  app.patch<{ Params: { id: string } }>('/einkaeufe/:id', async (req) => asUser(sql, req.userId, (tx) => editEinkauf(tx, req.userId, req.params.id, req.body)));
  app.patch<{ Params: { id: string } }>('/fahrten/:id', async (req) => asUser(sql, req.userId, (tx) => editFahrt(tx, req.userId, req.params.id, req.body)));
  app.patch<{ Params: { id: string } }>('/tankvorgaenge/:id', async (req) => asUser(sql, req.userId, (tx) => editTanken(tx, req.userId, req.params.id, req.body)));
  app.post('/tankvorgaenge', async (req) => asUser(sql, req.userId, (tx) => addTanken(tx, req.userId, req.body)));
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/kosten', async (req) => asUser(sql, req.userId, (tx) => kosten(tx, req.userId, req.params.projectId)));
  app.put<{ Params: { id: string } }>('/gewerke/:id/budget', async (req) => asUser(sql, req.userId, (tx) => setBudget(tx, req.userId, req.params.id, req.body, meta(req))));

  // --- Besprechungen (docs/fachkonzept/09) ------------------------------------------
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/besprechungen', async (req) =>
    asUser(sql, req.userId, (tx) => listBesprechungen(tx, req.userId, req.params.projectId)));
  app.post('/besprechungen', async (req) => asUser(sql, req.userId, (tx) => createBesprechung(tx, req.userId, req.body, meta(req))));
  app.get<{ Params: { id: string } }>('/besprechungen/:id', async (req) => asUser(sql, req.userId, (tx) => besprechungDetails(tx, req.userId, req.params.id)));
  app.put<{ Params: { id: string } }>('/besprechungen/:id/teilnehmer', async (req) => {
    const { company_ids } = z.object({ company_ids: z.array(z.string().uuid()) }).parse(req.body);
    await asUser(sql, req.userId, (tx) => setTeilnehmer(tx, req.userId, req.params.id, company_ids, meta(req)));
    return { ok: true };
  });
  app.put<{ Params: { id: string; companyId: string } }>('/besprechungen/:id/teilnehmer/:companyId/anwesenheit', async (req) => {
    const { anwesend } = z.object({ anwesend: z.boolean().nullable() }).parse(req.body);
    await asUser(sql, req.userId, (tx) => setAnwesenheit(tx, req.userId, req.params.id, req.params.companyId, anwesend, meta(req)));
    return { ok: true };
  });
  app.patch<{ Params: { id: string } }>('/besprechungen/:id', async (req) => {
    const { base_version, ...fields } = z.object({ base_version: z.number().int() }).passthrough().parse(req.body);
    return asUser(sql, req.userId, (tx) => patchBesprechung(tx, req.userId, req.params.id, base_version, fields, meta(req)));
  });
  app.get<{ Params: { id: string } }>('/besprechungen/:id/naechster-termin.ics', async (req, reply) => {
    const ics = await asUser(sql, req.userId, (tx) => nextTerminIcs(tx, req.userId, req.params.id));
    reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="Naechster-Termin.ics"');
    return reply.send(ics);
  });
  /** Punkte with a plan pin, for the plan view; besprechungen = numbers of the meetings they appeared in (filter). */
  app.get<{ Params: { projectId: string } }>('/projects/:projectId/punkte-pins', async (req) =>
    asUser(sql, req.userId, async (tx) => {
      await actorFor(tx, req.userId, req.params.projectId);
      return tx`
        SELECT p.id, p.number, p.text, p.status, p.plan_id, p.pin_page, p.pin_x, p.pin_y,
               coalesce(array_agg(b.number ORDER BY b.number) FILTER (WHERE b.id IS NOT NULL), '{}') AS besprechungen
        FROM besprechung_punkt p
        LEFT JOIN besprechung_eintrag e ON e.punkt_id = p.id LEFT JOIN besprechung b ON b.id = e.besprechung_id
        WHERE p.project_id = ${req.params.projectId} AND p.plan_id IS NOT NULL
        GROUP BY p.id`;
    }),
  );
  app.post('/punkte', async (req, reply) => {
    const r = await asUser(sql, req.userId, (tx) => addPunkt(tx, req.userId, req.body, meta(req)));
    return r.ok ? r.punkt : reply.status(409).send(r);
  });
  app.patch<{ Params: { id: string } }>('/punkte/:id', async (req, reply) => {
    const { base_version, ...fields } = z.object({ base_version: z.number().int() }).passthrough().parse(req.body);
    const r = await asUser(sql, req.userId, (tx) => patchPunkt(tx, req.userId, req.params.id, base_version, fields, meta(req)));
    return r.ok ? r.punkt : reply.status(409).send(r);
  });
  app.post<{ Params: { id: string } }>('/besprechungen/:id/send', async (req) => {
    const { base_version } = z.object({ base_version: z.number().int() }).parse(req.body);
    return asUser(sql, req.userId, (tx) => sendBesprechung(tx, req.userId, req.params.id, base_version, meta(req)));
  });
  app.get<{ Params: { id: string }; Querystring: { company?: string } }>('/besprechungen/:id/pdf', async (req, reply) => {
    const bytes = await asUser(sql, req.userId, (tx) => protokollPdf(tx, req.userId, req.params.id, req.query.company));
    reply.header('content-type', 'application/pdf').header('content-disposition', 'inline; filename="Protokoll.pdf"');
    return reply.send(Buffer.from(bytes));
  });

  /**
   * Upload endpoint for the PowerSync client (offline queue). Business rejections never throw:
   * otherwise the device queue would retry forever. They are recorded as sync_conflict and the
   * device receives the server state on the next sync.
   */
  const UploadOp = z.object({
    op: z.enum(['PUT', 'PATCH', 'DELETE']),
    table: z.string(),
    id: z.string().uuid(),
    data: z.record(z.unknown()).nullish(),
  });
  app.post('/sync/upload', async (req) => {
    const { ops } = z.object({ ops: z.array(UploadOp) }).parse(req.body);
    const results: unknown[] = [];
    for (const op of ops) {
      const data = op.data ?? {};
      const m = meta(req, data.occurred_at as string | undefined);
      try {
        const r = await asUser(sql, req.userId, async (tx) => {
          if (op.table === 'mangel' && op.op === 'PUT') {
            // SQLite has no booleans/undefined: drop nulls, map 0/1, use the device timestamp as occurred_at.
            const rest = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
            if (typeof rest.visible_to_bauherr === 'number') rest.visible_to_bauherr = rest.visible_to_bauherr === 1;
            const created = meta(req, (data.occurred_at ?? data.created_at) as string | undefined);
            return { ok: true, mangel: await createMangel(tx, req.userId, { ...rest, id: op.id }, created) };
          }
          if (op.table === 'mangel_action' && op.op === 'PUT') {
            const a = z.object({ mangel_id: z.string().uuid(), action: z.enum(['transition', 'patch', 'nachfrist']), payload: z.string(), base_version: z.coerce.number().int() }).parse(data);
            const payload = JSON.parse(a.payload) as Record<string, unknown>;
            if (a.action === 'transition') return transitionMangel(tx, req.userId, a.mangel_id, { ...payload, base_version: a.base_version }, m);
            if (a.action === 'nachfrist') return setNachfrist(tx, req.userId, a.mangel_id, payload.date as string, a.base_version, m);
            return patchMangel(tx, req.userId, a.mangel_id, a.base_version, payload, m);
          }
          // Einkäufe, Fahrten, Tanken recorded on the phone (offline).
          if ((op.table === 'einkauf' || op.table === 'fahrt' || op.table === 'tankvorgang') && op.op === 'PUT') {
            const rest = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
            if (op.table === 'einkauf') return { ok: true, einkauf: await createEinkauf(tx, req.userId, { ...rest, id: op.id }, meta(req, (data.created_at as string) ?? undefined)) };
            if (op.table === 'fahrt') return { ok: true, ...(await addFahrt(tx, req.userId, { ...rest, id: op.id })) };
            return { ok: true, tankvorgang: await addTanken(tx, req.userId, { ...rest, id: op.id }) };
          }
          // NU-Besprechung on the tablet (offline): new Punkte and status chips.
          if (op.table === 'besprechung_punkt' && op.op === 'PUT') {
            const rest = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
            if (typeof rest.internal === 'number') rest.internal = rest.internal === 1;
            if (typeof rest.support_company_ids === 'string') rest.support_company_ids = JSON.parse(rest.support_company_ids as string);
            rest.besprechung_id ??= rest.first_besprechung_id; // local column name on the device
            const created = meta(req, (data.occurred_at ?? data.created_at) as string | undefined);
            return addPunkt(tx, req.userId, { ...rest, id: op.id }, created);
          }
          // Fotodoku entry made on the phone (offline); the file follows via /fotodoku/:id/datei.
          if (op.table === 'foto_doku' && op.op === 'PUT') {
            const { created_at: _c, ist_360, pin_page, ...rest } = data as Record<string, unknown>;
            const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
            return { ok: true, foto_doku: await createFotodoku(tx, req.userId, { ...clean, id: op.id, ist_360: ist_360 === 1 || ist_360 === true, pin_page: pin_page ?? undefined }, meta(req)) };
          }
          // Bestellanforderung made on the phone (offline): created once, idempotent by id.
          if (op.table === 'bestellanforderung' && op.op === 'PUT') {
            const { id: _i, created_at, positionen, dringend, ...rest } = data as Record<string, unknown>;
            const pos = typeof positionen === 'string' ? JSON.parse(positionen) : positionen ?? [];
            return { ok: true, bestellanforderung: await createBanf(tx, req.userId, { ...rest, id: op.id, positionen: pos, dringend: dringend === 1 || dringend === true },
              meta(req, (created_at as string) ?? undefined)) };
          }
          if (op.table === 'punkt_action' && op.op === 'PUT') {
            const a = z.object({ punkt_id: z.string().uuid(), payload: z.string(), base_version: z.coerce.number().int() }).parse(data);
            return patchPunkt(tx, req.userId, a.punkt_id, a.base_version, JSON.parse(a.payload), m);
          }
          // Bautagebuch from the device (offline): whole drafts, signing and Nachträge through one ordered queue,
          // each applied only if the report is still at base_version (otherwise sync_conflict).
          if (op.table === 'tagesbericht_action' && op.op === 'PUT') {
            const a = z.object({ bericht_id: z.string().uuid(), action: z.enum(['speichern', 'unterschreiben', 'gegenzeichnen', 'nachtrag']), payload: z.string(), base_version: z.coerce.number().int() }).parse(data);
            const payload = JSON.parse(a.payload) as Record<string, unknown>;
            const when = meta(req, (data.occurred_at as string) ?? undefined);
            const [fresh] = await tx`INSERT INTO tagesbericht_action (id, bericht_id, action, payload, base_version) VALUES (${op.id}, ${a.bericht_id}, ${a.action}, ${tx.json(payload as never)}, ${a.base_version})
              ON CONFLICT (id) DO NOTHING RETURNING id`;
            if (!fresh) return { ok: true, duplicate: true };
            if (a.action === 'speichern') return saveBericht(tx, req.userId, { ...payload, id: a.bericht_id, version: a.base_version || undefined }, when);
            if (a.action === 'nachtrag') return addNachtrag(tx, req.userId, a.bericht_id, { id: op.id, text: payload.text }, when);
            return signBericht(tx, req.userId, a.bericht_id, a.action, { signature: payload.signature, base_version: a.base_version }, when);
          }
          throw new HttpError(422, `Nicht unterstützt: ${op.op} ${op.table}`);
        });
        results.push({ id: op.id, ...(r as object) });
      } catch (err) {
        // Validation / permission errors: log and skip so the queue drains. The device re-syncs to server state.
        req.log.warn({ err, op }, 'upload op rejected');
        results.push({ id: op.id, ok: false, kind: 'rejected', reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return { results };
  });

  return app;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
