/**
 * Sign-in and invitations (docs/fachkonzept/01, docs/tech-stack.md).
 *
 * Better Auth keeps passwords (hashed) and sessions in our Postgres. The long-lived Better Auth session token
 * is the device's refresh token; our short-lived JWT (auth.ts, 12 h) authenticates against the API and the
 * PowerSync service as before, so nothing else in the app changes.
 *
 * Sign-up is closed: accounts are created only by accepting an invitation of the project's Leitung.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';
import { z } from 'zod';
import { ADMIN_URL, type Sql, type TxSql } from '@bap/db';
import { roleLabel } from '@bap/domain';
import { issueToken } from './auth';
import { sendMail } from './mailer';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

export const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:3000';
const SECRET_FILE = fileURLToPath(new URL('../../../storage/keys/auth-secret.txt', import.meta.url));
const MAIL_FROM = process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>';
export const MIN_PASSWORD = 10;

async function secret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('BETTER_AUTH_SECRET fehlt');
  try {
    return (await readFile(SECRET_FILE, 'utf8')).trim();
  } catch {
    const s = randomBytes(32).toString('hex');
    await mkdir(fileURLToPath(new URL('.', `file://${SECRET_FILE}`)), { recursive: true });
    await writeFile(SECRET_FILE, s);
    return s;
  }
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

export async function createAuth() {
  return betterAuth({
    secret: await secret(),
    baseURL: API_URL,
    trustedOrigins: [WEB_URL],
    database: new pg.Pool({ connectionString: ADMIN_URL, max: 3 }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // only via invitation
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        await sendMail({
          from: MAIL_FROM,
          to: user.email,
          subject: 'Bau Akte Pro – Passwort zurücksetzen',
          text:
            `Hallo ${user.name},\n\nüber diesen Link setzen Sie ein neues Passwort (gültig 1 Stunde):\n${WEB_URL}/passwort-neu?token=${encodeURIComponent(token)}\n\n` +
            'Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail einfach.\n',
          attachments: [],
        });
      },
    },
    // Device stays signed in for 30 days without use (refresh extends it).
    session: {
      modelName: 'auth_session',
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      fields: { userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    user: {
      modelName: 'app_user',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      // Our own columns: set by the invitation flow, never by Better Auth (sign-up is closed).
      additionalFields: {
        tenant_id: { type: 'string', required: true, input: false },
        company_id: { type: 'string', required: true, input: false },
        active: { type: 'boolean', required: false, input: false, defaultValue: true },
      },
    },
    account: {
      modelName: 'auth_account',
      fields: {
        userId: 'user_id', accountId: 'account_id', providerId: 'provider_id', accessToken: 'access_token', refreshToken: 'refresh_token',
        idToken: 'id_token', accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at', updatedAt: 'updated_at',
      },
    },
    verification: { modelName: 'auth_verification', fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
    advanced: { database: { generateId: () => randomUUID() } },
  });
}

// --- simple brute-force protection (per IP + e-mail) ----------------------------------------------
const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 8) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.');
  if (!a || a.until <= now) attempts.set(key, { n: 1, until: now + 15 * 60 * 1000 });
  else a.n++;
}
const forget = (key: string) => attempts.delete(key);

const Login = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });

/** E-mail + password → access token (JWT, 12 h) + refresh token (session, 30 days). */
export async function login(auth: Auth, admin: Sql, input: unknown, ip: string, userAgent?: string) {
  const d = Login.parse(input);
  const key = `${ip}|${d.email}`;
  throttle(key);
  const [u] = await admin`SELECT id, active FROM app_user WHERE lower(email) = ${d.email}`;
  const res: { token: string } | null = await auth.api
    .signInEmail({ body: { email: d.email, password: d.password }, headers: new Headers({ 'user-agent': userAgent ?? '', 'x-forwarded-for': ip }) })
    .then((r) => ({ token: (r as { token: string }).token }), () => null);
  if (!res || !u) throw new HttpError(401, 'E-Mail oder Passwort falsch');
  if (!u.active) {
    await admin`DELETE FROM auth_session WHERE token = ${res.token}`;
    throw new HttpError(403, 'Dieser Zugang ist gesperrt. Bitte an die Bauleitung wenden.');
  }
  forget(key);
  return { token: await issueToken(u.id as string), refresh: res.token, userId: u.id as string };
}

