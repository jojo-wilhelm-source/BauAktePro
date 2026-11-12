/** Bautagebuch (docs/fachkonzept/07): Tagesbericht and finger signature, shared by API, web and app. */
import { z } from 'zod';

/** Finger signature as strokes; coordinates 0..1 relative to the pad. At least a few points, size-limited. */
export const Signature = z.object({
  w: z.number().positive().max(4000),
  h: z.number().positive().max(4000),
  strokes: z.array(z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(2000)).min(1).max(60),
});
export type Signature = z.infer<typeof Signature>;
export const signatureLength = (s: Signature) =>
  s.strokes.reduce((sum, st) => sum + st.slice(1).reduce((l, p, i) => l + Math.hypot((p[0] - st[i]![0]) * s.w, (p[1] - st[i]![1]) * s.h), 0), 0);
/** A real signature, not a dot: total stroke length in pad pixels. */
export const isPlausibleSignature = (s: Signature) => signatureLength(s) >= 40;

const text = (max = 4000) => z.string().trim().max(max).nullish();
export const TagesberichtInput = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  datum: z.string().date(),
  bereich: text(200),
  wetter: z.object({ text: text(200), temp_min: z.number().min(-40).max(50).nullish(), temp_max: z.number().min(-40).max(55).nullish(), niederschlag: text(80), wind: text(80) }).default({}),
  personal: z.array(z.object({ firma: z.string().trim().min(1).max(160), company_id: z.string().uuid().nullish(), anzahl: z.coerce.number().int().min(0).max(999), taetigkeit: text(300) })).max(60).default([]),
  geraete: z.array(z.object({ name: z.string().trim().min(1).max(160), anzahl: z.coerce.number().int().min(0).max(999) })).max(60).default([]),
  leistungen: z.array(z.object({ text: z.string().trim().min(1).max(1000), ort: text(160), gewerk: text(160) })).max(100).default([]),
  lieferungen: text(),
  behinderungen: text(),
  besonderheiten: text(),
  /** Version the edit is based on (offline): a stale edit never overwrites silently. */
  version: z.coerce.number().int().optional(),
});
export type TagesberichtInput = z.infer<typeof TagesberichtInput>;

export const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const;
export const wochentag = (isoDate: string) => WOCHENTAGE[new Date(`${isoDate}T12:00:00Z`).getUTCDay()]!;

/** ISO calendar week (KW) and its year for a date "YYYY-MM-DD" (Monday-based, as in Germany). */
export function kalenderwoche(isoDate: string): { jahr: number; kw: number } {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week decides the year
  const jahr = d.getUTCFullYear();
  const firstThu = new Date(Date.UTC(jahr, 0, 4));
  const kw = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return { jahr, kw };
}

/** Sections of a Tagesbericht that can be released to the Bauherr. */
export const TB_ABSCHNITTE = ['wetter', 'personal', 'geraete', 'leistungen', 'lieferungen', 'behinderungen', 'besonderheiten'] as const;
export type TbAbschnitt = (typeof TB_ABSCHNITTE)[number];
export const TB_ABSCHNITT_LABELS: Record<TbAbschnitt, string> = {
  wetter: 'Wetter', personal: 'Personal', geraete: 'Geräte', leistungen: 'Ausgeführte Leistungen', lieferungen: 'Lieferungen',
  behinderungen: 'Behinderungen', besonderheiten: 'Besonderheiten',
};
