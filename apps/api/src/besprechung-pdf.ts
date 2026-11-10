/**
 * Protocol of a NU-Besprechung (docs/fachkonzept/09): A4 landscape, Punkte grouped by Geschoss/Bauteil
 * ("Allgemein" first), status in colour, "W" = carried over from the previous meeting.
 * The same renderer produces the personal task list of one NU (filtered Punkte, own title).
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { formatDate, punktNo, PUNKT_STATUS_LABELS, type PunktStatus } from '@bap/domain';

export interface ProtokollData {
  title: string; // "NU-Besprechung Nr. 2" or "Aufgabenliste Fliesen Fuchs GmbH"
  subtitle: string; // project · date · place
  ownCompany: string;
  draft: boolean;
  teilnehmer: string[];
  punkte: {
    number: number | null;
    group: string; // Geschoss/Bauteil or "Allgemein"
    gewerk: string | null;
    text: string;
    responsible: string | null;
    support: string[];
    due: string | null;
    status: PunktStatus;
    carried: boolean;
  }[];
  maengel: { number: number; description: string; company: string; due: string | null; label: string }[];
  bemerkung?: string | null;
  nextAt?: string | null; // formatted
  footer: string;
}

const A4L: [number, number] = [841.89, 595.28];
const M = 36;
const INK = rgb(0.11, 0.11, 0.12);
const GREY = rgb(0.45, 0.45, 0.48);
const LINE = rgb(0.86, 0.86, 0.88);
const STATUS_COLOR: Record<PunktStatus, RGB> = {
  offen: rgb(1, 0.23, 0.19),
  in_arbeit: rgb(1, 0.58, 0),
  erledigt: rgb(0.2, 0.7, 0.35),
  info: rgb(0, 0.48, 1),
};
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

// Columns: Nr | Gewerk | Aufgabe | Verantwortlich / Zuarbeit | Frist | Status
const COLS = [
  { key: 'nr', title: 'Nr.', w: 52 },
  { key: 'gewerk', title: 'Gewerk', w: 80 },
  { key: 'text', title: 'Aufgabe', w: 330 },
  { key: 'who', title: 'Verantwortlich / Zuarbeit', w: 170 },
  { key: 'due', title: 'Frist', w: 62 },
  { key: 'status', title: 'Status', w: 76 },
] as const;

export async function renderProtokoll(d: ProtokollData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.title} – ${d.subtitle}`);
  doc.setCreator('Bau Akte Pro');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage(A4L);
  let y = A4L[1] - M;
  const text = (s: string, x: number, yy: number, size = 9, f = font, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });

  const header = () => {
    text(d.ownCompany, M, y, 9, font, GREY);
    y -= 20;
    text(d.draft ? `${d.title} (Entwurf)` : d.title, M, y, 17, bold);
    y -= 16;
    text(d.subtitle, M, y, 10, font, GREY);
    y -= 14;
    if (d.teilnehmer.length) {
      for (const l of wrap(`Teilnehmer: ${d.teilnehmer.join(', ')}`, font, 9, A4L[0] - 2 * M)) {
        text(l, M, y, 9, font, GREY);
        y -= 12;
      }
    }
    y -= 8;
  };
  const tableHead = () => {
    let x = M;
    page.drawRectangle({ x: M, y: y - 4, width: A4L[0] - 2 * M, height: 16, color: rgb(0.95, 0.95, 0.97) });
    for (const c of COLS) {
      text(c.title, x + 4, y, 8, bold, GREY);
      x += c.w;
    }
    y -= 18;
  };
  const newPage = () => {
    page = doc.addPage(A4L);
    y = A4L[1] - M;
    tableHead();
  };

  header();
  tableHead();
  const groups = [...new Set(d.punkte.map((p) => p.group))].sort((a, b) => (a === 'Allgemein' ? -1 : b === 'Allgemein' ? 1 : a.localeCompare(b, 'de')));
  for (const g of groups) {
    if (y < M + 60) newPage();
    text(g, M, y, 10.5, bold);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4L[0] - M, y }, thickness: 0.8, color: INK });
    y -= 12;
    for (const p of d.punkte.filter((x) => x.group === g)) {
      const cells: Record<(typeof COLS)[number]['key'], string[]> = {
        nr: [punktNo(p.number) + (p.carried ? ' W' : '')],
        gewerk: wrap(p.gewerk ?? '–', font, 8.5, COLS[1].w - 8),
        text: wrap(p.text, font, 9, COLS[2].w - 8),
        who: [...wrap(p.responsible ?? '–', bold, 8.5, COLS[3].w - 8), ...(p.support.length ? wrap(`Zuarbeit: ${p.support.join(', ')}`, font, 8, COLS[3].w - 8) : [])],
        due: [p.due ? formatDate(p.due) : '–'],
        status: [PUNKT_STATUS_LABELS[p.status]],
      };
      const lines = Math.max(...Object.values(cells).map((c) => c.length));
      const h = lines * 11 + 6;
      if (y - h < M + 24) newPage();
      let x = M;
      for (const c of COLS) {
        cells[c.key].forEach((l, i) => {
          const yy = y - i * 11;
          if (c.key === 'status') {
            page.drawCircle({ x: x + 8, y: yy + 3, size: 3.2, color: STATUS_COLOR[p.status] });
            text(l, x + 15, yy, 8.5, bold, STATUS_COLOR[p.status]);
          } else text(l, x + 4, yy, c.key === 'text' ? 9 : 8.5, c.key === 'who' && i === 0 ? bold : font, c.key === 'nr' ? GREY : INK);
        });
        x += c.w;
      }
      y -= h;
      page.drawLine({ start: { x: M, y: y + 6 }, end: { x: A4L[0] - M, y: y + 6 }, thickness: 0.4, color: LINE });
    }
    y -= 8;
  }
  if (!d.punkte.length) {
    text('Keine Punkte.', M, y, 9, font, GREY);
    y -= 16;
  }

  if (d.maengel.length) {
    if (y < M + 80) {
      page = doc.addPage(A4L);
      y = A4L[1] - M;
    }
    y -= 6;
    text('Überfällige Mängel', M, y, 10.5, bold);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4L[0] - M, y }, thickness: 0.8, color: INK });
    y -= 12;
    for (const m of d.maengel) {
      if (y < M + 24) {
        page = doc.addPage(A4L);
        y = A4L[1] - M;
      }
      text(`M-${String(m.number).padStart(3, '0')}`, M + 4, y, 8.5, font, GREY);
      text(m.description, M + 56, y, 9);
      text(m.company, M + 462, y, 8.5, bold);
      text(m.label, M + 632, y, 8.5, bold, STATUS_COLOR.offen);
      y -= 14;
    }
  }

  const section = (title: string, lines: string[]) => {
    if (y < M + 40 + lines.length * 12) {
      page = doc.addPage(A4L);
      y = A4L[1] - M;
    }
    y -= 10;
    text(title, M, y, 10.5, bold);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: A4L[0] - M, y }, thickness: 0.8, color: INK });
    y -= 14;
    for (const l of lines) {
      if (y < M + 24) {
        page = doc.addPage(A4L);
        y = A4L[1] - M;
      }
      text(l, M + 4, y, 9);
      y -= 12;
    }
  };
  if (d.bemerkung?.trim()) section('Bemerkungen', wrap(d.bemerkung, font, 9, A4L[0] - 2 * M - 8));
  if (d.nextAt) section('Nächster Termin', [d.nextAt]);

  const legend = 'Status: Offen · In Arbeit · Erledigt · Info   |   W = aus der vorigen Besprechung übernommen';
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(safe(`${d.footer} · Seite ${i + 1} von ${pages.length}`), { x: M, y: 18, size: 7.5, font, color: GREY });
    pg.drawText(safe(legend), { x: A4L[0] - M - font.widthOfTextAtSize(legend, 7.5), y: 18, size: 7.5, font, color: GREY });
  });
  return doc.save();
}
