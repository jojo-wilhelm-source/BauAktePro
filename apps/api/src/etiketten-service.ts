/**
 * Room QR labels as PDF (decided 12.11.2026). Format per project (Leitung), rooms selectable (all, or one floor/building).
 * The QR holds the web link to the room; the app recognises it and sets the room for a new Mangel or a documentation.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { TxSql } from '@bap/db';
import { etikettenRaster, EtikettenFormat, raumLink, STANDARD_ETIKETTEN, type EtikettZeile } from '@bap/domain';
import { WEB_URL } from './anmeldung';
import { actorFor, HttpError } from './mangel-service';

const MM = 72 / 25.4;
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF–—„“”‚‘’…•€·]/g, '?');

export async function getFormat(tx: TxSql, userId: string, projectId: string) {
  await actorFor(tx, userId, projectId);
  const [p] = await tx`SELECT etiketten_format FROM project WHERE id = ${projectId}`;
  return EtikettenFormat.parse(p?.etiketten_format ?? {});
}

export async function saveFormat(tx: TxSql, userId: string, projectId: string, input: unknown) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung') throw new HttpError(403, 'Das Etikettenformat legt die Bau- oder Projektleitung fest');
  const f = EtikettenFormat.parse(input);
  if (!etikettenRaster(f).passt) throw new HttpError(422, 'So passen die Etiketten nicht auf eine A4-Seite – bitte weniger Spalten/Zeilen oder kleinere Ränder');
  await tx`UPDATE project SET etiketten_format = ${tx.json(f as never)} WHERE id = ${projectId}`;
  return f;
}

/** Label sheet. `unter` limits to the rooms below a location (e.g. one floor); `format` overrides the saved one (preview). */
export async function etikettenPdf(tx: TxSql, userId: string, projectId: string, q: { unter?: string; format?: string }) {
  const a = await actorFor(tx, userId, projectId);
  if (a.role !== 'bauleitung' && a.role !== 'polier') throw new HttpError(403, 'Etiketten drucken Bauleitung und Polier');
  const f = q.format ? EtikettenFormat.parse(JSON.parse(q.format)) : await getFormat(tx, userId, projectId);
  const unter = q.unter ? z.string().uuid().parse(q.unter) : null;
  const rooms = await tx`
    WITH RECURSIVE tree AS (
      SELECT id, parent_id, kind, name, nummer, sort, ARRAY[sort] AS path FROM location WHERE project_id = ${projectId} AND parent_id IS NULL
      UNION ALL SELECT l.id, l.parent_id, l.kind, l.name, l.nummer, l.sort, t.path || l.sort FROM location l JOIN tree t ON l.parent_id = t.id)
    SELECT t.id, t.name, t.nummer,
      (SELECT g.name FROM location g WHERE g.id = t.parent_id) AS geschoss,
      (SELECT b.name FROM location b WHERE b.id = (SELECT parent_id FROM location WHERE id = t.parent_id)) AS gebaeude,
      (SELECT name FROM project WHERE id = ${projectId}) AS projekt
    FROM tree t
    WHERE t.kind = 'raum' ${unter ? tx`AND (t.parent_id = ${unter} OR t.id = ${unter} OR t.parent_id IN (SELECT id FROM location WHERE parent_id = ${unter}))` : tx``}
    ORDER BY t.path`;
  if (!rooms.length) throw new HttpError(422, 'Keine Räume gefunden – bitte zuerst Räume in „Projekt & Struktur“ anlegen');
  const r = etikettenRaster(f);
  const doc = await PDFDocument.create();
  doc.setTitle('Raum-Etiketten');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([210 * MM, 297 * MM]);
  for (let i = 0; i < rooms.length; i++) {
    if (i > 0 && i % r.proSeite === 0) page = doc.addPage([210 * MM, 297 * MM]);
    const room = rooms[i]!;
    const cell = r.zellen[i % r.proSeite]!;
    const x = cell.x * MM;
    const yTop = (297 - cell.y) * MM;
    const h = r.hoehe * MM;
    if (f.rahmen) page.drawRectangle({ x, y: yTop - h, width: r.breite * MM, height: h, borderColor: rgb(0.8, 0.8, 0.82), borderWidth: 0.5 });
    const png = await QRCode.toBuffer(raumLink(WEB_URL, room.id as string), { margin: 0, width: 300, errorCorrectionLevel: 'M' });
    const img = await doc.embedPng(png);
    const qr = r.qr * MM;
    const pad = 2 * MM;
    page.drawImage(img, { x: x + pad, y: yTop - h / 2 - qr / 2, width: qr, height: qr });
    const tx0 = x + pad * 2 + qr;
    const maxW = r.breite * MM - (tx0 - x) - pad;
    const lines = (f.inhalt as EtikettZeile[]).map((k) => {
      const v = { raum: room.name, nummer: room.nummer ? `Nr. ${room.nummer}` : null, geschoss: room.geschoss, gebaeude: room.gebaeude, projekt: room.projekt }[k];
      return v ? { text: safe(String(v)), main: k === 'raum' } : null;
    }).filter((l): l is { text: string; main: boolean } => !!l);
    const lh = f.schrift_pt * 1.25;
    let y = yTop - h / 2 + (lines.length * lh) / 2 - f.schrift_pt;
    for (const l of lines) {
      let size = l.main ? f.schrift_pt * 1.15 : f.schrift_pt * 0.9;
      const fnt = l.main ? bold : font;
      while (size > 5 && fnt.widthOfTextAtSize(l.text, size) > maxW) size -= 0.5;
      page.drawText(l.text, { x: tx0, y, size, font: fnt, color: l.main ? rgb(0.1, 0.1, 0.12) : rgb(0.4, 0.4, 0.43) });
      y -= lh;
    }
  }
  return doc.save();
}
