/**
 * Bautagebuch (docs/fachkonzept/07). Rights: internal roles write (Polier, Bauleitung, Projektleitung), the
 * Bauleitung countersigns. Writes come from the web and from the device upload queue (offline), so they are
 * idempotent and version-checked; rejected device edits become sync_conflict entries, never silent overwrites.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { formatDate, isPlausibleSignature, kalenderwoche, Signature, TagesberichtInput, TB_ABSCHNITTE, wochentag } from '@bap/domain';
import { DOC_DIR } from './dokumente-service';
import { actorFor, HttpError, type WriteMeta } from './mangel-service';

const FOTO_DIR = fileURLToPath(new URL('../../../storage/tagesbericht/', import.meta.url));
const iso = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

async function requireInternal(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung' && a.role !== 'polier') throw new HttpError(403, 'Das Bautagebuch führen Polier und Bauleitung');
  return a;
}

async function audit(tx: TxSql, userId: string, projectId: string, id: string, action: string, meta: WriteMeta, data: object) {
  await tx`
    INSERT INTO audit_log (tenant_id, project_id, entity, entity_id, action, actor_id, device_id, occurred_at, data)
    SELECT tenant_id, ${projectId}, 'tagesbericht', ${id}, ${action}, ${userId}, ${meta.deviceId}, ${meta.occurredAt}, ${tx.json(data as never)}
    FROM project WHERE id = ${projectId}`;
}

async function conflict(tx: TxSql, userId: string, projectId: string, id: string, reason: string, change: object, current: Record<string, unknown> | null) {
  await tx`
    INSERT INTO sync_conflict (project_id, entity, entity_id, actor_id, base_version, server_version, client_change, server_state, kind, reason)
    VALUES (${projectId}, 'tagesbericht', ${id}, ${userId}, ${(change as { version?: number }).version ?? null}, ${(current?.version as number) ?? null},
            ${tx.json(change as never)}, ${current ? tx.json(current as never) : null}, 'conflict', ${reason})`;
  return { ok: false as const, reason };
}

export async function listBerichte(tx: TxSql, userId: string, projectId: string) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung' && a.role !== 'polier' && a.role !== 'bauherr') throw new HttpError(403, 'Das Bautagebuch führen Polier und Bauleitung');
  // Bauherr: RLS returns only released, signed reports.
  return tx`
    SELECT t.id, t.datum::text AS datum, t.bereich, t.status, t.signed_at, t.countersigned_at, t.version, t.wetter,
      t.bauherr_freigabe, t.bauherr_signed_at,
      (SELECT coalesce(sum((p->>'anzahl')::int), 0) FROM jsonb_array_elements(t.personal) p)::int AS personen,
      jsonb_array_length(t.leistungen) AS leistungen, s.name AS signed_by_name, c.name AS countersigned_by_name,
      (SELECT count(*)::int FROM tagesbericht_nachtrag n WHERE n.bericht_id = t.id) AS nachtraege
    FROM tagesbericht t LEFT JOIN app_user s ON s.id = t.signed_by LEFT JOIN app_user c ON c.id = t.countersigned_by
    WHERE t.project_id = ${projectId} ORDER BY t.datum DESC LIMIT 120`;
}

export async function getBericht(tx: TxSql, userId: string, id: string) {
  const [t] = await tx`
    SELECT t.*, s.name AS signed_by_name, c.name AS countersigned_by_name, u.name AS created_by_name
    FROM tagesbericht t LEFT JOIN app_user s ON s.id = t.signed_by LEFT JOIN app_user c ON c.id = t.countersigned_by JOIN app_user u ON u.id = t.created_by
    WHERE t.id = ${id}`; // RLS
  if (!t) throw new HttpError(404, 'Tagesbericht nicht gefunden');
  const a = await actorFor(tx, userId, t.project_id as string);
  const nachtraege = await tx`SELECT n.id, n.text, n.created_at, u.name FROM tagesbericht_nachtrag n JOIN app_user u ON u.id = n.created_by WHERE n.bericht_id = ${id} ORDER BY n.created_at`;
  if (a.role === 'bauherr') return fuerBauherr({ ...t, datum: iso(t.datum), nachtraege, fotos: [] });
  if (a.role !== 'bauleitung' && a.role !== 'polier') throw new HttpError(403, 'Das Bautagebuch führen Polier und Bauleitung');
  const fotos = await tx`SELECT id, caption, created_at FROM tagesbericht_foto WHERE bericht_id = ${id} ORDER BY created_at`;
  return { ...t, datum: iso(t.datum), nachtraege, fotos, can_edit: t.status === 'entwurf', can_countersign: a.role === 'bauleitung' && t.status === 'unterschrieben' && !t.countersigned_at,
    can_release: a.role === 'bauleitung' && t.status === 'unterschrieben' };
}

/** Suggestion for a new day: personnel, equipment and area from the last report; Mängel recorded today as a hint. */
export async function vorschlag(tx: TxSql, userId: string, projectId: string, datum: string) {
  await requireInternal(tx, userId, projectId);
  const [last] = await tx`SELECT bereich, personal, geraete FROM tagesbericht WHERE project_id = ${projectId} AND datum < ${datum} ORDER BY datum DESC LIMIT 1`;
  const maengel = await tx`SELECT number, description FROM mangel WHERE project_id = ${projectId} AND created_at::date = ${datum} AND deleted_at IS NULL ORDER BY number`;
  const firmen = await tx`
    SELECT DISTINCT c.id, c.name FROM company c
    WHERE c.kind = 'nu' AND (EXISTS (SELECT 1 FROM project_company pc WHERE pc.company_id = c.id AND pc.project_id = ${projectId})
                         OR EXISTS (SELECT 1 FROM project_member pm WHERE pm.company_id = c.id AND pm.project_id = ${projectId}))
    ORDER BY c.name`;
  const [own] = await tx`SELECT c.id, c.name FROM company c JOIN project p ON p.tenant_id = c.tenant_id WHERE p.id = ${projectId} AND c.kind = 'own' LIMIT 1`;
  const vorlagen = await tx`SELECT id, name, project_id, inhalt FROM tagesbericht_vorlage WHERE aktiv AND (project_id IS NULL OR project_id = ${projectId}) ORDER BY project_id NULLS LAST, name`;
  return {
    vorlagen,
    bereich: last?.bereich ?? null,
    personal: last?.personal ?? [{ firma: own?.name ?? 'Eigene Firma', company_id: own?.id ?? null, anzahl: 0 }],
    geraete: last?.geraete ?? [],
    firmen: [...(own ? [own] : []), ...firmen],
    maengelHeute: maengel.map((m) => `M-${String(m.number).padStart(3, '0')} ${m.description as string}`),
  };
}

