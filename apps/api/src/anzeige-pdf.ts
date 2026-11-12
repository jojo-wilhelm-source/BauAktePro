/**
 * PDF of a Mangelanzeige (docs/fachkonzept/04-maengel.md): letter head, request with deadline, numbered
 * positions, each with a crop of the plan around the pin. The plan crop is embedded as vector
 * (pdf-lib embedPage with a bounding box), so it stays sharp and nothing is rasterised.
 */
import { readFile } from 'node:fs/promises';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { anzeigeNo, formatDate } from '@bap/domain';

export interface AnzeigePdfData {
  number: number | null;
  draft: boolean;
  createdAt: Date;
  deadline: string;
  note: string | null;
  ownCompany: string;
  project: string;
  recipient: { name: string; email: string | null };
  signer: string;
  /** QR-Freimeldung: link for the NU / fitter (only on the sent version). */
  freimeldeUrl?: string | null;
  positions: {
    pos: number;
    number: number;
    description: string;
    location: string;
    gewerk: string;
    dueDate: string | null;
    plan: { file: string; name: string; index: string; page: number; x: number; y: number } | null;
    /** Photo of the Mangel (first "mangel" photo), JPEG or PNG bytes. */
    photo?: { bytes: Uint8Array; takenAt: string } | null;
  }[];
}

type Block = AnzeigePdfData['positions'][number] & { status?: string; company?: string | null; created?: string; group?: string | null };

interface BlockCtx {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  planDir: string;
  planCache: Map<string, PDFDocument>;
  page: PDFPage;
  y: number;
}

const IMG_W = (A4_W() - 2 * 56 - 14) / 2; // two images side by side
const IMG_H = IMG_W * 0.75;
function A4_W() {
  return 595.28;
}

/**
 * One Mangel: header line, description, Ort/Gewerk/Plan, then the photo (left) and the plan crop with
 * the pin marked (right). So the PDF shows not only "Bad" but exactly where in the Bad.
 */
