/**
 * LV as PDF to fill in by hand (decided 12.11.2026): sent with every request, next to the link/QR for online entry.
 * Columns OZ · Leistung · Menge · Einheit · EP · GP with empty boxes, a sum line per Titel/Untertitel, and at the end
 * Summe netto, Nachlass, Angebotssumme, place/date and signature/stamp. Prices of the own calculation never appear.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { formatDate } from '@bap/domain';

export interface LvPdfData {
  titel: string;
  nummer: number | null;
  project: string;
  ownCompany: string;
  logo?: { bytes: Uint8Array; png: boolean } | null;
  /** Bidder firm (personal copy) or null for a neutral copy. */
  bieter: string | null;
  angebotsfrist: string | null;
  beschreibung?: string | null;
  /** Link for online entry; printed with a QR code. */
  url?: string | null;
  positionen: { art: string; oz: string; kurztext: string; langtext?: string | null; menge: number; einheit: string | null }[];
}

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const W = A4[0] - 2 * M;
const INK = rgb(0.1, 0.1, 0.12);
const GREY = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.75, 0.75, 0.78);
const FILL = rgb(0.95, 0.95, 0.96);
const NAVY = rgb(0.11, 0.2, 0.36);
// column x positions
const C = { oz: M, text: M + 62, menge: M + 300, einheit: M + 352, ep: M + 388, gp: M + 450, end: M + W };

const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF–—„“”‚‘’…•€·\n]/g, '?');
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });

function wrap(text: string, font: PDFFont, size: number, width: number, maxLines = 99): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  if (out.length > maxLines) return [...out.slice(0, maxLines - 1), `${out[maxLines - 1]!.slice(0, 80)} …`];
  return out;
}