export type SaveResult = { ok: true; bericht: Record<string, unknown> } | { ok: false; reason: string };

/** Create or update a draft (web and device). One report per day; a signed report is never changed. */
export async function saveBericht(tx: TxSql, userId: string, input: unknown, meta: WriteMeta): Promise<SaveResult> {
  const d = TagesberichtInput.parse(input);
  await requireInternal(tx, userId, d.project_id);
  const fields = {
    bereich: d.bereich ?? null, wetter: tx.json(d.wetter as never), personal: tx.json(d.personal as never), geraete: tx.json(d.geraete as never),
    leistungen: tx.json(d.leistungen as never), lieferungen: d.lieferungen ?? null, behinderungen: d.behinderungen ?? null, besonderheiten: d.besonderheiten ?? null,
    einsatz: tx.json(d.einsatz as never), besuche: d.besuche ?? null, anordnungen: d.anordnungen ?? null,
  };
  const [cur] = await tx`SELECT * FROM tagesbericht WHERE id = ${d.id} OR (project_id = ${d.project_id} AND datum = ${d.datum})` // no FOR UPDATE: RLS would hide locked rows; the version check is in the UPDATE;
  if (!cur) {
    const [row] = await tx`
      INSERT INTO tagesbericht ${tx({ id: d.id, project_id: d.project_id, datum: d.datum, ...fields, created_by: userId, created_at: meta.occurredAt,
        // Blatt-Nr. as in the paper Bautagebuch: running number per project.
        blatt_nr: ((await tx`SELECT coalesce(max(blatt_nr), 0) + 1 AS n FROM tagesbericht WHERE project_id = ${d.project_id}`)[0]!.n as number) } as never)} RETURNING *`;
    await audit(tx, userId, d.project_id, d.id, 'angelegt', meta, { datum: d.datum });
    return { ok: true, bericht: row! };
  }
  if (cur.id !== d.id) return conflict(tx, userId, d.project_id, d.id, `Für den ${formatDate(d.datum)} gibt es schon einen Tagesbericht – bitte dort ergänzen.`, d, cur);
  if (cur.status !== 'entwurf') return conflict(tx, userId, d.project_id, d.id, `Der Tagesbericht vom ${formatDate(d.datum)} ist bereits unterschrieben – Ergänzungen bitte als Nachtrag.`, d, cur);
  if (d.version != null && d.version !== cur.version) return conflict(tx, userId, d.project_id, d.id, `Der Tagesbericht vom ${formatDate(d.datum)} wurde inzwischen geändert – Ihre Änderung wurde nicht übernommen.`, d, cur);
  const [row] = await tx`UPDATE tagesbericht SET ${tx(fields as never)}, version = version + 1, updated_at = now() WHERE id = ${d.id} AND version = ${cur.version} AND status = 'entwurf' RETURNING *`;
  if (!row) return conflict(tx, userId, d.project_id, d.id, `Der Tagesbericht vom ${formatDate(d.datum)} wurde gleichzeitig geändert – Ihre Änderung wurde nicht übernommen.`, d, cur);
  await audit(tx, userId, d.project_id, d.id, 'geaendert', meta, { base_version: cur.version });
  return { ok: true, bericht: row! };
}

