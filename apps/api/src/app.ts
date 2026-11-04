import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import Fastify, { type FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { asUser, ADMIN_URL, connect, type Sql } from '@bap/db';
import { allowedTransitions, escalation, type MangelStatus, type Priority, type ProjectRole } from '@bap/domain';
import { issueToken, jwks, verifyToken } from './auth';
import { actorFor, createMangel, HttpError, patchMangel, setNachfrist, transitionMangel, type WriteMeta } from './mangel-service';

const PLAN_DIR = fileURLToPath(new URL('../../../storage/plans/', import.meta.url));

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const meta = (req: FastifyRequest, occurredAt?: string | null): WriteMeta => ({
  occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
  deviceId: (req.headers['x-device-id'] as string | undefined) ?? 'web',
});

export function buildApp(sql: Sql) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.register(cors, { origin: true, allowedHeaders: ['authorization', 'content-type', 'x-device-id'] });

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
        companyId: actor.companyId,
        locations: await tx`SELECT id, parent_id, kind, name FROM location WHERE project_id = ${p} ORDER BY sort, name`,
        gewerke: await tx`SELECT id, name FROM gewerk WHERE project_id = ${p} ORDER BY name`,
        gewerkCompanies: await tx`SELECT gc.gewerk_id, gc.company_id FROM gewerk_company gc JOIN gewerk g ON g.id = gc.gewerk_id WHERE g.project_id = ${p}`,
        companies: await tx`SELECT DISTINCT c.id, c.name, c.kind FROM company c JOIN project_member pm ON pm.company_id = c.id WHERE pm.project_id = ${p} ORDER BY c.name`,
        plans: await tx`SELECT id, location_id, name, plan_index, page_count FROM plan WHERE project_id = ${p} ORDER BY name`,
      };
    }),
  );

  app.get<{ Params: { projectId: string } }>('/projects/:projectId/maengel', async (req) =>
    asUser(sql, req.userId, async (tx) => {
      const actor = await actorFor(tx, req.userId, req.params.projectId);
      const rows = await tx`
        SELECT m.*, l.name AS location_name, g.name AS gewerk_name, c.name AS assigned_company_name, u.name AS created_by_name
        FROM mangel m
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
