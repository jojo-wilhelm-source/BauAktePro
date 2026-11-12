/**
 * Bestellanforderung on the phone (docs/fachkonzept/12): Polier and Leitung request material from the site, also
 * without network. The row goes into the local database (device id) and is uploaded via /sync/upload; the Einkauf is
 * notified by the server as soon as it arrives. Status changes (bestellt, geliefert) come back via sync.
 */
import { useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { usePowerSync, useQuery } from '@powersync/react';
import { BANF_LABEL, BANF_TONE, formatDate, type BanfStatus } from '@bap/domain';
import { C, T } from './theme';
import { Pill, Row, Section, Segmented, SheetBar } from './ui';

const input = { ...T.body, paddingHorizontal: 16, paddingVertical: 12 } as const;
const tag = (plus: number) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toISOString().slice(0, 10); };
const WANN: [string, number | null][] = [['Ohne', null], ['Morgen', 1], ['3 Tage', 3], ['1 Woche', 7], ['2 Wochen', 14]];

interface Zeile { id: string; number: number | null; titel: string; positionen: string; benoetigt_am: string | null; dringend: number; status: BanfStatus; lieferant: string | null; liefertermin: string | null; bemerkung_einkauf: string | null }

export function BestellungScreen({ projectId, userId, onClose }: { projectId: string; userId: string; onClose: () => void }) {
  const db = usePowerSync();
  const { data: rows } = useQuery<Zeile>(
    `SELECT id, number, titel, positionen, benoetigt_am, dringend, status, lieferant, liefertermin, bemerkung_einkauf FROM bestellanforderung
     WHERE project_id = ? ORDER BY (status IN ('offen','in_bearbeitung','angefragt','bestellt')) DESC, created_at DESC LIMIT 50`, [projectId]);
  const [neu, setNeu] = useState(false);
  const [titel, setTitel] = useState('');
  const [wann, setWann] = useState(0);
  const [dringend, setDringend] = useState(false);
  const [notiz, setNotiz] = useState('');
  const [pos, setPos] = useState<{ text: string; menge: string; einheit: string }[]>([{ text: '', menge: '', einheit: 'St' }]);

  const save = async () => {
    if (titel.trim().length < 2) return;
    const positionen = pos.filter((p) => p.text.trim()).map((p) => ({ text: p.text.trim(), menge: p.menge.trim() ? Number(p.menge.replace(',', '.')) || null : null, einheit: p.einheit.trim() || null }));
    const plus = WANN[wann]![1];
    await db.execute(
      `INSERT INTO bestellanforderung (id, project_id, titel, beschreibung, positionen, benoetigt_am, dringend, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?)`,
      [Crypto.randomUUID(), projectId, titel.trim(), notiz.trim() || null, JSON.stringify(positionen), plus == null ? null : tag(plus), dringend ? 1 : 0, userId, new Date().toISOString()],
    );
    setNeu(false); setTitel(''); setNotiz(''); setDringend(false); setWann(0); setPos([{ text: '', menge: '', einheit: 'St' }]);
    Alert.alert('Angefordert', 'Der Einkauf wird benachrichtigt, sobald das Gerät Netz hat.');
  };

  if (neu) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <SheetBar title="Anfordern" left="Abbrechen" onLeft={() => setNeu(false)} right="Senden" rightDisabled={titel.trim().length < 2} onRight={() => void save()} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <Section>
            <TextInput style={input} placeholder="Was wird gebraucht? (z. B. Bauzaun)" placeholderTextColor={C.label3 as unknown as string} value={titel} onChangeText={setTitel} autoFocus />
            <Row label="Dringend" value={<Switch value={dringend} onValueChange={setDringend} />} />
          </Section>
          <Section title="Benötigt in">
            <View style={{ padding: 10 }}><Segmented values={WANN.map((w) => w[0])} index={wann} onChange={setWann} /></View>
          </Section>
          <Section title="Positionen" footer="Menge und Einheit helfen dem Einkauf – Text genügt aber auch.">
            {pos.map((p, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput style={[input, { flex: 1 }]} placeholder="Material / Leistung" placeholderTextColor={C.label3 as unknown as string} value={p.text} onChangeText={(v) => setPos(pos.map((x, j) => (j === i ? { ...x, text: v } : x)))} />
                <TextInput style={[input, { width: 70, textAlign: 'right' }]} placeholder="Menge" keyboardType="decimal-pad" placeholderTextColor={C.label3 as unknown as string} value={p.menge} onChangeText={(v) => setPos(pos.map((x, j) => (j === i ? { ...x, menge: v } : x)))} />
                <TextInput style={[input, { width: 56 }]} value={p.einheit} onChangeText={(v) => setPos(pos.map((x, j) => (j === i ? { ...x, einheit: v } : x)))} />
              </View>
            ))}
            <Row icon="plus" iconBg="blue" label="Weitere Position" tone="accent" onPress={() => setPos([...pos, { text: '', menge: '', einheit: 'St' }])} />
          </Section>
          <Section title="Hinweis für den Einkauf">
            <TextInput style={[input, { minHeight: 70 }]} multiline placeholder="Abladestelle, Ansprechpartner …" placeholderTextColor={C.label3 as unknown as string} value={notiz} onChangeText={setNotiz} />
          </Section>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Bestellanforderungen" right="Fertig" onRight={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <Section footer="Geht auch ohne Netz. Sobald bestellt ist, steht hier der Lieferant – und du bekommst eine Mitteilung.">
          <Row icon="shippingbox" iconBg="orange" label="Neue Anforderung" tone="accent" onPress={() => setNeu(true)} />
        </Section>
        <Section title="Anforderungen">
          {rows.map((r) => {
            const n = (() => { try { return (JSON.parse(r.positionen || '[]') as unknown[]).length; } catch { return 0; } })();
            const sub = [r.number ? `Nr. ${r.number}` : 'wartet auf Abgleich', `${n} Pos.`, r.benoetigt_am ? `bis ${formatDate(r.benoetigt_am)}` : null,
              r.status === 'bestellt' && r.lieferant ? `${r.lieferant}${r.liefertermin ? ` · ${formatDate(r.liefertermin)}` : ''}` : null,
              r.status === 'abgelehnt' ? r.bemerkung_einkauf : null].filter(Boolean).join(' · ');
            return <Row key={r.id} label={`${r.dringend ? '❗ ' : ''}${r.titel}`} subtitle={sub} value={<Pill tint={BANF_TONE[r.status] === 'yellow' ? 'orange' : BANF_TONE[r.status]}>{BANF_LABEL[r.status]}</Pill>} />;
          })}
          {!rows.length && <Text style={[T.subhead, { padding: 16 }]}>Noch keine Anforderungen.</Text>}
        </Section>
      </ScrollView>
    </View>
  );
}