/** Refresh token → new access token (as long as the session is valid and the account active). */
export async function refresh(admin: Sql, input: unknown) {
  const { refresh: token } = z.object({ refresh: z.string().min(10).max(200) }).parse(input);
  const [s] = await admin`
    SELECT s.user_id, u.active FROM auth_session s JOIN app_user u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()`;
  if (!s) throw new HttpError(401, 'Sitzung abgelaufen – bitte neu anmelden');
  if (!s.active) throw new HttpError(403, 'Dieser Zugang ist gesperrt');
  // Sliding expiry like Better Auth's updateAge: extend once a day.
  await admin`UPDATE auth_session SET expires_at = now() + interval '30 days', updated_at = now() WHERE token = ${token} AND updated_at < now() - interval '1 day'`;
  return { token: await issueToken(s.user_id as string), userId: s.user_id as string };
}

export async function logout(admin: Sql, input: unknown) {
  const { refresh: token } = z.object({ refresh: z.string().max(200).optional() }).parse(input ?? {});
  if (token) await admin`DELETE FROM auth_session WHERE token = ${token}`;
  return { ok: true };
}

/** Always answers ok (no hint whether the address exists). */
export async function forgotPassword(auth: Auth, input: unknown, ip: string) {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(input);
  throttle(`forgot|${ip}`);
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: `${WEB_URL}/passwort-neu` } });
  } catch {
    // unknown address or mail problem: same answer
  }
  return { ok: true };
}

export async function resetPassword(auth: Auth, input: unknown) {
  const d = z.object({ token: z.string().min(10).max(200), password: z.string().min(MIN_PASSWORD, `Mindestens ${MIN_PASSWORD} Zeichen`).max(128) }).parse(input);
  try {
    await auth.api.resetPassword({ body: { token: d.token, newPassword: d.password } });
  } catch {
    throw new HttpError(400, 'Der Link ist abgelaufen oder wurde schon benutzt. Bitte neu anfordern.');
  }
  return { ok: true };
}

/** Sets/replaces a password directly (seed and invitation acceptance). */
export async function setPassword(admin: Sql | TxSql, userId: string, password: string) {
  const hash = await hashPassword(password);
  const [a] = await admin`SELECT id FROM auth_account WHERE user_id = ${userId} AND provider_id = 'credential'`;
  if (a) await admin`UPDATE auth_account SET password = ${hash}, updated_at = now() WHERE id = ${a.id}`;
  else await admin`INSERT INTO auth_account (id, user_id, account_id, provider_id, password) VALUES (${randomUUID()}, ${userId}, ${userId}, 'credential', ${hash})`;
}

// --- Einladungen ----------------------------------------------------------------------------------

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const ROLES = ['bauleitung', 'projektleitung', 'polier', 'nu', 'bauherr', 'einkauf'] as const;
const OWN_ROLES = ['bauleitung', 'projektleitung', 'polier', 'einkauf'];

const InviteInput = z.object({
  project_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).nullish(),
  role: z.enum(ROLES),
  /** NU firm or Bauherr company of the project; own company for own staff (filled in by the server). */
  company_id: z.string().uuid().nullish(),
});

/**
 * Leitung invites a person into the project. Existing accounts of the own company/tenant are added directly
 * (mail: "Sie wurden hinzugefügt"); new people get a link to set name and password.
 */
