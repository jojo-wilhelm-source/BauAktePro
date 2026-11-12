/**
 * Einkauf: Leistungsverzeichnis → Anfrage → Angebot → Preisspiegel → Vergabe (docs/fachkonzept/12, decided 12.11.2026).
 * Bau-/Projektleitung and Einkauf work with LVs; bidders answer via link (no account, like the QR-Freimeldung)
 * or in the NU portal, with unit prices or – in an emergency – as PDF with a total. Bidders never see other offers.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Sql, TxSql } from '@bap/db';
import { formatDate, LvPositionInput, ozNummerieren, PaketPosition, preisspiegel, titelSummen } from '@bap/domain';
import { WEB_URL } from './anmeldung';
import { sendMail } from './mailer';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const DIR = fileURLToPath(new URL('../../../storage/angebote/', import.meta.url));
const FROM = () => process.env.MAIL_FROM ?? 'Bau Akte Pro <noreply@bauaktepro.example.test>';
export const angebotUrl = (token: string) => `${WEB_URL}/angebot/${token}`;

async function requireEinkauf(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung' && a.role !== 'einkauf') throw new HttpError(403, 'Leistungsverzeichnisse bearbeiten Einkauf sowie Bau- und Projektleitung');
  return a;
}
async function audit(tx: TxSql, userId: string | null, projectId: string, id: string, action: string, meta: WriteMeta, data: object, label?: string) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, actor_label, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'lv', ${id}, ${action}, ${userId}, ${label ?? null}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

export async function listLv(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role === 'nu') {
    // NU portal: the requests sent to the own firm, with the link to answer.
    const rows = await tx`
      SELECT l.id, l.nummer, l.titel, l.angebotsfrist::text AS angebotsfrist, l.status, a.token, (SELECT max(o.abgegeben_at) FROM angebot o WHERE o.anfrage_id = a.id) AS abgegeben_at
      FROM lv_anfrage a JOIN lv l ON l.id = a.lv_id WHERE l.project_id = ${projectId} AND a.aktiv ORDER BY l.created_at DESC`;
    return rows.map((r) => ({ ...r, link: angebotUrl(r.token as string), token: undefined }));
  }
  await requireEinkauf(tx, userId, projectId);
  return tx`
    SELECT l.id, l.nummer, l.titel, l.angebotsfrist::text AS angebotsfrist, l.status, l.created_at, l.ordner_id, g.name AS gewerk, c.name AS vergeben_an_name,
      (SELECT count(*)::int FROM lv_position p WHERE p.lv_id = l.id AND p.art = 'position') AS positionen,
      (SELECT count(*)::int FROM lv_anfrage a WHERE a.lv_id = l.id AND a.sent_at IS NOT NULL) AS angefragt,
      (SELECT count(DISTINCT o.company_id)::int FROM angebot o WHERE o.lv_id = l.id) AS angebote
    FROM lv l LEFT JOIN gewerk g ON g.id = l.gewerk_id LEFT JOIN company c ON c.id = l.vergeben_an
    WHERE l.project_id = ${projectId} ORDER BY l.created_at DESC`;
}

const LvInput = z.object({
  id: z.string().uuid(), project_id: z.string().uuid(), titel: z.string().trim().min(2).max(200), beschreibung: z.string().max(5000).nullish(),
  gewerk_id: z.string().uuid().nullish(), angebotsfrist: z.string().date().nullish(), ordner_id: z.string().uuid().nullish(),
  positionen: z.array(LvPositionInput).max(5000).optional(),
  /** Renumber the OZ automatically (Titel 01, Untertitel 01.01, Position 01.01.0010). */
  auto_oz: z.boolean().optional(),
});