export async function renderLvPdf(d: LvPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`LV ${d.nummer ?? ''} ${d.titel} – ${d.project}`);
  doc.setAuthor(d.ownCompany);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const text = (s: string, x: number, yy: number, size = 8.5, f = font, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, x: number, yy: number, size = 8.5, f = font) => text(s, x - f.widthOfTextAtSize(safe(s), size), yy, size, f);
  const box = (x1: number, x2: number, yy: number) => page.drawRectangle({ x: x1 + 4, y: yy - 3, width: x2 - x1 - 8, height: 13, borderColor: LINE, borderWidth: 0.6 });
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 16, color: FILL });
    text('OZ', C.oz + 2, y, 8, bold); text('Leistung', C.text, y, 8, bold);
    right('Menge', C.einheit - 6, y, 8, bold); text('Einh.', C.einheit, y, 8, bold);
    right('EP netto €', C.gp - 6, y, 8, bold); right('GP netto €', C.end - 4, y, 8, bold);
    y -= 20;
  };
  const newPage = (first = false) => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - M;
    if (!first) {
      text(`${d.ownCompany} · LV ${d.nummer ?? ''} ${d.titel}${d.bieter ? ` · Bieter: ${d.bieter}` : ''}`, M, y, 8, font, GREY);
      y -= 18;
      tableHead();
    }
  };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };

  // --- Page 1: header -------------------------------------------------------------------------
  newPage(true);
  let topY = y;
  if (d.logo) {
    try {
      // copy: a pooled Node Buffer would be read from the wrong offset
      const bytes = new Uint8Array(d.logo.bytes);
      const img = d.logo.png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const h = 34; const w = (img.width / img.height) * h;
      page.drawImage(img, { x: M, y: y - h + 8, width: Math.min(w, 160), height: h });
      topY = y - h - 6;
    } catch { /* unreadable logo: name only */ }
  }
  y = topY;
  text(d.ownCompany, M, y, 9, bold, GREY);
  y -= 26;
  text('Angebotsanfrage – Leistungsverzeichnis', M, y, 15, bold, NAVY);
  y -= 18;
  for (const l of wrap(`LV ${d.nummer ?? ''} · ${d.titel}`, bold, 11.5, W - 120)) { text(l, M, y, 11.5, bold); y -= 15; }
  const kopf: [string, string][] = [
    ['Bauvorhaben', d.project],
    ['Bieter', d.bieter ?? '______________________________________'],
    ['Angebotsfrist', d.angebotsfrist ? formatDate(d.angebotsfrist) : '–'],
  ];
  y -= 4;
  for (const [k, v] of kopf) { text(k, M, y, 9, font, GREY); text(v, M + 90, y, 9, bold); y -= 13; }
  if (d.url) {
    const qr = await doc.embedPng(await QRCode.toBuffer(d.url, { margin: 0, width: 240 }));
    const s = 92;
    const qy = A4[1] - M - s - 4;
    page.drawImage(qr, { x: M + W - s, y: qy, width: s, height: s });
    const hint = ['Schneller online ausfüllen:', 'QR-Code scannen oder Link', 'aus der E-Mail öffnen.'];
    hint.forEach((h, i) => right(h, M + W, qy - 12 - i * 10, 7.5, i === 0 ? bold : font));
  }
  if (d.beschreibung) {
    y -= 4;
    for (const l of wrap(d.beschreibung, font, 8.5, W, 8)) { text(l, M, y, 8.5, font, GREY); y -= 11; }
  }
  if (d.url) y = Math.min(y, A4[1] - M - 92 - 4 - 40); // below the QR code and its hint
  y -= 6;
  for (const l of wrap('Bitte tragen Sie Einheitspreise (EP) und Gesamtpreise (GP = Menge × EP) netto in Euro ein und senden Sie das unterschriebene Angebot zurück – oder geben Sie es online ab. Mengen und Texte bitte nicht ändern; Hinweise und Alternativen gern auf einem Beiblatt.', font, 8.5, W)) { text(l, M, y, 8.5); y -= 11; }
  y -= 10;
  tableHead();

  // --- Positions ------------------------------------------------------------------------------
  const textW = C.menge - C.text - 50;
  // Running Titel / Untertitel; each gets an empty sum box when it ends.
  const open: { art: string; label: string; oz: string }[] = [];
  const close = (alle: boolean) => {
    while (open.length && (alle || open[open.length - 1]!.art === 'untertitel')) {
      const t = open.pop()!;
      need(20);
      page.drawLine({ start: { x: C.text, y: y + 9 }, end: { x: C.end, y: y + 9 }, thickness: 0.4, color: LINE });
      text(`Summe ${t.oz} ${t.label}`.slice(0, 70), C.text, y, 8.5, bold);
      box(C.gp, C.end, y);
      y -= 20;
    }
  };
  for (const p of d.positionen) {
    if (p.art === 'titel') {
      close(true);
      need(40);
      y -= 4;
      text(p.oz, C.oz + 2, y, 9.5, bold, NAVY);
      for (const l of wrap(p.kurztext, bold, 9.5, C.end - C.text)) { text(l, C.text, y, 9.5, bold, NAVY); y -= 13; }
      y -= 2;
      open.push({ art: 'titel', label: p.kurztext, oz: p.oz });
    } else if (p.art === 'untertitel') {
      close(false);
      need(34);
      text(p.oz, C.oz + 2, y, 9, bold);
      for (const l of wrap(p.kurztext, bold, 9, C.end - C.text)) { text(l, C.text, y, 9, bold); y -= 12; }
      y -= 2;
      open.push({ art: 'untertitel', label: p.kurztext, oz: p.oz });
    } else if (p.art === 'text') {
      const ls = wrap(p.kurztext, font, 8, C.end - C.text);
      need(ls.length * 10 + 6);
      for (const l of ls) { text(l, C.text, y, 8, font, GREY); y -= 10; }
      y -= 4;
    } else {
      const ls = wrap(p.kurztext, bold, 8.5, textW);
      const lang = p.langtext ? wrap(p.langtext, font, 7.5, textW, 12) : [];
      need(ls.length * 11 + lang.length * 9.5 + 10);
      text(p.oz, C.oz + 2, y, 8.5);
      right(num(p.menge), C.einheit - 6, y);
      text(p.einheit ?? '', C.einheit, y);
      box(C.ep, C.gp, y);
      box(C.gp, C.end, y);
      for (const l of ls) { text(l, C.text, y, 8.5, bold); y -= 11; }
      for (const l of lang) { text(l, C.text, y, 7.5, font, GREY); y -= 9.5; }
      y -= 9;
      page.drawLine({ start: { x: M, y: y + 8 }, end: { x: C.end, y: y + 6 }, thickness: 0.3, color: rgb(0.88, 0.88, 0.9) });
    }
  }
  close(true);

  // --- Totals and signature -------------------------------------------------------------------
  need(170);
  y -= 8;
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: C.end, y: y + 12 }, thickness: 1, color: INK });
  const sumRow = (label: string, suffix = '') => { text(label, C.text, y, 9.5, bold); if (suffix) right(suffix, C.ep + 2, y, 9, font); box(C.gp, C.end, y); y -= 22; };
  sumRow('Summe netto');
  text('Nachlass', C.text, y, 9.5, bold); box(C.ep - 30, C.gp - 18, y); text('%', C.gp - 14, y, 9); box(C.gp, C.end, y); y -= 22;
  sumRow('Angebotssumme netto nach Nachlass');
  text('zzgl. gesetzlicher Umsatzsteuer', C.text, y, 8, font, GREY); y -= 30;
  text('Angebot gültig bis: ____________________', M, y, 9); y -= 34;
  page.drawLine({ start: { x: M, y }, end: { x: M + 200, y }, thickness: 0.6, color: INK });
  page.drawLine({ start: { x: M + 260, y }, end: { x: C.end, y }, thickness: 0.6, color: INK });
  y -= 11;
  text('Ort, Datum', M, y, 8, font, GREY);
  text('Unterschrift und Firmenstempel des Bieters', M + 260, y, 8, font, GREY);

  pages.forEach((pg, i) => {
    const s = safe(`${d.project} · LV ${d.nummer ?? ''} ${d.titel} · Seite ${i + 1} von ${pages.length}`);
    pg.drawText(s, { x: M, y: 22, size: 7, font, color: GREY });
  });
  return doc.save();
}