export async function invite(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = InviteInput.parse(input);
  const a = await actorFor(tx, userId, d.project_id);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Einladen dürfen Bau- und Projektleitung');
  const [p] = await tx`SELECT p.name, p.tenant_id, (SELECT c.id FROM company c WHERE c.tenant_id = p.tenant_id AND c.kind = 'own' LIMIT 1) AS own FROM project p WHERE p.id = ${d.project_id}`;
  let companyId: string;
  if (OWN_ROLES.includes(d.role)) companyId = p!.own as string;
  else {
    if (!d.company_id) throw new HttpError(422, d.role === 'nu' ? 'Bitte den Nachunternehmer wählen' : 'Bitte die Firma des Bauherrn wählen');
    const [c] = await tx`
      SELECT c.id, c.kind FROM company c WHERE c.id = ${d.company_id}
        AND EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = ${d.project_id})`;
    if (!c) throw new HttpError(422, 'Diese Firma gehört nicht zum Projekt – zuerst unter „Nachunternehmer“ hinzufügen');
    if ((d.role === 'nu') !== (c.kind === 'nu')) throw new HttpError(422, d.role === 'nu' ? 'Das ist keine Nachunternehmer-Firma' : 'Für den Bauherrn bitte eine Bauherren-Firma wählen');
    companyId = c.id as string;
  }
  const [inviter] = await tx`SELECT name FROM app_user WHERE id = ${userId}`;

  // Existing account? RLS hides users outside one's projects, so a narrow DB function answers this one question.
  const [existing] = await tx`SELECT id, company_id, tenant_id FROM app.find_user_by_email(${d.email})`;
  if (existing) {
    if (existing.tenant_id !== p!.tenant_id) throw new HttpError(409, 'Diese E-Mail-Adresse gehört zu einem anderen Unternehmen');
    if (existing.company_id !== companyId) throw new HttpError(409, 'Diese Person ist bereits bei einer anderen Firma registriert');
    const r = await tx`
      INSERT INTO project_member (project_id, user_id, company_id, role) VALUES (${d.project_id}, ${existing.id}, ${companyId}, ${d.role})
      ON CONFLICT (project_id, user_id) DO NOTHING RETURNING id`;
    if (!r.length) throw new HttpError(409, 'Diese Person ist schon im Projekt');
    await audit(tx, userId, d.project_id, 'project_member', r[0]!.id as string, 'mitglied_hinzugefuegt', meta, { email: d.email, role: d.role });
    await sendMail({
      from: MAIL_FROM, to: d.email, subject: `Bau Akte Pro – Zugang zu ${p!.name as string}`,
      text: `Guten Tag,\n\n${inviter?.name ?? 'Die Bauleitung'} hat Sie dem Projekt „${p!.name as string}“ als ${roleLabel(d.role)} hinzugefügt.\nAnmelden: ${WEB_URL}\n`,
      attachments: [],
    });
    return { status: 'hinzugefuegt' as const };
  }

  const token = randomBytes(24).toString('base64url');
  const [inv] = await tx`
    INSERT INTO einladung (tenant_id, project_id, email, name, role, company_id, token_hash, invited_by)
    VALUES (${p!.tenant_id}, ${d.project_id}, ${d.email}, ${d.name ?? null}, ${d.role}, ${companyId}, ${sha(token)}, ${userId}) RETURNING id, expires_at`;
  await audit(tx, userId, d.project_id, 'einladung', inv!.id as string, 'eingeladen', meta, { email: d.email, role: d.role, company: companyId });
  const link = `${WEB_URL}/einladung/${token}`;
  const mail = await sendMail({
    from: MAIL_FROM, to: d.email, subject: `Einladung zu ${p!.name as string} (Bau Akte Pro)`,
    text:
      `Guten Tag${d.name ? ` ${d.name}` : ''},\n\n${inviter?.name ?? 'Die Bauleitung'} lädt Sie zum Projekt „${p!.name as string}“ ein (Rolle: ${roleLabel(d.role)}).\n\n` +
      `Zugang einrichten (gültig 14 Tage):\n${link}\n\nDanach können Sie sich im Browser und in der App „Bau Akte Pro“ anmelden.\n`,
    attachments: [],
  });
  return { status: 'eingeladen' as const, id: inv!.id as string, devLink: process.env.NODE_ENV === 'production' ? undefined : link, devFile: mail.devFile };
}