/** Create or update a draft LV incl. its positions (replaced as a whole while it is a draft). */
export async function saveLv(tx: TxSql, userId: string, input: unknown, meta: WriteMeta) {
  const d = LvInput.parse(input);
  await requireEinkauf(tx, userId, d.project_id);
  const [cur] = await tx`SELECT id, status FROM lv WHERE id = ${d.id}`;
  const fields: Record<string, unknown> = { titel: d.titel, beschreibung: d.beschreibung ?? null, gewerk_id: d.gewerk_id ?? null, angebotsfrist: d.angebotsfrist ?? null };
  if (d.ordner_id !== undefined) fields.ordner_id = d.ordner_id ?? null;
  if (!cur) {
    const [n] = await tx`SELECT coalesce(max(nummer), 0) + 1 AS n FROM lv WHERE project_id = ${d.project_id}`;
    await tx`INSERT INTO lv (id, tenant_id, project_id, nummer, titel, beschreibung, gewerk_id, angebotsfrist, ordner_id, created_by)
             VALUES (${d.id}, app.user_tenant(), ${d.project_id}, ${n!.n}, ${fields.titel as string}, ${fields.beschreibung as string | null}, ${fields.gewerk_id as string | null},
                     ${fields.angebotsfrist as string | null}, ${d.ordner_id ?? null}, ${userId})`;
    await audit(tx, userId, d.project_id, d.id, 'angelegt', meta, { titel: d.titel });
  } else {
    await tx`UPDATE lv SET ${tx(fields as never)}, version = version + 1 WHERE id = ${d.id}`;
  }
  if (d.positionen) {
    if (cur && cur.status !== 'entwurf') throw new HttpError(409, 'Nach dem Versand bleiben die Positionen unverändert (alle Bieter rechnen dasselbe LV)');
    await tx`DELETE FROM lv_position WHERE lv_id = ${d.id}`;
    const zeilen = d.auto_oz || d.positionen.every((p) => !p.oz) ? ozNummerieren(d.positionen) : d.positionen;
    if (zeilen.length) {
      await tx`INSERT INTO lv_position ${tx(zeilen.map((p, i) => ({ id: p.id, lv_id: d.id, project_id: d.project_id, art: p.art, oz: p.oz, kurztext: p.kurztext, langtext: p.langtext ?? null,
        menge: p.art === 'position' ? p.menge : 0, einheit: p.art === 'position' ? p.einheit ?? null : null, sort: i })) as never)}`;
    }
  }
  return getLv(tx, userId, d.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLv(tx: TxSql, userId: string, id: string): Promise<Record<string, any> & { positionen: Record<string, any>[]; anfragen: Record<string, any>[] }> {
  const [l] = await tx`SELECT l.*, l.angebotsfrist::text AS angebotsfrist, g.name AS gewerk FROM lv l LEFT JOIN gewerk g ON g.id = l.gewerk_id WHERE l.id = ${id}`; // RLS
  if (!l) throw new HttpError(404, 'Leistungsverzeichnis nicht gefunden');
  await requireEinkauf(tx, userId, l.project_id as string);
  const positionen = await tx`SELECT id, art, oz, kurztext, langtext, menge::float AS menge, einheit FROM lv_position WHERE lv_id = ${id} ORDER BY sort, oz`;
  const anfragen = await tx`
    SELECT a.id, a.company_id, c.name AS company, coalesce(a.email, c.email) AS email, a.sent_at, a.aktiv,
      (SELECT max(o.abgegeben_at) FROM angebot o WHERE o.anfrage_id = a.id) AS abgegeben_at
    FROM lv_anfrage a JOIN company c ON c.id = a.company_id WHERE a.lv_id = ${id} ORDER BY c.name`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...(l as Record<string, any>), positionen, anfragen };
}

/** Send the LV to bidders: one link per firm (mail with link + QR). Firms can be added later. */
export async function sendAnfragen(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const { company_ids } = z.object({ company_ids: z.array(z.string().uuid()).min(1) }).parse(input);
  const l = await getLv(tx, userId, id);
  if (l.status === 'vergeben') throw new HttpError(409, 'Bereits vergeben');
  if (!l.positionen.some((p) => p.art === 'position')) throw new HttpError(422, 'Das LV hat noch keine Positionen');
  const [me] = await tx`SELECT name FROM app_user WHERE id = ${userId}`;
  const sent: { company: string; to: string | null; devFile?: string }[] = [];
  for (const cid of company_ids) {
    const [c] = await tx`SELECT id, name, email, kind FROM company WHERE id = ${cid}`;
    if (!c || c.kind !== 'nu') throw new HttpError(422, 'Anfragen gehen an Nachunternehmer');
    let [a] = await tx`SELECT * FROM lv_anfrage WHERE lv_id = ${id} AND company_id = ${cid}`;
    if (!a) {
      [a] = await tx`INSERT INTO lv_anfrage (id, lv_id, project_id, company_id, email, token) VALUES (${randomUUID()}, ${id}, ${l.project_id}, ${cid}, ${c.email}, ${randomBytes(24).toString('base64url')}) RETURNING *`;
    }
    await tx`UPDATE lv_anfrage SET sent_at = now(), sent_by = ${userId}, aktiv = true WHERE id = ${a!.id}`;
    const url = angebotUrl(a!.token as string);
    let devFile: string | undefined;
    if (c.email) {
      const qr = await QRCode.toBuffer(url, { margin: 1, width: 320 });
      const r = await sendMail({
        from: FROM(), to: c.email as string,
        subject: `Anfrage: ${l.titel as string}${l.angebotsfrist ? ` – Angebot bis ${formatDate(l.angebotsfrist as string)}` : ''}`,
        text: `Sehr geehrte Damen und Herren,\n\nwir bitten um Ihr Angebot für „${l.titel as string}“ (${l.positionen.length} Positionen).\n` +
          `${l.angebotsfrist ? `Angebotsfrist: ${formatDate(l.angebotsfrist as string)}\n` : ''}\n` +
          `Sie können die Einheitspreise direkt online eintragen oder Ihr Angebot als PDF hochladen – ohne Anmeldung:\n${url}\n` +
          `(oder den QR-Code im Anhang scannen). Mit Zugang zum Portal finden Sie die Anfrage auch dort.\n\nMit freundlichen Grüßen\n${me?.name ?? ''}`,
        attachments: [{ filename: 'Anfrage-QR.png', content: qr }],
      });
      devFile = r.devFile;
    }
    sent.push({ company: c.name as string, to: (c.email as string) ?? null, devFile });
  }
  await tx`UPDATE lv SET status = 'angefragt', version = version + 1 WHERE id = ${id} AND status = 'entwurf'`;
  await audit(tx, userId, l.project_id as string, id, 'angefragt', meta, { firmen: sent.map((s) => s.company) });
  return { sent };
}

/** Preisspiegel for Bau-/Projektleitung and Einkauf: latest offer per firm. */
export async function lvPreisspiegel(tx: TxSql, userId: string, id: string) {
  const l = await getLv(tx, userId, id);
  const angebote = await tx`
    SELECT DISTINCT ON (o.company_id) o.id, o.company_id, c.name AS company, o.nachlass_prozent::float AS nachlass, o.summe_netto::float AS summe, o.bemerkung,
      o.pdf_key IS NOT NULL AS has_pdf, o.abgegeben_von, o.abgegeben_at
    FROM angebot o JOIN company c ON c.id = o.company_id WHERE o.lv_id = ${id} ORDER BY o.company_id, o.abgegeben_at DESC`;
  const preise = angebote.length ? await tx`SELECT angebot_id, position_id, einheitspreis::float AS ep FROM angebot_preis WHERE angebot_id IN ${tx(angebote.map((a) => a.id as string))}` : [];
  const input = angebote.map((a) => ({
    id: a.id as string, company: a.company as string, nachlass_prozent: (a.nachlass as number) ?? 0, summe_pdf: (a.summe as number) ?? null,
    preise: Object.fromEntries(preise.filter((p) => p.angebot_id === a.id).map((p) => [p.position_id as string, p.ep as number])),
  }));
  const posOnly = (l.positionen as { id: string; art: string; menge: number }[]).filter((p) => p.art === 'position');
  const spiegel = preisspiegel(posOnly, input);
  const gp = new Map(spiegel.zeilen.map((z) => [z.position_id, z.gp]));
  const summen = titelSummen(l.positionen as { id: string; art: 'titel' | 'untertitel' | 'position' | 'text' }[], gp, input.length);
  return { lv: l, angebote, preise: input, spiegel: { ...spiegel, titelsummen: Object.fromEntries(summen) } };
}

export async function vergeben(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const { company_id } = z.object({ company_id: z.string().uuid() }).parse(input);
  const [l] = await tx`SELECT project_id, titel FROM lv WHERE id = ${id}`;
  if (!l) throw new HttpError(404, 'Leistungsverzeichnis nicht gefunden');
  const a = await actorFor(tx, userId, l.project_id as string);
  // ANNAHME: the award is decided by Bau-/Projektleitung (Einkauf prepares).
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Vergeben darf die Bau- oder Projektleitung');
  const [has] = await tx`SELECT 1 FROM angebot WHERE lv_id = ${id} AND company_id = ${company_id}`;
  if (!has) throw new HttpError(422, 'Von dieser Firma liegt kein Angebot vor');
  await tx`UPDATE lv SET status = 'vergeben', vergeben_an = ${company_id}, vergeben_at = now(), version = version + 1 WHERE id = ${id}`;
  await audit(tx, userId, l.project_id as string, id, 'vergeben', meta, { company_id });
  return { ok: true };
}

export async function angebotPdf(tx: TxSql, angebotId: string) {
  const [o] = await tx`SELECT pdf_key FROM angebot WHERE id = ${angebotId}`; // RLS
  if (!o?.pdf_key) throw new HttpError(404, 'Kein PDF');
  return readFile(DIR + (o.pdf_key as string).replace(/[^a-z0-9._-]/gi, ''));
}

// --- Public link (no account) -------------------------------------------------------------------

async function byToken(admin: Sql, token: string) {
  const [a] = await admin`SELECT * FROM app.anfrage_by_token(${token})`;
  if (!a) throw new HttpError(404, 'Dieser Link ist nicht (mehr) gültig');
  return a as { anfrage_id: string; lv_id: string; project_id: string; company_id: string; tenant_id: string };
}

export async function publicAnfrage(admin: Sql, token: string) {
  const a = await byToken(admin, token);
  const [l] = await admin`
    SELECT l.titel, l.beschreibung, l.angebotsfrist::text AS angebotsfrist, l.status, p.name AS project, c.name AS company,
      (SELECT o.name FROM company o WHERE o.tenant_id = l.tenant_id AND o.kind = 'own' LIMIT 1) AS own_company
    FROM lv l JOIN project p ON p.id = l.project_id JOIN company c ON c.id = ${a.company_id} WHERE l.id = ${a.lv_id}`;
  const positionen = await admin`SELECT id, art, oz, kurztext, langtext, menge::float AS menge, einheit FROM lv_position WHERE lv_id = ${a.lv_id} ORDER BY sort, oz`;
  // Only the own last offer (prices of others are never shown).
  const [last] = await admin`SELECT id, abgegeben_at, abgegeben_von, nachlass_prozent::float AS nachlass FROM angebot WHERE anfrage_id = ${a.anfrage_id} ORDER BY abgegeben_at DESC LIMIT 1`;
  const preise = last ? await admin`SELECT position_id, einheitspreis::float AS ep FROM angebot_preis WHERE angebot_id = ${last.id}` : [];
  return { ...l, positionen, letztes: last ?? null, preise: Object.fromEntries(preise.map((p) => [p.position_id, p.ep])), offen: l!.status === 'angefragt' };
}

const AngebotInput = z.object({
  name: z.string().trim().min(2, 'Bitte Ihren Namen angeben').max(120),
  preise: z.record(z.string().uuid(), z.coerce.number().min(0).max(1e9)).default({}),
  nachlass_prozent: z.coerce.number().min(0).max(50).default(0),
  summe_netto: z.coerce.number().min(0).max(1e10).nullish(),
  bemerkung: z.string().max(4000).nullish(),
});

/**
 * Offer via link or portal: unit prices for (all) positions, or a PDF with a total. A new submission replaces the
 * previous one in the Preisspiegel (all versions stay stored). The LV owner gets a mail.
 */
export async function submitAngebot(admin: Sql, token: string, input: unknown, file: { bytes: Buffer; name: string } | null, userId: string | null) {
  const a = await byToken(admin, token);
  const d = AngebotInput.parse(input);
  const [l] = await admin`SELECT status, titel, created_by, project_id FROM lv WHERE id = ${a.lv_id}`;
  if (l?.status !== 'angefragt') throw new HttpError(409, 'Für diese Anfrage werden keine Angebote mehr angenommen');
  const pos = await admin`SELECT id FROM lv_position WHERE lv_id = ${a.lv_id} AND art = 'position'`;
  const ids = new Set(pos.map((p) => p.id as string));
  const preise = Object.entries(d.preise).filter(([k]) => ids.has(k));
  if (!preise.length && !file) throw new HttpError(422, 'Bitte Einheitspreise eintragen oder das Angebot als PDF hochladen');
  if (!preise.length && file && d.summe_netto == null) throw new HttpError(422, 'Bitte bei einem PDF-Angebot die Angebotssumme (netto) angeben');
  let pdfKey: string | null = null;
  const id = randomUUID();
  if (file) {
    if (!file.name.toLowerCase().endsWith('.pdf') || file.bytes.subarray(0, 4).toString() !== '%PDF') throw new HttpError(422, 'Bitte eine PDF-Datei hochladen');
    await mkdir(DIR, { recursive: true });
    pdfKey = `${id}.pdf`;
    await writeFile(DIR + pdfKey, file.bytes);
  }
  await admin.begin(async (tx) => {
    await tx`INSERT INTO angebot (id, anfrage_id, lv_id, project_id, company_id, summe_netto, nachlass_prozent, bemerkung, pdf_key, abgegeben_von, abgegeben_by)
             VALUES (${id}, ${a.anfrage_id}, ${a.lv_id}, ${a.project_id}, ${a.company_id}, ${preise.length ? null : d.summe_netto ?? null}, ${d.nachlass_prozent}, ${d.bemerkung ?? null}, ${pdfKey}, ${d.name}, ${userId})`;
    if (preise.length) await tx`INSERT INTO angebot_preis ${tx(preise.map(([position_id, einheitspreis]) => ({ angebot_id: id, position_id, einheitspreis })) as never)}`;
    await tx`INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, actor_label, occurred_at, data)
             VALUES (${a.tenant_id}, ${a.project_id}, 'lv', ${a.lv_id}, 'angebot', ${userId}, ${d.name}, now(), ${tx.json({ angebot: id, positionen: preise.length, pdf: !!pdfKey } as never)})`;
  });
  const [owner] = await admin`SELECT u.email, c.name AS company FROM app_user u, company c WHERE u.id = ${l.created_by} AND c.id = ${a.company_id}`;
  if (owner?.email) {
    await sendMail({ from: FROM(), to: owner.email as string, subject: `Angebot eingegangen: ${owner.company as string} – ${l.titel as string}`,
      text: `${d.name} (${owner.company as string}) hat ein Angebot für „${l.titel as string}“ abgegeben.\nPreisspiegel: ${WEB_URL}\n`, attachments: [] });
  }
  return { ok: true, id };
}

// --- Folders, copies and the library of standard items (decided 12.11.2026) -----------------------

const OrdnerInput = z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120), parent_id: z.string().uuid().nullish(), sort: z.number().int().optional() });
export async function listOrdner(tx: TxSql, userId: string, projectId: string) {
  await requireEinkauf(tx, userId, projectId);
  return tx`SELECT id, parent_id, name, sort FROM lv_ordner WHERE project_id = ${projectId} ORDER BY sort, name`;
}
export async function saveOrdner(tx: TxSql, userId: string, projectId: string, input: unknown) {
  await requireEinkauf(tx, userId, projectId);
  const d = OrdnerInput.parse(input);
  if (d.parent_id === d.id) throw new HttpError(422, 'Ein Ordner kann nicht in sich selbst liegen');
  const [row] = await tx`INSERT INTO lv_ordner (id, project_id, parent_id, name, sort) VALUES (${d.id}, ${projectId}, ${d.parent_id ?? null}, ${d.name}, ${d.sort ?? 0})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id RETURNING *`;
  return row;
}
export async function removeOrdner(tx: TxSql, id: string) {
  const [busy] = await tx`SELECT 1 FROM lv WHERE ordner_id = ${id} UNION ALL SELECT 1 FROM lv_ordner WHERE parent_id = ${id} LIMIT 1`;
  if (busy) throw new HttpError(409, 'Der Ordner ist nicht leer');
  const [r] = await tx`DELETE FROM lv_ordner WHERE id = ${id} RETURNING id`;
  if (!r) throw new HttpError(404, 'Ordner nicht gefunden');
  return { ok: true };
}

