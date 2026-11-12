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
  };
  const [cur] = await tx`SELECT * FROM tagesbericht WHERE id = ${d.id} OR (project_id = ${d.project_id} AND datum = ${d.datum})` // no FOR UPDATE: RLS would hide locked rows; the version check is in the UPDATE;
  if (!cur) {
    const [row] = await tx`
      INSERT INTO tagesbericht ${tx({ id: d.id, project_id: d.project_id, datum: d.datum, ...fields, created_by: userId, created_at: meta.occurredAt } as never)} RETURNING *`;
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
  return { bytes: await readFile(FOTO_DIR + key), type: key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
}

// --- PDF -----------------------------------------------------------------------------------------

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const GREY = rgb(0.45, 0.45, 0.48);
const LINE = rgb(0.85, 0.85, 0.87);
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF–—„“”‚‘’…•€·\n]/g, '?');

function drawSignature(page: PDFPage, s: Signature | null, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.6 });
  if (!s) return;
  const scale = Math.min(w / s.w, h / s.h);
  const ox = x + (w - s.w * scale) / 2;
  const oy = y + (h - s.h * scale) / 2;
  for (const st of s.strokes) {
    for (let i = 1; i < st.length; i++) {
      page.drawLine({
        start: { x: ox + st[i - 1]![0] * s.w * scale, y: oy + (1 - st[i - 1]![1]) * s.h * scale },
        end: { x: ox + st[i]![0] * s.w * scale, y: oy + (1 - st[i]![1]) * s.h * scale },
        thickness: 1.2, color: rgb(0.05, 0.1, 0.35),
      });
    }
  }
}

export async function berichtPdf(tx: TxSql, userId: string, id: string) {
  const t = (await getBericht(tx, userId, id)) as Record<string, any>;
  const [ctx] = await tx`SELECT p.name AS project, (SELECT c.name FROM company c WHERE c.tenant_id = p.tenant_id AND c.kind = 'own' LIMIT 1) AS own FROM project p WHERE p.id = ${t.project_id}`;
  const doc = await PDFDocument.create();
  doc.setTitle(`Bautagebuch ${formatDate(t.datum)} – ${ctx!.project}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(A4);
  let y = A4[1] - M;
  const width = A4[0] - 2 * M;
  const text = (s: string, x: number, yy: number, size = 10, f: PDFFont = font, color = rgb(0.1, 0.1, 0.12)) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const ensure = (need: number) => {
    if (y - need < M + 30) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
  };
  const wrap = (s: string, size: number, w: number) => {
    const out: string[] = [];
    for (const para of safe(s).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > w && line) { out.push(line); line = word; } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const section = (title: string, lines: string[]) => {
    if (!lines.length) return;
    ensure(30 + lines.length * 13);
    y -= 8;
    text(title, M, y, 11, bold);
    y -= 5;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 0.6, color: LINE });
    y -= 14;
    for (const l of lines.flatMap((x) => wrap(x, 10, width))) {
      ensure(14);
      text(l, M, y);
      y -= 13;
    }
  };

  text(ctx!.own as string, M, y, 9.5, font, GREY);
  y -= 24;
  text(`Bautagebuch · ${wochentag(t.datum)}, ${formatDate(t.datum)}`, M, y, 17, bold);
  y -= 16;
  text(`${ctx!.project as string}${t.bereich ? ` · ${t.bereich}` : ''}`, M, y, 10.5, font, GREY);
  y -= 10;
  const w = t.wetter ?? {};
  section('Wetter', [[w.text, w.temp_min != null || w.temp_max != null ? `${w.temp_min ?? '–'} bis ${w.temp_max ?? '–'} °C` : null, w.niederschlag, w.wind].filter(Boolean).join(' · ') || '–']);
  section('Personal', (t.personal as any[]).map((p) => `${p.firma}: ${p.anzahl} Personen${p.taetigkeit ? ` – ${p.taetigkeit}` : ''}`));
  section('Geräte', (t.geraete as any[]).map((g) => `${g.anzahl} × ${g.name}`));
  section('Ausgeführte Leistungen', (t.leistungen as any[]).map((l) => `• ${l.text}${l.ort || l.gewerk ? ` (${[l.ort, l.gewerk].filter(Boolean).join(', ')})` : ''}`));
  if (t.lieferungen) section('Lieferungen', [t.lieferungen]);
  if (t.behinderungen) section('Behinderungen', [t.behinderungen]);
  if (t.besonderheiten) section('Besonderheiten / Unfälle', [t.besonderheiten]);
  section('Nachträge', (t.nachtraege as any[]).map((n) => `${new Date(n.created_at).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} ${n.name}: ${n.text}`));

  ensure(120);
  y -= 20;
  const bw = (width - 20) / 2;
  text('Aufgestellt', M, y, 9.5, bold);
  text('Gegengezeichnet (Bauleitung)', M + bw + 20, y, 9.5, bold);
  y -= 70;
  drawSignature(page, t.signature ?? null, M, y, bw, 60);
  drawSignature(page, t.countersignature ?? null, M + bw + 20, y, bw, 60);
  y -= 13;
  text(t.signed_at ? `${t.signed_by_name}, ${new Date(t.signed_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' })}` : 'noch nicht unterschrieben', M, y, 8.5, font, GREY);
  text(t.countersigned_at ? `${t.countersigned_by_name}, ${new Date(t.countersigned_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' })}` : '–', M + bw + 20, y, 8.5, font, GREY);
  if (t.bauherr_signed_at) {
    ensure(100);
    y -= 26;
    text('Gegengezeichnet (Bauherr)', M, y, 9.5, bold);
    y -= 70;
    drawSignature(page, t.bauherr_signature ?? null, M, y, bw, 60);
    y -= 13;
    text(new Date(t.bauherr_signed_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }), M, y, 8.5, font, GREY);
  }
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(safe(`Bautagebuch ${formatDate(t.datum)} · ${ctx!.project as string} · Seite ${i + 1} von ${pages.length} · Unterschriften dienen der Dokumentation`), { x: M, y: 28, size: 7.5, font, color: GREY });
    if (t.status === 'entwurf') pg.drawText('ENTWURF', { x: 170, y: 420, size: 80, font: bold, color: rgb(1, 0.6, 0), opacity: 0.12 });
  });
  return doc.save();
}

// --- Vorlagen, Bauherr, Ablage (decided 12.11.2026) ------------------------------------------------

/** What the Bauherr sees of a released report: only the released sections, no internal names of the crew. */
function fuerBauherr(t: Record<string, any>) {
  const ab = new Set<string>(t.bauherr_abschnitte ?? []);
  const leer = { wetter: {}, personal: [], geraete: [], leistungen: [], lieferungen: null, behinderungen: null, besonderheiten: null };
  const out: Record<string, any> = { id: t.id, project_id: t.project_id, datum: t.datum, bereich: t.bereich, status: t.status, version: t.version,
    signed_at: t.signed_at, signed_by_name: t.signed_by_name, countersigned_at: t.countersigned_at, countersigned_by_name: t.countersigned_by_name,
    bauherr_freigabe: t.bauherr_freigabe, bauherr_abschnitte: t.bauherr_abschnitte, bauherr_signed_at: t.bauherr_signed_at,
    nachtraege: t.nachtraege, fotos: [], can_edit: false, can_countersign: false, can_release: false, can_bauherr_sign: !t.bauherr_signed_at };
  for (const k of Object.keys(leer)) out[k] = ab.has(k) ? t[k] : (leer as Record<string, unknown>)[k];
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