async function drawMangelBlock(c: BlockCtx, p: Block, label: string) {
  const { doc, font, bold } = c;
  const width = A4[0] - 2 * M;
  const descLines = wrap(p.description, bold, 11, width).slice(0, 4);
  const need = 18 + descLines.length * 15 + 4 * 13 + 10 + IMG_H + 22;
  if (c.y - need < M + 30) {
    c.page = doc.addPage(A4);
    c.y = A4[1] - M;
  }
  const text = (s: string, x: number, yy: number, size = 10, f = font, color = INK) => c.page.drawText(safe(s), { x, y: yy, size, font: f, color });
  c.page.drawLine({ start: { x: M, y: c.y + 6 }, end: { x: A4[0] - M, y: c.y + 6 }, thickness: 0.6, color: LINE });
  c.y -= 12;
  text(label, M, c.y, 12, bold);
  text(`M-${String(p.number).padStart(3, '0')}`, M + font.widthOfTextAtSize(label, 12) + 14, c.y, 12, font, GREY);
  if (p.status) text(p.status, A4[0] - M - bold.widthOfTextAtSize(p.status, 9.5), c.y + 1, 9.5, bold, GREY);
  c.y -= 18;
  for (const l of descLines) {
    text(l, M, c.y, 11, bold);
    c.y -= 15;
  }
  c.y -= 2;
  const meta: [string, string][] = [
    ['Ort', p.location],
    ['Gewerk', p.company ? `${p.gewerk} · ${p.company}` : p.gewerk],
    ['Plan', p.plan ? `${p.plan.name}, Index ${p.plan.index}` : '–'],
    ...(p.created ? ([['Erfasst', formatDate(p.created)]] as [string, string][]) : []),
  ];
  for (const [k, v] of meta) {
    text(k, M, c.y, 9.5, font, GREY);
    text(v, M + 52, c.y, 9.5);
    c.y -= 13;
  }
  c.y -= 6;

  const by = c.y - IMG_H;
  const lx = M;
  const rx = M + IMG_W + 14;
  // Photo
  c.page.drawRectangle({ x: lx, y: by, width: IMG_W, height: IMG_H, borderColor: LINE, borderWidth: 0.8, color: rgb(0.97, 0.97, 0.98) });
  if (p.photo) {
    try {
      const b = p.photo.bytes;
      const img = b[0] === 0x89 && b[1] === 0x50 ? await doc.embedPng(new Uint8Array(b)) : await doc.embedJpg(new Uint8Array(b));
      const sc = Math.min(IMG_W / img.width, IMG_H / img.height);
      const w = img.width * sc;
      const h = img.height * sc;
      c.page.drawImage(img, { x: lx + (IMG_W - w) / 2, y: by + (IMG_H - h) / 2, width: w, height: h });
      const cap = `Foto ${formatDate(p.photo.takenAt)}`;
      c.page.drawRectangle({ x: lx, y: by, width: font.widthOfTextAtSize(cap, 8) + 10, height: 14, color: rgb(0, 0, 0), opacity: 0.55 });
      c.page.drawText(cap, { x: lx + 5, y: by + 4, size: 8, font, color: rgb(1, 1, 1) });
    } catch {
      text('Foto nicht lesbar', lx + 12, by + IMG_H / 2, 9, font, GREY);
    }
  } else {
    text('Kein Foto', lx + IMG_W / 2 - 20, by + IMG_H / 2, 9, font, GREY);
  }
  // Plan crop around the pin (vector, stays sharp)
  c.page.drawRectangle({ x: rx, y: by, width: IMG_W, height: IMG_H, borderColor: LINE, borderWidth: 0.8 });
  if (p.plan) {
    try {
      let src = c.planCache.get(p.plan.file);
      if (!src) {
        src = await PDFDocument.load(await readFile(c.planDir + p.plan.file.replace(/[^a-z0-9._-]/gi, '')));
        c.planCache.set(p.plan.file, src);
      }
      const sp = src.getPage(p.plan.page - 1);
      const { width: W, height: H } = sp.getSize();
      const cw = Math.min(W, W * 0.35);
      const ch = Math.min(H, (cw * IMG_H) / IMG_W);
      const px = p.plan.x * W;
      const py = (1 - p.plan.y) * H;
      const left = Math.max(0, Math.min(W - cw, px - cw / 2));
      const bottom = Math.max(0, Math.min(H - ch, py - ch / 2));
      const embedded = await doc.embedPage(sp, { left, bottom, right: left + cw, top: bottom + ch });
      const scale = IMG_W / cw;
      c.page.drawPage(embedded, { x: rx, y: by, width: IMG_W, height: ch * scale });
      const mx = rx + (px - left) * scale;
      const my = by + (py - bottom) * scale;
      c.page.drawCircle({ x: mx, y: my, size: 10, borderColor: RED, borderWidth: 2.4 });
      c.page.drawCircle({ x: mx, y: my, size: 2.8, color: RED });
      const cap = 'Planausschnitt';
      c.page.drawRectangle({ x: rx, y: by, width: font.widthOfTextAtSize(cap, 8) + 10, height: 14, color: rgb(0, 0, 0), opacity: 0.55 });
      c.page.drawText(cap, { x: rx + 5, y: by + 4, size: 8, font, color: rgb(1, 1, 1) });
    } catch {
      text('Plan nicht verfügbar', rx + 12, by + IMG_H / 2, 9, font, GREY);
    }
  } else {
    text('Kein Plan-Pin', rx + IMG_W / 2 - 25, by + IMG_H / 2, 9, font, GREY);
  }
  c.y = by - 22;
}

export interface BerichtData {
  title: string;
  subtitle: string;
  ownCompany: string;
  /** Sorting/folders as chosen in the list, printed under the title. */
  ordering?: string;
  items: Block[];
}