const SignInput = z.object({ signature: Signature, base_version: z.coerce.number().int() });

/** Sign (Polier or Bauleitung) → locked. Countersign (Bauleitung) after that. */
export async function signBericht(tx: TxSql, userId: string, id: string, kind: 'unterschreiben' | 'gegenzeichnen', input: unknown, meta: WriteMeta): Promise<SaveResult> {
  const d = SignInput.parse(input);
  if (!isPlausibleSignature(d.signature)) throw new HttpError(422, 'Bitte richtig unterschreiben');
  const [cur] = await tx`SELECT * FROM tagesbericht WHERE id = ${id}`;
  if (!cur) throw new HttpError(404, 'Tagesbericht nicht gefunden');
  const a = await requireInternal(tx, userId, cur.project_id as string);
  if (cur.version !== d.base_version) return conflict(tx, userId, cur.project_id as string, id, 'Der Tagesbericht wurde inzwischen geändert – bitte prüfen und erneut unterschreiben.', d, cur);
  let row;
  if (kind === 'unterschreiben') {
    if (cur.status !== 'entwurf') throw new HttpError(409, 'Bereits unterschrieben');
    [row] = await tx`UPDATE tagesbericht SET status = 'unterschrieben', signed_by = ${userId}, signed_at = ${meta.occurredAt}, signature = ${tx.json(d.signature as never)},
      version = version + 1, updated_at = now() WHERE id = ${id} AND version = ${cur.version} RETURNING *`;
  } else {
    if (a.role !== 'bauleitung') throw new HttpError(403, 'Gegenzeichnen darf die Bauleitung');
    if (cur.status !== 'unterschrieben' || cur.countersigned_at) throw new HttpError(409, 'Nur unterschriebene, noch nicht gegengezeichnete Berichte');
    [row] = await tx`UPDATE tagesbericht SET countersigned_by = ${userId}, countersigned_at = ${meta.occurredAt}, countersignature = ${tx.json(d.signature as never)},
      version = version + 1, updated_at = now() WHERE id = ${id} AND version = ${cur.version} RETURNING *`;
  }
  if (!row) return conflict(tx, userId, cur.project_id as string, id, 'Der Tagesbericht wurde gleichzeitig geändert – bitte erneut unterschreiben.', d, cur);
  await audit(tx, userId, cur.project_id as string, id, kind === 'unterschreiben' ? 'unterschrieben' : 'gegengezeichnet', meta, { datum: iso(cur.datum) });
  await ablegen(tx, userId, id); // PDF into Dokumente › Bautagebuch › Jahr › KW
  return { ok: true, bericht: row! };
}

export async function addNachtrag(tx: TxSql, userId: string, berichtId: string, input: unknown, meta: WriteMeta) {
  const { text, id } = z.object({ text: z.string().trim().min(3, 'Bitte den Nachtrag beschreiben').max(4000), id: z.string().uuid().optional() }).parse(input);
  const [cur] = await tx`SELECT id, project_id, status FROM tagesbericht WHERE id = ${berichtId}`;
  if (!cur) throw new HttpError(404, 'Tagesbericht nicht gefunden');
  await requireInternal(tx, userId, cur.project_id as string);
  if (cur.status !== 'unterschrieben') throw new HttpError(409, 'Entwürfe bitte direkt bearbeiten; Nachträge gibt es nach der Unterschrift');
  const nid = id ?? randomUUID();
  const [dup] = await tx`SELECT id FROM tagesbericht_nachtrag WHERE id = ${nid}`;
  if (!dup) {
    await tx`INSERT INTO tagesbericht_nachtrag (id, bericht_id, project_id, text, created_by, created_at) VALUES (${nid}, ${berichtId}, ${cur.project_id}, ${text}, ${userId}, ${meta.occurredAt})`;
    await audit(tx, userId, cur.project_id as string, berichtId, 'nachtrag', meta, { text });
    await ablegen(tx, userId, berichtId);
  }
  return { ok: true };
}

