/**
 * Protocol of a NU-Besprechung in the structure of the user's concept ("NU-Besprechung_Konzept_5", 12.11.2026):
 * header (Nr., Datum, KW, Ort/Format, Protokollführung, Dokumentenstand, nächster Termin, Teilnehmer),
 * Allgemeine Informationen, then the active Punkte by Bereich › Bauteil › Geschoss: first "Allgemeine Punkte",
 * then per firm (with Ansprechpartner). Each Punkt: status, due date (überfällig), task, note, share and check of
 * the own firm, sub-tasks of supporting firms. Done Punkte are not printed (concept). The same renderer produces
 * the personal task list of one NU; in a NU's copy his own Punkte are highlighted.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { formatDate, punktNo, type PunktStatus } from '@bap/domain';

export interface ProtokollPunkt {
  number: number | null;
  /** Bereich › Bauteil › Geschoss, or "Allgemein". */
  group: string;
  gewerk: string | null;
  text: string;
  /** Responsible firm; null = allgemeiner Punkt. */
  responsible: string | null;
  kontakt?: string | null;
  support: string[];
  due: string | null;
  status: PunktStatus;
  carried: boolean;
  ueberfaellig?: boolean;
  notiz?: string | null;
  eigenAnteil?: string | null;
  kontrolle?: string | null;
  teilaufgaben?: { company: string; text: string; status: PunktStatus; due: string | null }[];
  mine?: boolean;
  fotos?: { bytes: Uint8Array; png: boolean }[];
}

export interface ProtokollData {
  title: string;
  subtitle: string;
  ownCompany: string;
  /** Short name of the own firm ("WHB") for "Anteil" and "Kontrolle". */
  ownShort?: string;
  logo?: { bytes: Uint8Array; png: boolean } | null;
  draft: boolean;
  kopf?: [string, string][];
  teilnehmer: string[];
  allgemein?: string[];
  punkte: ProtokollPunkt[];
  maengel: { number: number; description: string; company: string; due: string | null; label: string }[];
  bemerkung?: string | null;
  nextAt?: string | null;
  footer: string;
}

const A4: [number, number] = [595.28, 841.89];
const M = 38;
const W = A4[0] - 2 * M;
const INK = rgb(0.1, 0.1, 0.12);
const GREY = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.82, 0.82, 0.85);
const NAVY = rgb(0.11, 0.2, 0.36);
const STATUS_COLOR: Record<PunktStatus, RGB> = {
  blockiert: rgb(0.86, 0.15, 0.15),
  wichtig: rgb(0.96, 0.5, 0.05),
  in_arbeit: rgb(0.93, 0.76, 0.05),
  erledigt: rgb(0.2, 0.65, 0.3),
  nicht_faellig: rgb(0.7, 0.7, 0.72),
};
const STATUS_TEXT: Record<PunktStatus, string> = { blockiert: 'BLOCKIERT', wichtig: 'WICHTIG', in_arbeit: 'IN ARBEIT', erledigt: 'ERLEDIGT', nicht_faellig: 'NICHT FÄLLIG' };
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

