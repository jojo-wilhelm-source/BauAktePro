/** iOS-style building blocks: inset grouped lists, rows, pills, sheet navigation bar. */
import { Children, Fragment, type ComponentType, type ReactNode } from 'react';
import RNSegmentedControl from '@react-native-segmented-control/segmented-control';
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { C, T, TINT, type Tint } from './theme';

export function Section({ title, footer, children, style }: { title?: string; footer?: string; children: ReactNode; style?: ViewStyle }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ marginBottom: 28 }, style]}>
      {title && <Text style={T.sectionHeader}>{title}</Text>}
      <View style={s.group}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={s.separator} />}
            {child}
          </Fragment>
        ))}
      </View>
      {footer && <Text style={[T.footnote, { marginHorizontal: 16, marginTop: 7 }]}>{footer}</Text>}
    </View>
  );
}

export function Row(props: {
  label: ReactNode;
  value?: ReactNode;
  icon?: SFSymbol;
  iconBg?: Tint;
  onPress?: () => void;
  chevron?: boolean;
  checked?: boolean;
  tone?: 'accent' | 'destructive';
  subtitle?: string;
}) {
  const { label, value, icon, iconBg, onPress, chevron, checked, tone, subtitle } = props;
  const color = tone === 'destructive' ? C.red : tone === 'accent' ? C.accent : C.label;
  const content = (
    <View style={s.row}>
      {icon && (
        <View style={[s.iconBox, { backgroundColor: TINT[iconBg ?? 'blue'] }]}>
          <SymbolView name={icon} size={17} tintColor="#fff" />
        </View>
      )}
      {/* With a value: the label keeps its width (no broken words), the value wraps instead. */}
      <View style={value != null ? { flexShrink: 0, maxWidth: '60%' } : { flex: 1 }}>
        {typeof label === 'string' ? <Text style={[T.body, { color }]}>{label}</Text> : label}
        {subtitle && <Text style={[T.footnote, { marginTop: 2 }]}>{subtitle}</Text>}
      </View>
      {typeof value === 'string' || typeof value === 'number' ? <Text style={[T.body, { color: C.label2, flex: 1, textAlign: 'right' }]}>{value}</Text> : value != null ? <View style={{ flex: 1, alignItems: 'flex-end' }}>{value}</View> : null}
      {checked && <SymbolView name="checkmark" size={17} weight="semibold" tintColor={C.accent} />}
      {chevron && <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.label3} />}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: C.fill }}>
      {content}
    </Pressable>
  );
}

export function Pill({ tint, children, dot }: { tint: Tint; children: ReactNode; dot?: boolean }) {
  const hex = TINT[tint];
  return (
    <View style={[s.pill, { backgroundColor: `${hex}24` }]}>
      {dot && <View style={[s.dot, { backgroundColor: hex }]} />}
      <Text style={[s.pillText, { color: hex }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

/** Navigation bar of a page sheet: Cancel · Title · Done. */
export function SheetBar({ title, left, right, rightDisabled, onLeft, onRight }: { title: string; left?: string; right?: string; rightDisabled?: boolean; onLeft?: () => void; onRight?: () => void }) {
  return (
    <View style={s.sheetBar}>
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        {left && (
          <Pressable hitSlop={12} onPress={onLeft}>
            <Text style={[T.body, { color: C.accent }]}>{left}</Text>
          </Pressable>
        )}
      </View>
      <Text style={T.headline}>{title}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        {right && (
          <Pressable hitSlop={12} onPress={onRight} disabled={rightDisabled}>
            <Text style={[T.headline, { color: C.accent, opacity: rightDisabled ? 0.35 : 1 }]}>{right}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.search}>
      <SymbolView name="magnifyingglass" size={15} tintColor={C.label2} />
      <TextInput style={[T.body, { flex: 1, paddingVertical: 7 }]} placeholder="Suchen" placeholderTextColor={C.label2 as unknown as string} value={value} onChangeText={onChange} clearButtonMode="while-editing" />
    </View>
  );
}

// The package ships class typings that do not match current @types/react; the component itself is fine.
const NativeSegmented = RNSegmentedControl as unknown as ComponentType<{
  values: string[];
  selectedIndex: number;
  onChange: (e: { nativeEvent: { selectedSegmentIndex: number } }) => void;
}>;

/** Native UISegmentedControl. */
export function Segmented({ values, index, onChange }: { values: string[]; index: number; onChange: (i: number) => void }) {
  return <NativeSegmented values={values} selectedIndex={index} onChange={(e) => onChange(e.nativeEvent.selectedSegmentIndex)} />;
}

export const s = StyleSheet.create({
  group: { backgroundColor: C.card, borderRadius: 12, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: C.separator, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 44 },
  iconBox: { width: 29, height: 29, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  sheetBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.separator, backgroundColor: C.bg },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.fill, borderRadius: 10, paddingHorizontal: 8 },
});
