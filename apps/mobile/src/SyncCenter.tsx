/** "Offline & Abgleich": what is on the device, what waits for upload, sync now, automatic or manual. */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { usePowerSync, useQuery, useStatus } from '@powersync/react';
import { collectJobs, usage, useOfflineState, type FileKind } from './offline';
import { useSync } from './sync';
import { C, T, TINT } from './theme';
import { Row, Section, Segmented, SheetBar } from './ui';

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`);
const time = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';

function useCount(sql: string) {
  const { data } = useQuery<{ n: number }>(sql);
  return data[0]?.n ?? 0;
}

/** Short text and colour for the header pill. */
export function useSyncLabel() {
  const status = useStatus();
  const { mode, syncing } = useSync();
  const files = useOfflineState();
  const pending = useCount('SELECT count(*) AS n FROM ps_crud') + useCount('SELECT count(*) AS n FROM foto_upload WHERE error IS NULL') + useCount('SELECT count(*) AS n FROM beleg_upload');
  if (syncing) return { tint: 'blue' as const, text: 'Gleicht ab …', pending };
  if (files.running) return { tint: 'blue' as const, text: `Lädt ${files.done}/${files.total}`, pending };
  if (status.connected) return { tint: pending ? ('orange' as const) : ('green' as const), text: pending ? `${pending} ausstehend` : 'Abgeglichen', pending };
  if (mode === 'manuell') return { tint: pending ? ('orange' as const) : ('gray' as const), text: pending ? `${pending} warten` : 'Manuell', pending };
  return { tint: 'red' as const, text: pending ? `Offline · ${pending} warten` : 'Offline', pending };
}

export function SyncCenter({ onClose }: { onClose: () => void }) {
  const db = usePowerSync();
  const status = useStatus();
  const { mode, setMode, syncNow, syncing, lastError } = useSync();
  const files = useOfflineState();
  const [use, setUse] = useState<ReturnType<typeof usage> | null>(null);
  useEffect(() => {
    void collectJobs(db).then((j) => setUse(usage(j)));
  }, [db, files.version, status.lastSyncedAt]);

  const changes = useCount('SELECT count(*) AS n FROM ps_crud');
  const fotosWait = useCount('SELECT count(*) AS n FROM foto_upload WHERE error IS NULL');
  const fotosErr = useCount('SELECT count(*) AS n FROM foto_upload WHERE error IS NOT NULL');
  const belege = useCount('SELECT count(*) AS n FROM beleg_upload');
  const projekte = useCount('SELECT count(*) AS n FROM project');
  const maengel = useCount('SELECT count(*) AS n FROM mangel');
  const besprechungen = useCount('SELECT count(*) AS n FROM besprechung');
  const punkte = useCount('SELECT count(*) AS n FROM besprechung_punkt');
  const einkaeufe = useCount('SELECT count(*) AS n FROM einkauf');
  const fahrten = useCount('SELECT count(*) AS n FROM fahrt') + useCount('SELECT count(*) AS n FROM tankvorgang');

  const fileRow = (kind: FileKind, label: string, icon: 'map' | 'doc.text' | 'photo', bg: 'indigo' | 'teal' | 'pink') => {
    const u = use?.[kind];
    return <Row icon={icon} iconBg={bg} label={label} value={u ? `${u.have} von ${u.total}${u.bytes ? ` · ${mb(u.bytes)}` : ''}` : '…'} />;
  };
  const totalBytes = use ? use.plaene.bytes + use.dokumente.bytes + use.fotos.bytes : 0;
  const complete = use ? use.plaene.have === use.plaene.total && use.dokumente.have === use.dokumente.total && use.fotos.have === use.fotos.total : false;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Offline & Abgleich" right="Fertig" onRight={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Pressable
          disabled={syncing}
          onPress={() => void syncNow()}
          style={({ pressed }) => ({ backgroundColor: TINT.blue, opacity: syncing ? 0.6 : pressed ? 0.8 : 1, borderRadius: 12, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 10 })}
        >
          {syncing && <ActivityIndicator color="#fff" />}
          <Text style={[T.headline, { color: '#fff' }]}>{syncing ? 'Gleicht ab …' : 'Jetzt abgleichen'}</Text>
        </Pressable>
        <Text style={[T.footnote, { marginHorizontal: 16, marginBottom: 24 }]}>
          {files.running
            ? `Lade ${files.done + 1} von ${files.total}: ${files.current ?? ''}`
            : lastError ?? (complete ? 'Alles ist auf dem Gerät und offline verfügbar.' : 'Fehlende Dateien werden beim nächsten Abgleich geladen.')}
        </Text>

        <Section title="Abgleich" footer={mode === 'auto' ? 'Automatisch: Sobald Netz da ist, werden Änderungen hochgeladen und neue Daten, Pläne und Fotos geladen.' : 'Nur per Klick: Das Gerät bleibt offline, bis du „Jetzt abgleichen“ tippst (spart mobile Daten). Alles Erfasste bleibt bis dahin sicher auf dem Gerät.'}>
          <View style={{ padding: 10 }}>
            <Segmented values={['Automatisch', 'Nur per Klick']} index={mode === 'auto' ? 0 : 1} onChange={(i) => setMode(i === 0 ? 'auto' : 'manuell')} />
          </View>
          <Row icon="antenna.radiowaves.left.and.right" iconBg={status.connected ? 'green' : mode === 'manuell' ? 'gray' : 'red'} label="Verbindung" value={status.connected ? 'Verbunden' : mode === 'manuell' ? 'Getrennt (manuell)' : 'Offline'} />
          <Row icon="clock" iconBg="gray" label="Letzter Abgleich" value={time(status.lastSyncedAt)} />
          <Row icon="arrow.down.circle" iconBg="gray" label="Dateien zuletzt geprüft" value={time(files.lastRun)} />
        </Section>

        <Section title="Wartet auf Upload" footer="Wird automatisch übertragen, sobald eine Verbindung besteht. Der Server prüft jede Änderung; Konflikte erscheinen unter „Hinweise“.">
          <Row icon="tray.and.arrow.up" iconBg={changes ? 'orange' : 'green'} label="Änderungen" value={String(changes)} />
          <Row icon="camera" iconBg={fotosWait ? 'orange' : 'green'} label="Fotos" value={fotosErr ? `${fotosWait} (+${fotosErr} Fehler)` : String(fotosWait)} />
          <Row icon="doc.text.image" iconBg={belege ? 'orange' : 'green'} label="Belege" value={String(belege)} />
        </Section>

        <Section title="Auf dem Gerät" footer={`Belegt ${mb(totalBytes)}. Daten sind verschlüsselt gespeichert. Was du nicht mehr sehen darfst (z. B. ersetzte Pläne), wird beim Abgleich entfernt.`}>
          <Row icon="building.2" iconBg="blue" label="Projekte" value={String(projekte)} />
          <Row icon="exclamationmark.triangle" iconBg="red" label="Mängel" value={String(maengel)} />
          {fileRow('plaene', 'Pläne', 'map', 'indigo')}
          {fileRow('dokumente', 'Dokumente', 'doc.text', 'teal')}
          {fileRow('fotos', 'Fotos', 'photo', 'pink')}
          <Row icon="person.2" iconBg="purple" label="Besprechungen" value={`${besprechungen} · ${punkte} Punkte`} />
          <Row icon="cart" iconBg="orange" label="Einkäufe" value={String(einkaeufe)} />
          <Row icon="car" iconBg="purple" label="Fahrten und Tanken" value={String(fahrten)} />
        </Section>
      </ScrollView>
    </View>
  );
}
