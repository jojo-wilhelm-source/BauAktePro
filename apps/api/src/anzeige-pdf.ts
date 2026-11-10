/**
 * PDF of a Mangelanzeige (docs/fachkonzept/04-maengel.md): letter head, request with deadline, numbered
 * positions, each with a crop of the plan around the pin. The plan crop is embedded as vector
 * (pdf-lib embedPage with a bounding box), so it stays sharp and nothing is rasterised.
 */
import { readFile } from 'node:fs/promises';
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
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
  positions: {
    pos: number;
    number: number;
    description: string;
    location: string;
    gewerk: string;
    dueDate: string | null;
    plan: { file: string; name: string; index: string; page: number; x: number; y: number } | null;
  }[];
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

  // Positions
  const BLOCK = 168;
  const IMG_W = 210;
  const IMG_H = 150;
  const planCache = new Map<string, PDFDocument>();
  for (const p of d.positions) {
    if (y - BLOCK < M + 90) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: A4[0] - M, y: y + 6 }, thickness: 0.6, color: LINE });
    y -= 12;
    const top = y;
    text(`Pos. ${p.pos}`, M, y, 12, bold);
    text(`M-${String(p.number).padStart(3, '0')}`, M + 52, y, 12, font, GREY);
    y -= 18;
    const textWidth = width - IMG_W - 16;
    for (const l of wrap(p.description, bold, 11, textWidth).slice(0, 4)) {
      text(l, M, y, 11, bold);
      y -= 15;
    }
    y -= 4;
    for (const [k, v] of [
      ['Ort', p.location],
      ['Gewerk', p.gewerk],
      ['Plan', p.plan ? `${p.plan.name}, Index ${p.plan.index}` : '–'],
    ] as const) {
      text(k, M, y, 9.5, font, GREY);
      text(v, M + 52, y, 9.5);
      y -= 13;
    }

    // Plan crop around the pin
    const bx = A4[0] - M - IMG_W;
    const by = top - IMG_H + 10;
    page.drawRectangle({ x: bx, y: by, width: IMG_W, height: IMG_H, borderColor: LINE, borderWidth: 0.8 });
    if (p.plan) {
      try {
        let src = planCache.get(p.plan.file);
        if (!src) {
          src = await PDFDocument.load(await readFile(planDir + p.plan.file.replace(/[^a-z0-9._-]/gi, '')));
          planCache.set(p.plan.file, src);
        }
        const sp = src.getPage(p.plan.page - 1);
        const { width: W, height: H } = sp.getSize();
        // Crop: 35 % of the page width, same aspect as the frame, kept inside the page.
        const cw = Math.min(W, W * 0.35);
        const ch = Math.min(H, (cw * IMG_H) / IMG_W);
        const px = p.plan.x * W;
        const py = (1 - p.plan.y) * H;
        const left = Math.max(0, Math.min(W - cw, px - cw / 2));
        const bottom = Math.max(0, Math.min(H - ch, py - ch / 2));
        const embedded = await doc.embedPage(sp, { left, bottom, right: left + cw, top: bottom + ch });
        const scale = IMG_W / cw;
        page.drawPage(embedded, { x: bx, y: by, width: IMG_W, height: ch * scale });
        const mx = bx + (px - left) * scale;
        const my = by + (py - bottom) * scale;
        page.drawCircle({ x: mx, y: my, size: 9, borderColor: RED, borderWidth: 2.2 });
        page.drawCircle({ x: mx, y: my, size: 2.5, color: RED });
      } catch {
        text('Plan nicht verfügbar', bx + 12, by + IMG_H / 2, 9, font, GREY);
      }
    } else {
      text('Kein Plan-Pin', bx + 12, by + IMG_H / 2, 9, font, GREY);
    }
    y = Math.min(y, by) - 18;
  }

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
