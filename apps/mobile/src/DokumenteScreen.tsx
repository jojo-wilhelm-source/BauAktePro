/** Dateiablage on the phone (docs/fachkonzept/03, 05): released documents by folder, readable offline. */
import { useMemo, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import Pdf from 'react-native-pdf';
import { useQuery } from '@powersync/react';
import { formatDate } from '@bap/domain';
import { docFile, useOfflineState } from './offline';
import { C, T } from './theme';
import { Row, SearchField, Section, SheetBar } from './ui';

type Doc = { id: string; name: string; folder_id: string; rev_id: string; version_label: string; file_name: string; mime: string; decided_at: string | null };

export function DokumenteScreen({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { version } = useOfflineState();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Doc | null>(null);
  const { data: folders } = useQuery<{ id: string; name: string; parent_id: string | null; sort: number }>('SELECT id, name, parent_id, sort FROM folder WHERE project_id = ? ORDER BY sort, name', [projectId]);
  const { data: docs } = useQuery<Doc>(
    `SELECT d.id, d.name, d.folder_id, r.id AS rev_id, r.version_label, r.file_name, r.mime, r.decided_at
     FROM document d JOIN document_revision r ON r.id = d.current_revision_id WHERE d.project_id = ? ORDER BY d.name`,
    [projectId],
  );
  // Folder path "Pläne / Architektur" for the section titles.
  const path = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const p = (id: string): string => {
      const f = byId.get(id);
      return !f ? '' : f.parent_id ? `${p(f.parent_id)} / ${f.name}` : f.name;
    };
    return p;
  }, [folders]);
  const shown = docs.filter((d) => !q || `${d.name} ${d.file_name}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(shown.map((d) => d.folder_id))].sort((a, b) => path(a).localeCompare(path(b), 'de'));

  if (open) return <DocViewer doc={open} onClose={() => setOpen(null)} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Dokumente" right="Fertig" onRight={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 16 }}><SearchField value={q} onChange={setQ} /></View>
        {groups.map((fid) => (
          <Section key={fid} title={path(fid)}>
            {shown.filter((d) => d.folder_id === fid).map((d) => {
              const local = docFile({ id: d.rev_id, file_name: d.file_name }).exists;
              return (
                <Row key={`${d.id}-${version}`} icon={d.mime.startsWith('image/') ? 'photo' : 'doc.text'} iconBg="teal" label={d.name}
                  subtitle={`Version ${d.version_label}${d.decided_at ? ` · freigegeben ${formatDate(d.decided_at)}` : ''}${local ? '' : ' · noch nicht geladen'}`}
                  chevron onPress={() => setOpen(d)} />
              );
            })}
          </Section>
        ))}
        {groups.length === 0 && <Text style={[T.subhead, { textAlign: 'center', marginTop: 40 }]}>Keine freigegebenen Dokumente</Text>}
        <Text style={[T.footnote, { marginHorizontal: 16 }]}>Auf dem Gerät liegt nur der gültige, freigegebene Stand. Neue Versionen kommen mit dem nächsten Abgleich.</Text>
      </ScrollView>
    </View>
  );
}

function DocViewer({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  const f = docFile({ id: doc.rev_id, file_name: doc.file_name });
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title={doc.name} left="Zurück" onLeft={onClose} />
      {!f.exists ? (
        <Text style={[T.subhead, { textAlign: 'center', marginTop: 60, marginHorizontal: 32 }]}>Dieses Dokument ist noch nicht auf dem Gerät. Es wird beim nächsten Abgleich geladen.</Text>
      ) : doc.mime === 'application/pdf' ? (
        <Pdf source={{ uri: f.uri }} style={{ flex: 1, backgroundColor: C.bg as unknown as string }} />
      ) : doc.mime.startsWith('image/') ? (
        <Image source={{ uri: f.uri }} style={{ flex: 1 }} resizeMode="contain" />
      ) : (
        <Text style={[T.subhead, { textAlign: 'center', marginTop: 60, marginHorizontal: 32 }]}>{doc.file_name} lässt sich in der App nicht anzeigen. Bitte im Web öffnen.</Text>
      )}
    </View>
  );
}
