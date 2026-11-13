/** Line icons in the spirit of SF Symbols (docs/fachkonzept/15-design.md). 24×24 grid, stroked. */
const PATHS = {
  mangel: 'M12 3 2.5 20h19L12 3Zm0 6v5m0 3v.01',
  plan: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14',
  hinweis: 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Zm-2 16a2 2 0 0 0 4 0',
  anzeige: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6m-6 4h6',
  ordner: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z',
  besprechung: 'M4 5h12v9H8l-4 3V5Zm16 4v10l-3-2h-7',
  rechnung: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3',
  kosten: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  auto: 'M5 16h14m-15 0v-4l2-5h12l2 5v4M4 16v2h3v-2m10 0v2h3v-2M7 13h.01M17 13h.01',
  einkauf: 'M4 7h16l-1.5 12h-13L4 7Zm4 0a4 4 0 0 1 8 0',
  firmen: 'M4 21V7l6-3v17m0-11h10v11M7 9v.01M7 13v.01M7 17v.01M14 14h2m-2 3h2',
  suche: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  abmelden: 'M15 4h4v16h-4M10 8l-4 4 4 4m-4-4h10',
  haken: 'M5 12l5 5 9-10',
  stift: 'M4 20h4L19 9l-4-4L4 16v4Z',
  kalender: 'M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4',
  kamera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  paket: 'M3 7l9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10',
  portal: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  nachricht: 'M3 6h18v12H3V6Zm0 0 9 7 9-7',
  zugang: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 10v-1a6 6 0 0 1 9.5-4.9M17 14v6m-3-3h6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