export async function renderProtokoll(d: ProtokollData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${d.title} – ${d.subtitle}`);
  doc.setCreator('Bau Akte Pro');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = d.logo ? await (d.logo.png ? doc.embedPng(new Uint8Array(d.logo.bytes)) : doc.embedJpg(new Uint8Array(d.logo.bytes))).catch(() => null) : null;
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const own = d.ownShort ?? d.ownCompany;
  const text = (s: string, x: number, yy: number, size = 9, f = font, color = INK) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
  };
  const ensure = (need: number) => {
    if (y - need < M + 34) newPage();
  };

  // --- Header bar (logo + title) and Protokollkopf
  page.drawRectangle({ x: M, y: y - 46, width: W, height: 46, color: NAVY });
  let tx = M + 12;
  if (logo) {
    const sc = Math.min(110 / logo.width, 30 / logo.height);
    page.drawRectangle({ x: M + 8, y: y - 40, width: logo.width * sc + 10, height: 34, color: rgb(1, 1, 1) });
    page.drawImage(logo, { x: M + 13, y: y - 23 - (logo.height * sc) / 2, width: logo.width * sc, height: logo.height * sc });
    tx = M + 30 + logo.width * sc;
  }
  page.drawText(safe(d.draft ? `${d.title} (Entwurf)` : d.title), { x: tx, y: y - 21, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safe(d.subtitle), { x: tx, y: y - 36, size: 9, font, color: rgb(0.85, 0.88, 0.95) });
  y -= 60;
  const kopf = d.kopf ?? [];
  const colW = W / 3;
  for (let i = 0; i < kopf.length; i += 3) {
    kopf.slice(i, i + 3).forEach(([k, v], j) => {
      text(k, M + j * colW, y, 7.5, font, GREY);
      text(wrap(v || '–', bold, 9.5, colW - 8)[0] ?? '–', M + j * colW, y - 11, 9.5, bold);
    });
    y -= 26;
  }
  if (d.teilnehmer.length) {
    text('Teilnehmer', M, y, 7.5, font, GREY);
    y -= 11;
    for (const l of wrap(d.teilnehmer.join(', '), font, 9, W)) {
      text(l, M, y, 9);
      y -= 11;
    }
  }
  y -= 6;

  const sectionTitle = (t: string) => {
    ensure(40);
    y -= 6;
    text(t, M, y, 12, bold, NAVY);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1, color: NAVY });
    y -= 14;
  };

  // --- Allgemeine Informationen
  const allg = (d.allgemein ?? []).filter((x) => x.trim());
  if (allg.length) {
    sectionTitle('Allgemeine Informationen');
    for (const a of allg) {
      const lines = wrap(a, font, 9.5, W - 14);
      ensure(lines.length * 12);
      text('•', M + 2, y, 9.5);
      lines.forEach((l, i) => text(l, M + 12, y - i * 12, 9.5));
      y -= lines.length * 12 + 3;
    }
  }

  // --- Punkte: Bereich › Bauteil › Geschoss, then Allgemeine Punkte, then per firm
  sectionTitle('Aktive Punkte');
  const groups = [...new Set(d.punkte.map((p) => p.group))];
  if (!d.punkte.length) {
    text('Keine aktiven Punkte.', M, y, 9.5, font, GREY);
    y -= 14;
  }
  for (const g of groups) {
    ensure(60);
    page.drawRectangle({ x: M, y: y - 5, width: W, height: 17, color: rgb(0.88, 0.9, 0.94) });
    text(g, M + 6, y, 10, bold, NAVY);
    y -= 22;
    const inGroup = d.punkte.filter((p) => p.group === g);
    const firms: [string, ProtokollPunkt[]][] = [];
    const allgemein = inGroup.filter((p) => !p.responsible);
    if (allgemein.length) firms.push(['Allgemeine Punkte', allgemein]);
    for (const f of [...new Set(inGroup.filter((p) => p.responsible).map((p) => p.responsible!))].sort((a, b) => a.localeCompare(b, 'de'))) {
      const list = inGroup.filter((p) => p.responsible === f);
      firms.push([`${f}${list[0]?.kontakt ? ` | ${list[0].kontakt}` : ''}`, list]);
    }
    for (const [firm, list] of firms) {
      ensure(40);
      text(firm, M + 2, y, 9.5, bold);
      y -= 4;
      page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: LINE });
      y -= 12;
      for (const p of list) {
        // Lines of this Punkt (measured first, so it is not split over pages).
        const body: { t: string; f: PDFFont; c: RGB; size: number; indent: number }[] = [];
        wrap(p.text, bold, 9.5, W - 170).forEach((l) => body.push({ t: l, f: bold, c: INK, size: 9.5, indent: 0 }));
        if (p.notiz) wrap(`Notiz: ${p.notiz}`, font, 8.5, W - 170).forEach((l) => body.push({ t: l, f: font, c: GREY, size: 8.5, indent: 0 }));
        if (p.eigenAnteil) wrap(`${own}-Anteil: ${p.eigenAnteil}`, font, 8.5, W - 170).forEach((l) => body.push({ t: l, f: font, c: NAVY, size: 8.5, indent: 0 }));
        if (p.kontrolle) wrap(`${own}-Kontrolle / Freigabe: ${p.kontrolle}`, font, 8.5, W - 170).forEach((l) => body.push({ t: l, f: font, c: NAVY, size: 8.5, indent: 0 }));
        for (const t of p.teilaufgaben ?? []) {
          wrap(`Anteil ${t.company} [${STATUS_TEXT[t.status]}]: ${t.text}${t.due ? ` (fällig ${formatDate(t.due)})` : ''}`, font, 8.5, W - 182)
            .forEach((l) => body.push({ t: l, f: font, c: INK, size: 8.5, indent: 12 }));
        }
        const fotoH = p.fotos?.length ? 58 : 0;
        const h = Math.max(body.length, 2) * 11.5 + 8 + fotoH;
        ensure(h + 4);
        if (p.mine) page.drawRectangle({ x: M - 3, y: y - h + 9, width: W + 6, height: h + 2, color: rgb(1, 0.95, 0.72) });
        page.drawRectangle({ x: M + 2, y: y - 1, width: 8, height: 8, color: STATUS_COLOR[p.status] });
        text(STATUS_TEXT[p.status], M + 14, y, 7.5, bold, p.status === 'in_arbeit' ? rgb(0.6, 0.48, 0) : STATUS_COLOR[p.status]);
        text(`${punktNo(p.number)}${p.carried ? ' W' : ''}${p.gewerk ? ` · ${p.gewerk}` : ''}`, M + 14, y - 10, 7, font, GREY);
        body.forEach((b, i) => text(b.t, M + 96 + b.indent, y - i * 11.5, b.size, b.f, b.c));
        const due = p.due ? `fällig ${formatDate(p.due)}` : 'ohne Termin';
        text(due, M + W - font.widthOfTextAtSize(due, 8), y, 8, p.ueberfaellig ? bold : font, p.ueberfaellig ? STATUS_COLOR.blockiert : GREY);
        if (p.ueberfaellig) text('ÜBERFÄLLIG', M + W - bold.widthOfTextAtSize('ÜBERFÄLLIG', 7), y - 10, 7, bold, STATUS_COLOR.blockiert);
        if (p.fotos?.length) {
          let fx = M + 96;
          const fy = y - body.length * 11.5 - 50;
          for (const f of p.fotos.slice(0, 5)) {
            try {
              const img = f.png ? await doc.embedPng(new Uint8Array(f.bytes)) : await doc.embedJpg(new Uint8Array(f.bytes));
              const sc = Math.min(70 / img.width, 48 / img.height);
              page.drawImage(img, { x: fx, y: fy, width: img.width * sc, height: img.height * sc });
              fx += img.width * sc + 6;
            } catch { /* unreadable image */ }
          }
        }
        y -= h;
        page.drawLine({ start: { x: M + 96, y: y + 4 }, end: { x: M + W, y: y + 4 }, thickness: 0.3, color: LINE });
      }
      y -= 6;
    }
  }

  // --- Überfällige Mängel, Bemerkungen
  if (d.maengel.length) {
    sectionTitle('Überfällige Mängel der Teilnehmer');
    for (const m of d.maengel) {
      ensure(14);
      text(`M-${String(m.number).padStart(3, '0')}`, M + 2, y, 8.5, font, GREY);
      text(wrap(m.description, font, 9, 260)[0]!, M + 52, y, 9);
      text(wrap(m.company, bold, 8.5, 105)[0]!, M + 320, y, 8.5, bold);
      text(m.label, M + 430, y, 8, bold, STATUS_COLOR.blockiert);
      y -= 13;
    }
  }
  if (d.bemerkung?.trim()) {
    sectionTitle('Bemerkungen');
    for (const l of wrap(d.bemerkung, font, 9.5, W)) {
      ensure(12);
      text(l, M, y, 9.5);
      y -= 12;
    }
  }

  const legend = 'BLOCKIERT · WICHTIG · IN ARBEIT · NICHT FÄLLIG   |   W = aus der vorigen Besprechung übernommen';
  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    pg.drawText(safe(`${d.footer} · Seite ${i + 1} von ${pages.length}`), { x: M, y: 18, size: 7, font, color: GREY });
    pg.drawText(safe(legend), { x: M, y: 28, size: 7, font, color: GREY });
  });
  return doc.save();
}