async function audit(tx: TxSql, userId: string, projectId: string, entity: string, id: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, ${entity}, ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

/** Public: what the invitation link shows before accepting. */
export async function invitationInfo(admin: Sql, token: string) {
  const [i] = await admin`
    SELECT e.email, e.name, e.role, e.expires_at, e.accepted_at, e.revoked_at, p.name AS project, c.name AS company, u.name AS invited_by
    FROM einladung e JOIN project p ON p.id = e.project_id JOIN company c ON c.id = e.company_id JOIN app_user u ON u.id = e.invited_by
    WHERE e.token_hash = ${sha(token)}`;
  if (!i) throw new HttpError(404, 'Diese Einladung gibt es nicht');
  if (i.revoked_at) throw new HttpError(410, 'Diese Einladung wurde zurückgezogen');
  if (i.accepted_at) throw new HttpError(410, 'Diese Einladung wurde bereits angenommen – bitte anmelden');
  if (new Date(i.expires_at as string) < new Date()) throw new HttpError(410, 'Diese Einladung ist abgelaufen – bitte neu einladen lassen');
  return { email: i.email, name: i.name, role: i.role, roleLabel: roleLabel(i.role as string), project: i.project, company: i.company, invitedBy: i.invited_by };
}

/** Public: accept → account with name + password, project membership, signed in right away. */
export async function acceptInvitation(admin: Sql, token: string, input: unknown, ip: string) {
  const d = z.object({ name: z.string().trim().min(2, 'Bitte den Namen eintragen').max(120), password: z.string().min(MIN_PASSWORD, `Mindestens ${MIN_PASSWORD} Zeichen`).max(128) }).parse(input);
  throttle(`accept|${ip}`);
  const userId = await admin.begin(async (tx) => {
    const [i] = await tx`SELECT * FROM einladung WHERE token_hash = ${sha(token)} FOR UPDATE`;
    if (!i || i.revoked_at || i.accepted_at || new Date(i.expires_at as string) < new Date()) throw new HttpError(410, 'Diese Einladung ist nicht mehr gültig');
    const [dup] = await tx`SELECT id FROM app_user WHERE lower(email) = ${i.email}`;
    if (dup) throw new HttpError(409, 'Für diese E-Mail-Adresse gibt es schon einen Zugang – bitte anmelden');
    const id = randomUUID();
    await tx`INSERT INTO app_user (id, tenant_id, company_id, email, name, email_verified) VALUES (${id}, ${i.tenant_id}, ${i.company_id}, ${i.email}, ${d.name}, true)`;
    await setPassword(tx, id, d.password);
    const [m] = await tx`INSERT INTO project_member (project_id, user_id, company_id, role) VALUES (${i.project_id}, ${id}, ${i.company_id}, ${i.role}) RETURNING id`;
    await tx`UPDATE einladung SET accepted_at = now(), accepted_user_id = ${id} WHERE id = ${i.id}`;
    await tx`
      INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
      VALUES (${i.tenant_id}, ${i.project_id}, 'project_member', ${m!.id}, 'einladung_angenommen', ${id}, 'web', now(), ${tx.json({ einladung: i.id, role: i.role } as never)})`;
    return id;
  });
  return userId;
}

/** Invitations and members of a project, for the "Zugänge" page (Leitung). */
export async function zugaenge(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Zugänge verwalten Bau- und Projektleitung');
  const mitglieder = await tx`
    SELECT pm.id, pm.role, u.id AS user_id, u.name, u.email, c.name AS company, c.kind AS company_kind, pm.user_id = ${userId} AS ich
    FROM project_member pm JOIN app_user u ON u.id = pm.user_id JOIN company c ON c.id = pm.company_id
    WHERE pm.project_id = ${projectId} ORDER BY c.kind = 'own' DESC, c.name, u.name`;
  const einladungen = await tx`
    SELECT e.id, e.email, e.name, e.role, e.created_at, e.expires_at, c.name AS company, u.name AS invited_by
    FROM einladung e JOIN company c ON c.id = e.company_id JOIN app_user u ON u.id = e.invited_by
    WHERE e.project_id = ${projectId} AND e.accepted_at IS NULL AND e.revoked_at IS NULL ORDER BY e.created_at DESC`;
  const firmen = await tx`
    SELECT c.id, c.name, c.kind FROM company c
    WHERE c.kind IN ('nu', 'bauherr') AND EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = ${projectId})
    ORDER BY c.kind, c.name`;
  return { mitglieder, einladungen, firmen };
}

export async function revokeInvitation(tx: TxSql, userId: string, id: string, meta: WriteMeta) {
  const [e] = await tx`SELECT project_id, email FROM einladung WHERE id = ${id}`;
  if (!e) throw new HttpError(404, 'Einladung nicht gefunden');
  const a = await actorFor(tx, userId, e.project_id as string);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Nur Bau- und Projektleitung');
  await tx`UPDATE einladung SET revoked_at = now() WHERE id = ${id} AND accepted_at IS NULL`;
  await audit(tx, userId, e.project_id as string, 'einladung', id, 'zurueckgezogen', meta, { email: e.email });
  return { ok: true };
}

/** Remove a person from the project (rights change, audited). Their device drops the project on the next sync. */
export async function removeMember(tx: TxSql, userId: string, memberId: string, meta: WriteMeta) {
  const [m] = await tx`SELECT pm.project_id, pm.user_id, pm.role, u.email FROM project_member pm JOIN app_user u ON u.id = pm.user_id WHERE pm.id = ${memberId}`;
  if (!m) throw new HttpError(404, 'Mitglied nicht gefunden');
  const a = await actorFor(tx, userId, m.project_id as string);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Zugänge entziehen Bau- und Projektleitung');
  if (m.user_id === userId) throw new HttpError(422, 'Den eigenen Zugang kann man nicht entziehen');
  if (m.role === 'bauleitung' || m.role === 'projektleitung') {
    const [{ n }] = (await tx`SELECT count(*)::int AS n FROM project_member WHERE project_id = ${m.project_id} AND role IN ('bauleitung', 'projektleitung')`) as unknown as [{ n: number }];
    if (n <= 1) throw new HttpError(422, 'Ein Projekt braucht mindestens eine Bau- oder Projektleitung');
  }
  await tx`DELETE FROM project_member WHERE id = ${memberId}`;
  await audit(tx, userId, m.project_id as string, 'project_member', memberId, 'zugang_entzogen', meta, { email: m.email, role: m.role });
  return { ok: true };
}