/** Copy an LV (as a template), also into another project: a new draft with the same structure, without prices. */
export async function copyLv(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = z.object({ project_id: z.string().uuid(), ordner_id: z.string().uuid().nullish(), titel: z.string().trim().min(2).max(200).optional() }).parse(input);
  const src = await getLv(tx, userId, id);
  const neu = randomUUID();
  await saveLv(tx, userId, {
    id: neu, project_id: d.project_id, titel: d.titel ?? `${src.titel as string} (Kopie)`, beschreibung: src.beschreibung, ordner_id: d.ordner_id ?? null,
    positionen: (src.positionen as Record<string, any>[]).map((p) => ({ id: randomUUID(), art: p.art, oz: p.oz, kurztext: p.kurztext, langtext: p.langtext, menge: p.menge, einheit: p.einheit })),
  }, meta);
  return { id: neu };
}

const StammInput = z.object({ id: z.string().uuid(), kategorie: z.string().trim().min(1).max(80).default('Allgemein'), kurztext: z.string().trim().min(1).max(500),
  langtext: z.string().max(10000).nullish(), einheit: z.string().trim().min(1).max(20), paket: z.array(PaketPosition).max(50).default([]) });
export async function listStamm(tx: TxSql, q?: string) {
  const [ok] = await tx`SELECT app.is_einkauf_any() AS ok`;
  if (!ok?.ok) throw new HttpError(403, 'Die Bibliothek nutzen Einkauf sowie Bau- und Projektleitung');
  const like = q?.trim() ? `%${q.trim()}%` : null;
  return tx`SELECT id, kategorie, kurztext, langtext, einheit, paket FROM lv_stammleistung
    WHERE aktiv ${like ? tx`AND (kurztext ILIKE ${like} OR langtext ILIKE ${like} OR kategorie ILIKE ${like})` : tx``} ORDER BY kategorie, kurztext LIMIT 500`;
}
export async function saveStamm(tx: TxSql, userId: string, input: unknown) {
  const d = StammInput.parse(input);
  const [row] = await tx`INSERT INTO lv_stammleistung (id, tenant_id, kategorie, kurztext, langtext, einheit, paket, created_by)
    VALUES (${d.id}, app.user_tenant(), ${d.kategorie}, ${d.kurztext}, ${d.langtext ?? null}, ${d.einheit}, ${tx.json(d.paket as never)}, ${userId})
    ON CONFLICT (id) DO UPDATE SET kategorie = EXCLUDED.kategorie, kurztext = EXCLUDED.kurztext, langtext = EXCLUDED.langtext, einheit = EXCLUDED.einheit, paket = EXCLUDED.paket RETURNING *`;
  if (!row) throw new HttpError(403, 'Keine Berechtigung');
  return row;
}
export async function removeStamm(tx: TxSql, id: string) {
  const [r] = await tx`UPDATE lv_stammleistung SET aktiv = false WHERE id = ${id} RETURNING id`;
  if (!r) throw new HttpError(404, 'Nicht gefunden');
  return { ok: true };
}