/** Mängelbericht: one or more Mängel, each with photo and plan crop (no letter, no deadline request). */
export async function renderMaengelbericht(d: BerichtData, planDir: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.title} – ${d.subtitle}`);
  doc.setCreator('Bau Akte Pro');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  let y = A4[1] - M;
  page.drawText(safe(d.ownCompany), { x: M, y, size: 9.5, font, color: GREY });
  const dateStr = formatDate(new Date().toISOString());
  page.drawText(dateStr, { x: A4[0] - M - font.widthOfTextAtSize(dateStr, 9.5), y, size: 9.5, font, color: GREY });
  y -= 26;
  page.drawText(safe(d.title), { x: M, y, size: 18, font: bold, color: INK });
  y -= 17;
  page.drawText(safe(d.subtitle), { x: M, y, size: 10.5, font, color: GREY });
  y -= 18;
  if (d.ordering) {
    page.drawText(safe(d.ordering), { x: M, y, size: 9, font, color: GREY });
    y -= 14;
  }
  y -= 8;
  const ctx: BlockCtx = { doc, font, bold, planDir, planCache: new Map(), page, y };
  // Overview first (several Mängel): one line each, with the same folders as in the list.
  if (d.items.length > 1) drawOverview(ctx, d.items);
  let group: string | null | undefined;
  for (const it of d.items) {
    if (it.group && it.group !== group) drawGroupHeader(ctx, it.group, d.items.filter((x) => x.group === it.group).length);
    group = it.group;
    await drawMangelBlock(ctx, it, `Mangel`);
  }
  const pages = doc.getPages();
  pages.forEach((pg, i) =>
    pg.drawText(safe(`${d.title} · ${d.subtitle} · Seite ${i + 1} von ${pages.length}`), { x: M, y: 30, size: 8.5, font, color: GREY }),
  );
  return doc.save();
}

/** Folder heading in the report ("Elektro Blitz GmbH › November 2026"). */
function drawGroupHeader(c: BlockCtx, label: string, count: number) {
  if (c.y < M + 30 + 60 + IMG_H) {
    c.page = c.doc.addPage(A4);
    c.y = A4[1] - M;
  }
  c.page.drawRectangle({ x: M, y: c.y - 6, width: A4[0] - 2 * M, height: 22, color: rgb(0.94, 0.95, 0.97) });
  c.page.drawText(safe(label), { x: M + 8, y: c.y, size: 11.5, font: c.bold, color: INK });
  const n = `${count} ${count === 1 ? 'Mangel' : 'Mängel'}`;
  c.page.drawText(n, { x: A4[0] - M - 8 - c.font.widthOfTextAtSize(n, 9), y: c.y + 1, size: 9, font: c.font, color: GREY });
  c.y -= 30;
}

/** Overview table: Nr. | Mangel | Firma | Ort | Erfasst | Status, grouped like the list. */
function drawOverview(c: BlockCtx, items: Block[]) {
  const cols = [
    { t: 'Nr.', w: 42 },
    { t: 'Mangel', w: 170 },
    { t: 'Firma', w: 95 },
    { t: 'Ort', w: 60 },
    { t: 'Erfasst', w: 52 },
    { t: 'Status', w: 64 },
  ];
  const head = () => {
    let x = M;
    for (const col of cols) {
      c.page.drawText(col.t, { x, y: c.y, size: 8, font: c.bold, color: GREY });
      x += col.w;
    }
    c.y -= 5;
    c.page.drawLine({ start: { x: M, y: c.y }, end: { x: A4[0] - M, y: c.y }, thickness: 0.6, color: LINE });
    c.y -= 11;
  };
  const fit = (s: string, w: number, f: PDFFont, size: number) => {
    let t = safe(s);
    while (t.length > 1 && f.widthOfTextAtSize(t, size) > w - 6) t = t.slice(0, -2) + '…';
    return t;
  };
  c.page.drawText('Übersicht', { x: M, y: c.y, size: 12, font: c.bold, color: INK });
  c.y -= 18;
  head();
  let group: string | null | undefined;
  for (const it of items) {
    if (c.y < M + 40) {
      c.page = c.doc.addPage(A4);
      c.y = A4[1] - M;
      head();
    }
    if (it.group && it.group !== group) {
      c.y -= 3;
      c.page.drawText(fit(it.group, A4[0] - 2 * M, c.bold, 9), { x: M, y: c.y, size: 9, font: c.bold, color: INK });
      c.y -= 13;
      group = it.group;
    }
    const cells = [
      `M-${String(it.number).padStart(3, '0')}`,
      it.description,
      it.company ?? '–',
      it.location,
      it.created ? formatDate(it.created) : '–',
      it.status ?? '',
    ];
    let x = M;
    cells.forEach((v, i) => {
      c.page.drawText(fit(v, cols[i]!.w, c.font, 8.5), { x, y: c.y, size: 8.5, font: c.font, color: i === 0 ? GREY : INK });
      x += cols[i]!.w;
    });
    c.y -= 13;
  }
  // Details start on a new page.
  c.page = c.doc.addPage(A4);
  c.y = A4[1] - M;
}

const A4: [number, number] = [595.28, 841.89];
const M = 56; // margin
const INK = rgb(0.11, 0.11, 0.12);
const GREY = rgb(0.45, 0.45, 0.48);
const LINE = rgb(0.85, 0.85, 0.87);
const RED = rgb(1, 0.23, 0.19);

/** Helvetica only knows WinAnsi; replace anything else so a stray emoji can't break the letter. */
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF–—„“”‚‘’…•€·\n]/g, '?');

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function renderAnzeigePdf(d: AnzeigePdfData, planDir: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Mangelanzeige ${anzeigeNo(d.number)} – ${d.project}`);
  doc.setAuthor(d.ownCompany);
  doc.setCreator('Bau Akte Pro');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = A4[0] - 2 * M;

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const text = (s: string, x: number, yy: number, size = 10, f = font, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const para = (s: string, size = 10.5, f = font, gap = 4) => {
    for (const l of wrap(s, f, size, width)) {
      text(l, M, y, size, f);
      y -= size + gap;
    }
  };

  // Letter head
  text(d.ownCompany, M, y, 16, bold);
  const dateStr = formatDate(d.createdAt.toISOString());
  text(dateStr, A4[0] - M - font.widthOfTextAtSize(dateStr, 10), y + 2, 10, font, GREY);
  y -= 34;
  text(d.recipient.name, M, y, 11, bold);
  y -= 14;
  if (d.recipient.email) text(d.recipient.email, M, y, 10, font, GREY);
  y -= 36;
  text(`Mangelanzeige ${d.draft ? '(Entwurf)' : anzeigeNo(d.number)}`, M, y, 18, bold);
  y -= 18;
  text(`Bauvorhaben: ${d.project}`, M, y, 10.5, font, GREY);
  y -= 26;

  // ANNAHME: neutral wording until the legal text is decided (offene-punkte D1: VOB/B § 13 Abs. 5 or BGB).
  para('Sehr geehrte Damen und Herren,');
  y -= 6;
  para(
    `bei der Prüfung Ihrer Leistungen im oben genannten Bauvorhaben haben wir die nachfolgend aufgeführten Mängel festgestellt. ` +
      `Wir fordern Sie auf, diese Mängel bis spätestens ${formatDate(d.deadline)} vollständig zu beseitigen und uns die Beseitigung schriftlich anzuzeigen.`,
  );
  if (d.note) {
    y -= 6;
    para(d.note);
  }
  y -= 14;
  // QR-Freimeldung: scan on site, report each position as fixed with a photo (no account needed).
  if (d.freimeldeUrl) {
    const qr = QRCode.create(d.freimeldeUrl, { errorCorrectionLevel: 'M' });
    const size = 78;
    const cell = size / qr.modules.size;
    const boxH = size + 16;
    page.drawRectangle({ x: M, y: y - boxH + 8, width, height: boxH, color: rgb(0.95, 0.97, 1), borderColor: rgb(0.8, 0.86, 0.95), borderWidth: 0.6 });
    const x0 = M + 8;
    const y0 = y - size;
    for (let row = 0; row < qr.modules.size; row++) {
      for (let col = 0; col < qr.modules.size; col++) {
        if (qr.modules.get(row, col)) page.drawRectangle({ x: x0 + col * cell, y: y0 + size - (row + 1) * cell, width: cell, height: cell, color: rgb(0, 0, 0) });
      }
    }
    const tx0 = x0 + size + 14;
    text('Mängel digital freimelden', tx0, y - 14, 11.5, bold);
    for (const [i, l] of wrap('QR-Code mit dem Handy scannen, je Position „behoben“ melden und ein Foto als Nachweis aufnehmen – ohne Anmeldung. Die Bauleitung prüft danach.', font, 9.5, width - size - 30).entries()) {
      text(l, tx0, y - 30 - i * 12.5, 9.5);
    }
    text(d.freimeldeUrl, tx0, y0 + 4, 7.5, font, GREY);
    y -= boxH + 12;
  }

  // Positions: description, location, then photo and plan crop side by side.
  const ctx: BlockCtx = { doc, font, bold, planDir, planCache: new Map(), page, y };
  for (const p of d.positions) await drawMangelBlock(ctx, p, `Pos. ${p.pos}`);
  page = ctx.page;
  y = ctx.y;

  // Closing
  if (y < M + 90) {
    page = doc.addPage(A4);
    y = A4[1] - M;
  }
  y -= 8;
  para('Mit freundlichen Grüßen');
  y -= 22;
  para(d.signer, 10.5, bold);
  para(`Bauleitung, ${d.ownCompany}`, 10, font);

  // Footer and draft watermark on every page
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    const f = `${d.draft ? 'Entwurf' : anzeigeNo(d.number)} · ${d.project} · Seite ${i + 1} von ${pages.length}`;
    pg.drawText(safe(f), { x: M, y: 30, size: 8.5, font, color: GREY });
    // Drawn last, so it must stay faint enough not to hide the text underneath.
    if (d.draft) pg.drawText('ENTWURF', { x: 130, y: 300, size: 110, font: bold, color: rgb(1, 0.23, 0.19), rotate: degrees(35), opacity: 0.12 });
  });
  return doc.save();
}
