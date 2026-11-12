/**
 * Room QR labels (decided 12.11.2026): sheet of labels, by default 16 per A4 page (2 × 8), QR on the left,
 * room name, floor and room number on the right. Everything adjustable per project (also for sticker sheets).
 */
import { z } from 'zod';

export const ETIKETT_ZEILEN = { raum: 'Raumname', nummer: 'Raumnummer', geschoss: 'Geschoss', gebaeude: 'Gebäude', projekt: 'Projekt' } as const;
export type EtikettZeile = keyof typeof ETIKETT_ZEILEN;

export const EtikettenFormat = z.object({
  spalten: z.coerce.number().int().min(1).max(6).default(2),
  zeilen: z.coerce.number().int().min(1).max(16).default(8),
  rand_oben_mm: z.coerce.number().min(0).max(50).default(12),
  rand_links_mm: z.coerce.number().min(0).max(50).default(10),
  abstand_x_mm: z.coerce.number().min(0).max(30).default(4),
  abstand_y_mm: z.coerce.number().min(0).max(30).default(2),
  qr_mm: z.coerce.number().min(10).max(80).default(26),
  schrift_pt: z.coerce.number().min(6).max(28).default(11),
  rahmen: z.coerce.boolean().default(true),
  inhalt: z.array(z.enum(['raum', 'nummer', 'geschoss', 'gebaeude', 'projekt'])).min(1).default(['raum', 'geschoss', 'nummer']),
});
export type EtikettenFormat = z.infer<typeof EtikettenFormat>;
export const STANDARD_ETIKETTEN: EtikettenFormat = EtikettenFormat.parse({});

const A4 = { w: 210, h: 297 };
/** Label cells (mm, origin top left) for one A4 page; QR is shrunk to fit if the cell is too small. */
export function etikettenRaster(f: EtikettenFormat) {
  const w = (A4.w - 2 * f.rand_links_mm - (f.spalten - 1) * f.abstand_x_mm) / f.spalten;
  const h = (A4.h - 2 * f.rand_oben_mm - (f.zeilen - 1) * f.abstand_y_mm) / f.zeilen;
  const qr = Math.max(8, Math.min(f.qr_mm, h - 4, w * 0.6));
  const zellen: { x: number; y: number }[] = [];
  for (let r = 0; r < f.zeilen; r++) for (let c = 0; c < f.spalten; c++) zellen.push({ x: f.rand_links_mm + c * (w + f.abstand_x_mm), y: f.rand_oben_mm + r * (h + f.abstand_y_mm) });
  return { breite: w, hoehe: h, qr, proSeite: f.spalten * f.zeilen, zellen, passt: w > 20 && h > 10 };
}

/** The QR content: a web link to the room (the app recognises it; in the browser it opens the room). */
export const raumLink = (webUrl: string, locationId: string) => `${webUrl.replace(/\/$/, '')}/raum/${locationId}`;
/** Room id from a scanned code (link from this app only). */
export function raumAusCode(code: string): string | null {
  const m = code.trim().match(/\/raum\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#].*)?$/i);
  return m ? m[1]!.toLowerCase() : null;
}
