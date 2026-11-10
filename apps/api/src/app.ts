import { createReadStream } from 'node:fs';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { asUser, ADMIN_URL, connect, type Sql } from '@bap/db';
import { allowedTransitions, escalation, type MangelStatus, type Priority, type ProjectRole } from '@bap/domain';
import { issueToken, jwks, verifyToken } from './auth';
import { addFoto, fotoFile } from './foto-service';
import { createFolder, decideDocument, documentFile, dokumenteTree, smartUpload, uploadDocument } from './dokumente-service';
import { attachToZettel, decideZettel, listZettel, saveZettel, submitZettel, zettelAttachment, zettelDetails } from './stunden-service';
import { addFahrt, addFahrzeug, addTanken, addVertrag, attachBeleg, belegFile, createEinkauf, decideEinkauf, fahrtenbuch, kosten, listEinkaeufe, listNu, saveNu, setBudget } from './betrieb-service';
import { decideEinreichung, einreichungFile, listEinreichungen, submitEinreichung } from './einreichung-service';
import { anzeigeDetails, anzeigePdf, maengelBericht, PLAN_DIR, createAnzeige, patchAnzeige, sendAnzeige } from './anzeige-service';
import { addPunkt, besprechungDetails, createBesprechung, listBesprechungen, nextTerminIcs, patchBesprechung, patchPunkt, protokollPdf, sendBesprechung, setAnwesenheit, setTeilnehmer } from './besprechung-service';
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

const contentDisposition = (name: string) => `inline; filename*=UTF-8''${encodeURIComponent(name)}`;

export function buildApp(sql: Sql) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.register(cors, { origin: true, allowedHeaders: ['authorization', 'content-type', 'x-device-id'] });
  app.register(multipart, { limits: { fileSize: 300 * 1024 * 1024, files: 1 } }); // A0 plans can be large

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.status(422).send({ error: 'Ungültige Eingabe', details: err.issues });
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

  // --- authenticated --------------------------------------------------------
  app.addHook('onRequest', async (req) => {
    if (req.url === '/health' || req.url.startsWith('/auth/')) return;
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
      const [user] = await tx`SELECT u.id, u.name, u.email, c.name AS company FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = ${req.userId}`;
      const projects = await tx`
        SELECT p.id, p.name, pm.role FROM project p JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = ${req.userId}
        ORDER BY p.name`;
      return { user, projects };
    }),
  );

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
        locations: await tx`SELECT id, parent_id, kind, name FROM location WHERE project_id = ${p} ORDER BY sort, name`,
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
          if (op.table === 'punkt_action' && op.op === 'PUT') {
            const a = z.object({ punkt_id: z.string().uuid(), payload: z.string(), base_version: z.coerce.number().int() }).parse(data);
            return patchPunkt(tx, req.userId, a.punkt_id, a.base_version, JSON.parse(a.payload), m);
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