export async function addFoto(tx: TxSql, userId: string, berichtId: string, file: { bytes: Buffer; name: string }, caption: string | null) {
  const [cur] = await tx`SELECT id, project_id FROM tagesbericht WHERE id = ${berichtId}`;
  if (!cur) throw new HttpError(404, 'Tagesbericht nicht gefunden');
  await requireInternal(tx, userId, cur.project_id as string);
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  if (!['jpg', 'png'].includes(ext)) throw new HttpError(422, 'Bitte ein Foto (JPG oder PNG)');
  const id = randomUUID();
  await mkdir(FOTO_DIR, { recursive: true });
  await writeFile(`${FOTO_DIR}${id}.${ext}`, file.bytes);
  await tx`INSERT INTO tagesbericht_foto (id, bericht_id, project_id, file_key, caption, created_by) VALUES (${id}, ${berichtId}, ${cur.project_id}, ${`${id}.${ext}`}, ${caption}, ${userId})`;
  return { id };
}

export async function fotoFile(tx: TxSql, id: string) {
  const [f] = await tx`SELECT file_key FROM tagesbericht_foto WHERE id = ${id}`; // RLS
  if (!f) throw new HttpError(404, 'Foto nicht gefunden');
  const key = (f.file_key as string).replace(/[^a-z0-9._-]/gi, '');
  return { pfad: FOTO_DIR + key, type: key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

// --- PDF in the company format (template "Vorlage_Bautagesbericht") ------------------------------

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const INK = rgb(0.08, 0.08, 0.1);
const GREY = rgb(0.42, 0.42, 0.45);
const RULE = rgb(0, 0, 0);
const FILL = rgb(0.9, 0.9, 0.9);
export const LOGO_DIR = fileURLToPath(new URL('../../../storage/logos/', import.meta.url));
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF–—„“”‚‘’…•€·\n]/g, '?');
const zeit = (d: unknown) => new Date(d as string).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });

function drawSignature(page: PDFPage, s: Signature | null, x: number, y: number, w: number, h: number) {
  if (!s) return;
  const scale = Math.min(w / s.w, h / s.h);
  const ox = x + (w - s.w * scale) / 2;
  const oy = y + (h - s.h * scale) / 2;
  for (const st of s.strokes) {
    for (let i = 1; i < st.length; i++) {
      page.drawLine({
        start: { x: ox + st[i - 1]![0] * s.w * scale, y: oy + (1 - st[i - 1]![1]) * s.h * scale },
        end: { x: ox + st[i]![0] * s.w * scale, y: oy + (1 - st[i]![1]) * s.h * scale },
        thickness: 1.1, color: rgb(0.05, 0.1, 0.35),
      });
    }
  }
}

