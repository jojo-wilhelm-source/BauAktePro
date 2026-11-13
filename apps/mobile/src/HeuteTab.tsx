/**
 * "Heute" – start tab of the Polier in the app (decided 13.11.2026: every role gets its own start page).
 * Computed from the local database only, so it works without network on site.
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useQuery } from '@powersync/react';
import { BANF_LABEL, formatDate, PUNKT_STATUS_LABELS, punktNo, type BanfStatus, type PunktStatus } from '@bap/domain';
import { BautagebuchScreen } from './BautagebuchScreen';
import { BestellungScreen } from './BestellungScreen';
import { C, T, TINT, type Tint } from './theme';
import { Row, Section } from './ui';

const tag = (plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const mNo = (n: number | null) => (n ? `M-${String(n).padStart(3, '0')}` : 'M-neu');

function Zahl({ n, label, tint, onPress }: { n: number; label: string; tint: Tint; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, minWidth: 140, backgroundColor: C.card, borderRadius: 14, padding: 14, opacity: pressed ? 0.7 : 1 })}>
      <Text style={{ fontSize: 30, fontWeight: '700', color: n ? TINT[tint] : C.label3 }}>{n}</Text>
      <Text style={T.footnote}>{label}</Text>
    </Pressable>
  );
}
function Schnell({ icon, label, tint, onPress }: { icon: SFSymbol; label: string; tint: Tint; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flex: 1, minWidth: 150, backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 8, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: TINT[tint], alignItems: 'center', justifyContent: 'center' }}><SymbolView name={icon} size={19} tintColor="#fff" /></View>
      <Text style={T.headline}>{label}</Text>
    </Pressable>
  );
}

export function HeuteTab({ projectId, project, userId, role, header, onMangel, onTab }: {
  projectId: string; project: string; userId: string; role: string; header: React.ReactNode;
  onMangel: (id: string) => void; onTab: (t: 'maengel' | 'plaene' | 'besprechung') => void;
}) {
  const [open, setOpen] = useState<'bericht' | 'bestellung' | null>(null);
  const heute = tag();
  const { data: bericht } = useQuery<{ id: string; status: string }>('SELECT id, status FROM tagesbericht WHERE project_id = ? AND datum = ? LIMIT 1', [projectId, heute]);
  const { data: alt } = useQuery<{ n: number }>("SELECT count(*) AS n FROM tagesbericht WHERE project_id = ? AND status = 'entwurf' AND datum < ?", [projectId, heute]);
  const { data: maengel } = useQuery<{ id: string; number: number | null; description: string; status: string; due: string | null; ort: string | null }>(
    `SELECT m.id, m.number, m.description, m.status, coalesce(m.nachfrist_date, m.due_date) AS due, l.name AS ort FROM mangel m LEFT JOIN location l ON l.id = m.location_id
     WHERE m.project_id = ? AND m.status <> 'abgenommen'`, [projectId]);
  const { data: punkte } = useQuery<{ id: string; number: number | null; text: string; status: PunktStatus; due_date: string; firma: string | null }>(
    `SELECT p.id, p.number, p.text, p.status, p.due_date, c.name AS firma FROM besprechung_punkt p LEFT JOIN company c ON c.id = p.responsible_company_id
     WHERE p.project_id = ? AND p.status NOT IN ('erledigt', 'nicht_faellig') AND p.due_date IS NOT NULL AND p.due_date <= ? ORDER BY p.due_date LIMIT 10`, [projectId, tag(7)]);
  const { data: lieferungen } = useQuery<{ id: string; titel: string; status: BanfStatus; lieferant: string | null; liefertermin: string | null }>(
    `SELECT id, titel, status, lieferant, liefertermin FROM bestellanforderung
     WHERE project_id = ? AND (status = 'bestellt' OR (created_by = ? AND status IN ('offen', 'in_bearbeitung', 'angefragt'))) ORDER BY liefertermin LIMIT 10`, [projectId, userId]);
  const { data: fotos } = useQuery<{ n: number }>('SELECT count(*) AS n FROM foto_doku WHERE project_id = ? AND taken_at >= ?', [projectId, tag(-((new Date().getDay() + 6) % 7))]);

  const pruefen = maengel.filter((m) => m.status === 'behoben_gemeldet');
  const ueberfaellig = maengel.filter((m) => m.status !== 'behoben_gemeldet' && m.due && m.due < heute);
  const b = bericht[0];
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
      {header}
      <View style={{ paddingHorizontal: 16, gap: 16 }}>
        <Text style={T.subhead}>{project} · {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long' })}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Schnell icon="book.closed" tint="blue" label={b ? (b.status === 'unterschrieben' ? 'Tagesbericht ansehen' : 'Tagesbericht weiter') : 'Tagesbericht beginnen'} onPress={() => setOpen('bericht')} />
          <Schnell icon="exclamationmark.triangle" tint="red" label="Mangel / Foto auf Plan" onPress={() => onTab('plaene')} />
          <Schnell icon="shippingbox" tint="orange" label="Material anfordern" onPress={() => setOpen('bestellung')} />
        </View>
        {(!b || (alt[0]?.n ?? 0) > 0) && (
          <View style={{ backgroundColor: `${TINT.orange}22`, borderRadius: 12, padding: 12 }}>
            {!b && <Text style={T.body}>Für heute gibt es noch keinen Tagesbericht.</Text>}
            {(alt[0]?.n ?? 0) > 0 && <Text style={T.body}>{alt[0]!.n} ältere Tagesberichte sind noch nicht unterschrieben.</Text>}
          </View>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Zahl n={pruefen.length} label="zur Abnahme prüfen" tint="orange" onPress={() => onTab('maengel')} />
          <Zahl n={ueberfaellig.length} label="Mängel überfällig" tint="red" onPress={() => onTab('maengel')} />
          <Zahl n={punkte.length} label="Punkte fällig (7 Tage)" tint="orange" onPress={() => onTab('besprechung')} />
          <Zahl n={fotos[0]?.n ?? 0} label="Fotos diese Woche" tint="teal" onPress={() => onTab('plaene')} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
        {pruefen.length > 0 && (
          <Section title="Zur Abnahme prüfen">
            {pruefen.slice(0, 8).map((m) => <Row key={m.id} label={`${mNo(m.number)} ${m.description}`} subtitle={`${m.ort ?? ''} · als behoben gemeldet`} chevron onPress={() => onMangel(m.id)} />)}
          </Section>
        )}
        {ueberfaellig.length > 0 && (
          <Section title="Überfällige Mängel">
            {ueberfaellig.slice(0, 8).map((m) => <Row key={m.id} label={`${mNo(m.number)} ${m.description}`} subtitle={`${m.ort ?? ''} · Frist ${formatDate(m.due!)}`} chevron onPress={() => onMangel(m.id)} />)}
          </Section>
        )}
        <Section title="Fällige Besprechungspunkte">
          {punkte.map((p) => <Row key={p.id} label={`${punktNo(p.number)} ${p.text}`} subtitle={`${p.firma ?? 'Allgemein'} · ${PUNKT_STATUS_LABELS[p.status] ?? p.status}`} value={<Text style={[T.subhead, { color: p.due_date <= heute ? C.red : C.label2 }]}>{formatDate(p.due_date)}</Text>} onPress={() => onTab('besprechung')} />)}
          {!punkte.length && <Text style={[T.subhead, { padding: 16 }]}>Keine Punkte in den nächsten 7 Tagen fällig.</Text>}
        </Section>
        <Section title="Lieferungen & meine Anforderungen">
          {lieferungen.map((l) => <Row key={l.id} label={l.titel} subtitle={l.status === 'bestellt' ? `${l.lieferant ?? 'bestellt'}${l.liefertermin ? ` · Lieferung ${formatDate(l.liefertermin)}` : ''}` : BANF_LABEL[l.status]} onPress={() => setOpen('bestellung')} />)}
          {!lieferungen.length && <Text style={[T.subhead, { padding: 16 }]}>Keine offenen Lieferungen.</Text>}
        </Section>
      </View>
      <Modal visible={open === 'bericht'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        <BautagebuchScreen projectId={projectId} role={role as never} onClose={() => setOpen(null)} />
      </Modal>
      <Modal visible={open === 'bestellung'} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        <BestellungScreen projectId={projectId} userId={userId} onClose={() => setOpen(null)} />
      </Modal>
    </ScrollView>
  );
}
