/** Contacts of the firms on site: tap to call (works offline from the synced list; the call needs the phone network). */
import { useMemo, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@powersync/react';
import { C, T } from './theme';
import { Row, SearchField, Section, SheetBar } from './ui';

export function KontakteScreen({ onClose }: { onClose: () => void }) {
  const { data } = useQuery<{ id: string; name: string; funktion: string | null; telefon: string | null; email: string | null; company: string }>(
    'SELECT k.id, k.name, k.funktion, k.telefon, k.email, c.name AS company FROM company_kontakt k LEFT JOIN company c ON c.id = k.company_id WHERE k.aktiv = 1 ORDER BY c.name, k.name',
  );
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const f = data.filter((k) => !q || `${k.name} ${k.company} ${k.funktion ?? ''}`.toLowerCase().includes(q.toLowerCase()));
    return [...new Set(f.map((k) => k.company ?? 'Firma'))].map((c) => [c, f.filter((k) => (k.company ?? 'Firma') === c)] as const);
  }, [data, q]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Kontakte" left="Fertig" onLeft={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 12 }}><SearchField value={q} onChange={setQ} /></View>
        {groups.map(([firma, list]) => (
          <Section key={firma} title={firma}>
            {list.map((k) => (
              <Row key={k.id} label={k.name} subtitle={[k.funktion, k.telefon].filter(Boolean).join(' · ')} icon={k.telefon ? 'phone.fill' : 'person'} iconBg={k.telefon ? 'green' : 'gray'}
                onPress={k.telefon ? () => void Linking.openURL(`tel:${k.telefon!.replace(/[^+0-9]/g, '')}`) : undefined} />
            ))}
          </Section>
        ))}
        {data.length === 0 && <Text style={[T.subhead, { textAlign: 'center', marginTop: 40 }]}>Noch keine Kontakte. Die Nachunternehmer tragen ihre Leute im Portal ein.</Text>}
      </ScrollView>
    </View>
  );
}