export async function berichtPdf(tx: TxSql, userId: string, id: string) {
  const t = (await getBericht(tx, userId, id)) as Record<string, any>;
  const [ctx] = await tx`
    SELECT p.name AS project, p.bauort, p.baustellen_nr, coalesce(p.bauherr_name,
      (SELECT c.name FROM company c JOIN project_member pm ON pm.company_id = c.id WHERE pm.project_id = p.id AND pm.role = 'bauherr' LIMIT 1)) AS bauherr,
      o.id AS own_id, o.name AS own, coalesce(o.kurzname, o.name) AS own_short, o.logo_key
    FROM project p LEFT JOIN company o ON o.tenant_id = p.tenant_id AND o.kind = 'own' WHERE p.id = ${t.project_id} LIMIT 1`;
  const doc = await PDFDocument.create();
  doc.setTitle(`Bautagebuch ${formatDate(t.datum)} – ${ctx!.project}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (ctx!.logo_key) {
    try {
      const bytes = await readFile(LOGO_DIR + (ctx!.logo_key as string).replace(/[^a-z0-9._-]/gi, ''));
      logo = (ctx!.logo_key as string).endsWith('.png') ? await doc.embedPng(new Uint8Array(bytes)) : await doc.embedJpg(new Uint8Array(bytes));
    } catch { /* no logo file */ }
  }
  let page = doc.addPage(A4);
  const W = A4[0] - 2 * M;
  let y = A4[1] - M;
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const box = (x: number, yTop: number, w: number, h: number, fill = false) => page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: RULE, borderWidth: 0.8, ...(fill ? { color: FILL } : {}) });
  const wrap = (s: string, size: number, w: number, f: PDFFont = font) => {
    const out: string[] = [];
    for (const para of safe(s).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > w && line) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const labelValue = (label: string, value: string, x: number, yy: number, size = 9.5) => {
    text(label, x, yy, size, bold);
    text(value, x + bold.widthOfTextAtSize(label, size) + 3, yy, size, bold);
  };

  // --- Kopf: Titel, Blatt-Nr., Baumaßnahme, Bauort, Baustellen-Nr., Bauherr | Logo, Datum
  const lw = W * 0.68;
  const rw = W - lw;
  const rows = [34, 40, 26, 30];
  let yy = y;
  rows.forEach((h, i) => {
    if (i === 2) { box(M, yy, lw * 0.45, h); box(M + lw * 0.45, yy, lw * 0.55, h); } else box(M, yy, lw, h);
    yy -= h;
  });
  box(M + lw, y, rw, rows[0]! + rows[1]! + rows[2]!);
  box(M + lw, y - rows[0]! - rows[1]! - rows[2]!, rw, rows[3]!);
  text('Bautagebuch', M + 4, y - 24, 18, bold);
  const blatt = `Blatt-Nr.: ${t.blatt_nr ?? '–'}`;
  text(blatt, M + lw - font.widthOfTextAtSize(blatt, 9) - 4, y - 24, 9);
  labelValue('Baumaßnahme:', ctx!.project as string, M + 4, y - rows[0]! - 24, 11);
  const r3 = y - rows[0]! - rows[1]! - 17;
  labelValue('Bauort:', (ctx!.bauort as string) ?? '–', M + 4, r3);
  labelValue('Baustellen-Nr.:', (ctx!.baustellen_nr as string) ?? '–', M + lw * 0.45 + 4, r3);
  labelValue('Bauherr:', (ctx!.bauherr as string) ?? '–', M + 4, y - rows[0]! - rows[1]! - rows[2]! - 19);
  if (logo) {
    const sc = Math.min((rw - 16) / logo.width, 52 / logo.height);
    page.drawImage(logo, { x: M + lw + (rw - logo.width * sc) / 2, y: y - (rows[0]! + rows[1]! + rows[2]!) / 2 - (logo.height * sc) / 2, width: logo.width * sc, height: logo.height * sc });
  } else text(ctx!.own as string, M + lw + 8, y - 50, 12, bold);
  labelValue('Datum:', `${formatDate(t.datum)} (${wochentag(t.datum).slice(0, 2)})`, M + lw + 4, y - rows[0]! - rows[1]! - rows[2]! - 19);
  y = yy - 16;

  // --- Arbeitseinsatz (eigene Leute) | Wetter
  const e = (t.einsatz ?? {}) as { von?: string; bis?: string; aufsicht?: number | null; arbeiter?: number | null };
  const personal = (t.personal ?? []) as { firma: string; company_id?: string | null; gewerk?: string; anzahl: number }[];
  const eigene = personal.filter((p) => p.company_id === ctx!.own_id || p.firma === ctx!.own);
  const nus = personal.filter((p) => !eigene.includes(p));
  const arbeiter = e.arbeiter ?? (e.aufsicht == null ? eigene.reduce((s, p) => s + (Number(p.anzahl) || 0), 0) : null);
  const aw = W * 0.56;
  const ww = W - aw - 10;
  const bh = 92;
  box(M, y, aw, 18, true); box(M + aw + 10, y, ww, 18, true);
  text('Arbeitseinsatz:', M + 4, y - 13, 9.5, bold); text('Wetter:', M + aw + 14, y - 13, 9.5, bold);
  const y2 = y - 18;
  box(M, y2, aw, bh); box(M + aw + 10, y2, ww, bh);
  // Uhrzeit von / bis | MA-Zahl: Aufsicht, Arbeiter, Summe
  const c1 = aw * 0.42;
  page.drawLine({ start: { x: M + c1, y: y2 }, end: { x: M + c1, y: y2 - bh }, thickness: 0.6, color: RULE });
  text('Uhrzeit', M + 4, y2 - 14, 9, bold);
  text('Von', M + 4, y2 - 32, 8.5, bold); text('Bis', M + c1 / 2 + 2, y2 - 32, 8.5, bold);
  text(e.von ?? '–', M + 4, y2 - 50, 10); text(e.bis ?? '–', M + c1 / 2 + 2, y2 - 50, 10);
  text(`MA-Zahl ${ctx!.own_short as string}`, M + c1 + 4, y2 - 14, 9, bold);
  const z = (lbl: string, v: number | null | undefined, yv: number, b = false) => {
    text(lbl, M + c1 + 4, yv, 9, b ? bold : font);
    const vs = v == null ? '–' : String(v);
    text(vs, M + aw - 8 - font.widthOfTextAtSize(vs, 10), yv, 10, b ? bold : font);
  };
  z('Aufsicht', e.aufsicht, y2 - 34); z('Arbeiter', arbeiter, y2 - 52);
  page.drawLine({ start: { x: M + c1, y: y2 - 64 }, end: { x: M + aw, y: y2 - 64 }, thickness: 0.6, color: RULE });
  z('Summe', (Number(e.aufsicht) || 0) + (Number(arbeiter) || 0), y2 - 80, true);
  // Wetter: Witterung | Zeit | °C
  const w = (t.wetter ?? {}) as { text?: string; temp_min?: number | null; temp_max?: number | null; niederschlag?: string; wind?: string; messungen?: { zeit?: string; witterung?: string; temp?: number | null }[] };
  const mess = w.messungen?.length ? w.messungen : [{ zeit: '', witterung: [w.text, w.niederschlag, w.wind].filter(Boolean).join(', '), temp: w.temp_max ?? w.temp_min ?? null }];
  const wx = M + aw + 10;
  text('Witterung', wx + 4, y2 - 14, 9, bold); text('Zeit', wx + ww * 0.62, y2 - 14, 9, bold); text('°C', wx + ww * 0.84, y2 - 14, 9, bold);
  mess.slice(0, 4).forEach((m, i) => {
    const yv = y2 - 32 - i * 16;
    text(wrap(m.witterung || '–', 9, ww * 0.58)[0] ?? '–', wx + 4, yv, 9);
    text(m.zeit || '', wx + ww * 0.62, yv, 9);
    text(m.temp == null ? '' : String(m.temp), wx + ww * 0.84, yv, 9);
  });
  y = y2 - bh - 14;

  // --- Nachunternehmer: Firma | Gewerk | Anzahl (two columns as on the paper form)
  const colW = (W - 10) / 2;
  const half = Math.ceil(Math.max(nus.length, 1) / 2);
  const rowH = 14;
  const tableH = 18 + Math.max(half, 2) * rowH + 4;
  [0, 1].forEach((col) => {
    const x = M + col * (colW + 10);
    box(x, y, colW, tableH);
    page.drawLine({ start: { x, y: y - 18 }, end: { x: x + colW, y: y - 18 }, thickness: 0.6, color: RULE });
    text('Firma', x + 4, y - 13, 9, bold); text('Gewerk', x + colW * 0.45, y - 13, 9, bold); text('Anzahl', x + colW * 0.82, y - 13, 9, bold);
    nus.slice(col * half, col * half + half).forEach((p, i) => {
      const yv = y - 18 - (i + 1) * rowH + 3;
      text(wrap(p.firma, 9, colW * 0.42)[0]!, x + 4, yv, 9);
      text(wrap(p.gewerk ?? '', 9, colW * 0.35)[0] ?? '', x + colW * 0.45, yv, 9);
      text(String(p.anzahl ?? ''), x + colW * 0.82, yv, 9);
    });
  });
  y -= tableH + 12;

  // --- Text blocks with a grey label (Geräteeinsatz, Ausgeführte Arbeiten, Besuche, Anordnungen, …)
  const ensure = (need: number) => {
    if (y - need < M + 30) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
  };
  const block = (label: string, lines: string[]) => {
    const body = lines.flatMap((l) => wrap(l, 9.5, W - 12));
    if (!body.length) body.push('–');
    let i = 0;
    while (i < body.length) {
      ensure(40);
      const fit = Math.max(1, Math.min(body.length - i, Math.floor((y - M - 30 - 22) / 12)));
      const h = 20 + fit * 12 + 6;
      box(M, y, W, h);
      page.drawRectangle({ x: M, y: y - 16, width: bold.widthOfTextAtSize(label, 9.5) + 8, height: 16, color: FILL, borderColor: RULE, borderWidth: 0.6 });
      text(label, M + 4, y - 12, 9.5, bold);
      body.slice(i, i + fit).forEach((l, k) => text(l, M + 6, y - 30 - k * 12, 9.5));
      i += fit;
      y -= h + 8;
    }
  };
  block('Geräteeinsatz:', ((t.geraete ?? []) as { name: string; anzahl: number }[]).map((g) => `${g.anzahl} × ${g.name}`));
  block('Ausgeführte Arbeiten:', ((t.leistungen ?? []) as { text: string; firma?: string; ort?: string }[]).map((l) =>
    `${l.firma ? `Fa. ${l.firma}${l.ort ? ` (${l.ort})` : ''}: ` : l.ort ? `(${l.ort}) ` : ''}${l.text}`));
  if (t.besuche) block('Besuche (Abnahmen, Ortstermine, etc.):', [t.besuche]);
  if (t.anordnungen) block('Anordnungen:', [t.anordnungen]);
  if (t.behinderungen) block('Behinderungen:', [t.behinderungen]);
  if (t.lieferungen) block('Lieferungen:', [t.lieferungen]);
  if (t.besonderheiten) block('Hinweise / Besonderheiten:', [t.besonderheiten]);
  if ((t.nachtraege as unknown[]).length) block('Nachträge:', (t.nachtraege as { created_at: string; name: string; text: string }[]).map((n) => `${zeit(n.created_at)} ${n.name}: ${n.text}`));

  // --- Unterschriften: Polier/Schachtmeister | Auftraggeber; Prüfvermerk Bauleitung
  if (y - 130 < M + 10) {
    page = doc.addPage(A4);
    y = A4[1] - M;
  }
  y -= 6;
  const sw = (W - 40) / 2;
  drawSignature(page, t.signature ?? null, M, y - 52, sw, 48);
  drawSignature(page, t.bauherr_signature ?? null, M + sw + 40, y - 52, sw, 48);
  y -= 56;
  page.drawLine({ start: { x: M, y }, end: { x: M + sw, y }, thickness: 0.8, color: RULE });
  page.drawLine({ start: { x: M + sw + 40, y }, end: { x: W + M, y }, thickness: 0.8, color: RULE });
  text('Unterschrift Polier/ Schachtmeister', M, y - 12, 8.5);
  text('Unterschrift Auftraggeber', M + sw + 40, y - 12, 8.5);
  if (t.signed_at) text(`${t.signed_by_name}, ${zeit(t.signed_at)}`, M, y - 24, 7.5, font, GREY);
  if (t.bauherr_signed_at) text(zeit(t.bauherr_signed_at), M + sw + 40, y - 24, 7.5, font, GREY);
  if (t.countersigned_at) {
    y -= 40;
    drawSignature(page, t.countersignature ?? null, M, y - 30, 120, 28);
    text(`Geprüft Bauleitung: ${t.countersigned_by_name}, ${zeit(t.countersigned_at)}`, M + 130, y - 18, 8.5, font, GREY);
  }

  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(safe(`Bautagebuch Blatt ${t.blatt_nr ?? '–'} · ${formatDate(t.datum)} · ${ctx!.project as string} · Seite ${i + 1} von ${pages.length}`), { x: M, y: 22, size: 7.5, font, color: GREY });
    if (t.status === 'entwurf') pg.drawText('ENTWURF', { x: 170, y: 420, size: 80, font: bold, color: rgb(1, 0.6, 0), opacity: 0.12 });
  });
  return doc.save();
}

// --- Vorlagen, Bauherr, Ablage (decided 12.11.2026) ------------------------------------------------

/** What the Bauherr sees of a released report: only the released sections, no internal names of the crew. */
function fuerBauherr(t: Record<string, any>) {
  const ab = new Set<string>(t.bauherr_abschnitte ?? []);
  const leer = { wetter: {}, personal: [], geraete: [], leistungen: [], besuche: null, anordnungen: null, lieferungen: null, behinderungen: null, besonderheiten: null };
  const out: Record<string, any> = { id: t.id, project_id: t.project_id, datum: t.datum, bereich: t.bereich, status: t.status, version: t.version,
    signed_at: t.signed_at, signed_by_name: t.signed_by_name, countersigned_at: t.countersigned_at, countersigned_by_name: t.countersigned_by_name,
    blatt_nr: t.blatt_nr, einsatz: t.einsatz, signature: t.signature, bauherr_signature: t.bauherr_signature,
    bauherr_freigabe: t.bauherr_freigabe, bauherr_abschnitte: t.bauherr_abschnitte, bauherr_signed_at: t.bauherr_signed_at,
    nachtraege: t.nachtraege, fotos: [], can_edit: false, can_countersign: false, can_release: false, can_bauherr_sign: !t.bauherr_signed_at };
  for (const k of Object.keys(leer)) out[k] = ab.has(k) ? t[k] : (leer as Record<string, unknown>)[k];
  if (!ab.has('personal')) out.einsatz = {};
  return out;
}

const VorlageInput = z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(80), project_id: z.string().uuid().nullish(), inhalt: z.record(z.unknown()) });
export async function saveVorlage(tx: TxSql, userId: string, input: unknown) {
  const d = VorlageInput.parse(input);
  const inhalt = TagesberichtInput.pick({ bereich: true, wetter: true, personal: true, geraete: true, leistungen: true, lieferungen: true, behinderungen: true, besonderheiten: true })
    .partial().parse(d.inhalt);
  const [row] = await tx`
    INSERT INTO tagesbericht_vorlage (id, tenant_id, project_id, name, inhalt, created_by)
    VALUES (${d.id}, app.user_tenant(), ${d.project_id ?? null}, ${d.name}, ${tx.json(inhalt as never)}, ${userId})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, inhalt = EXCLUDED.inhalt RETURNING *`;
  return row;
}
export async function removeVorlage(tx: TxSql, id: string) {
  const [r] = await tx`UPDATE tagesbericht_vorlage SET aktiv = false WHERE id = ${id} RETURNING id`;
  if (!r) throw new HttpError(404, 'Vorlage nicht gefunden');
  return { ok: true };
}

export async function bauherrFreigabe(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const d = z.object({ freigabe: z.boolean(), abschnitte: z.array(z.enum(TB_ABSCHNITTE)).default(['wetter', 'leistungen']) }).parse(input);
  const [t] = await tx`SELECT project_id, datum FROM tagesbericht WHERE id = ${id}`;
  if (!t) throw new HttpError(404, 'Tagesbericht nicht gefunden');
  const a = await actorFor(tx, userId, t.project_id as string);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Freigeben darf die Bau- oder Projektleitung');
  const [r] = await tx`SELECT app.tagesbericht_freigabe(${id}, ${d.freigabe}, ${d.abschnitte}) AS ok`;
  if (!r?.ok) throw new HttpError(409, 'Nur unterschriebene Berichte; nach der Gegenzeichnung des Bauherrn bleibt die Freigabe');
  await audit(tx, userId, t.project_id as string, id, d.freigabe ? 'bauherr_freigegeben' : 'bauherr_freigabe_zurueck', meta, { abschnitte: d.abschnitte });
  return { ok: true };
}

export async function bauherrZeichnen(tx: TxSql, userId: string, id: string, input: unknown, meta: WriteMeta) {
  const { signature } = z.object({ signature: Signature }).parse(input);
  if (!isPlausibleSignature(signature)) throw new HttpError(422, 'Bitte richtig unterschreiben');
  const [t] = await tx`SELECT project_id FROM tagesbericht WHERE id = ${id}`;
  if (!t) throw new HttpError(404, 'Tagesbericht nicht gefunden');
  const [r] = await tx`SELECT app.tagesbericht_bauherr_zeichnen(${id}, ${tx.json(signature as never)}) AS ok`;
  if (!r?.ok) throw new HttpError(409, 'Gegenzeichnen nicht möglich (nicht freigegeben oder schon gezeichnet)');
  await audit(tx, userId, t.project_id as string, id, 'bauherr_gegengezeichnet', meta, {});
  return { ok: true };
}

/**
 * Files the report as PDF under Dokumente › Bautagebuch › Jahr › KW xx (one document per day; a new version after
 * countersignature or Nachtrag). ANNAHME: layout as now until the user's format is available (offene-punkte D10).
 */
export async function ablegen(tx: TxSql, userId: string, id: string) {
  const [t] = await tx`SELECT project_id, datum::text AS datum FROM tagesbericht WHERE id = ${id}`;
  if (!t) return null;
  const datum = t.datum as string;
  const { jahr, kw } = kalenderwoche(datum);
  const bytes = await berichtPdf(tx, userId, id);
  const rev = randomUUID();
  await mkdir(DOC_DIR, { recursive: true });
  await writeFile(`${DOC_DIR}${rev}.pdf`, bytes);
  const name = `${formatDate(datum)} ${wochentag(datum)}`;
  const [r] = await tx`SELECT app.ablage_pdf(${t.project_id}, ${['Bautagebuch', String(jahr), `KW ${String(kw).padStart(2, '0')}`]}, ${name},
    NULL, ${rev}, ${`${rev}.pdf`}, ${`Bautagebuch_${datum}.pdf`}, ${bytes.length}) AS doc`;
  return r?.doc as string;
}
