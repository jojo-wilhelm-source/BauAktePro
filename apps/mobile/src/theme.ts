/**
 * Apple-style theme (docs/fachkonzept/15-design.md). Semantic iOS system colours via PlatformColor,
 * so light and dark mode follow the device automatically.
 */
import { PlatformColor, StyleSheet } from 'react-native';
import type { MangelStatus } from '@bap/domain';

export const C = {
  accent: PlatformColor('systemBlue'),
  red: PlatformColor('systemRed'),
  orange: PlatformColor('systemOrange'),
  green: PlatformColor('systemGreen'),
  gray: PlatformColor('systemGray'),
  bg: PlatformColor('systemGroupedBackground'),
  card: PlatformColor('secondarySystemGroupedBackground'),
  label: PlatformColor('label'),
  label2: PlatformColor('secondaryLabel'),
  label3: PlatformColor('tertiaryLabel'),
  separator: PlatformColor('separator'),
  fill: PlatformColor('tertiarySystemFill'),
};

/** Fixed tints for pills (PlatformColor cannot be made translucent). */
export const TINT = {
  red: '#FF3B30',
  orange: '#FF9500',
  green: '#34C759',
  gray: '#8E8E93',
  blue: '#007AFF',
  indigo: '#5856D6',
  teal: '#30B0C7',
  purple: '#AF52DE',
} as const;
export type Tint = keyof typeof TINT;

export const STATUS_TINT: Record<MangelStatus, Tint> = {
  neu: 'gray',
  zugewiesen: 'blue',
  in_bearbeitung: 'indigo',
  behoben_gemeldet: 'teal',
  nicht_behoben: 'orange',
  strittig: 'purple',
  abgenommen: 'green',
};
export const AMPEL_TINT: Record<'rot' | 'gelb' | 'gruen' | 'grau', Tint> = { rot: 'red', gelb: 'orange', gruen: 'green', grau: 'gray' };

/** iOS text styles (Dynamic Type sizes at the default setting). */
export const T = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37, color: C.label },
  title2: { fontSize: 22, fontWeight: '700', letterSpacing: 0.35, color: C.label },
  headline: { fontSize: 17, fontWeight: '600', letterSpacing: -0.41, color: C.label },
  body: { fontSize: 17, letterSpacing: -0.41, color: C.label },
  callout: { fontSize: 16, letterSpacing: -0.32, color: C.label },
  subhead: { fontSize: 15, letterSpacing: -0.24, color: C.label2 },
  footnote: { fontSize: 13, letterSpacing: -0.08, color: C.label2 },
  caption: { fontSize: 12, color: C.label2 },
  sectionHeader: { fontSize: 13, letterSpacing: -0.08, color: C.label2, textTransform: 'uppercase', marginLeft: 16, marginBottom: 7 },
});
