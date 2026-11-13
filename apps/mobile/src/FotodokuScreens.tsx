/**
 * Fotodokumentation in the app (docs/fachkonzept/16): tap a spot on the plan → "Foto dokumentieren" → camera, or a
 * 360° photo from the library (exported by the Insta360 app). Works offline: the entry goes into the local database,
 * the file into the upload queue. 360° photos open in the shared WebGL panorama viewer (WebView, offline).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { usePowerSync, useQuery } from '@powersync/react';
import { FOTODOKU_KATEGORIEN, FOTODOKU_LABEL, ist360, panoHtml, type FotodokuKategorie } from '@bap/domain';
import { API_URL } from './config';
import { localFoto, pickFoto, queueDoku, type Picked } from './fotoStore';
import { C, T } from './theme';
import { Row, Section, SheetBar } from './ui';

const input = { ...T.body, paddingHorizontal: 16, paddingVertical: 12 } as const;

export function FotodokuNew({ projectId, userId, pos, onClose }: { projectId: string; userId: string; pos: { planId: string; x: number; y: number; serieId?: string }; onClose: () => void }) {
  const db = usePowerSync();
  const [kat, setKat] = useState<FotodokuKategorie>('geschlossene_wand');
  const [titel, setTitel] = useState('');
  const [notiz, setNotiz] = useState('');
  const [foto, setFoto] = useState<Picked | null>(null);
  const pano = !!foto && ist360(foto.width, foto.height);
  const save = async () => {
    if (!foto) return;
    const id = Crypto.randomUUID();
    await db.execute(
      `INSERT INTO foto_doku (id, serie_id, project_id, plan_id, pin_page, pin_x, pin_y, kategorie, titel, notiz, ist_360, width, height, taken_at, version, created_by, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, pos.serieId ?? null, projectId, pos.planId, pos.x, pos.y, kat, titel.trim() || null, notiz.trim() || null, pano ? 1 : 0, foto.width ?? null, foto.height ?? null, foto.takenAt, userId, new Date().toISOString()],
    );
    await queueDoku(db, id, foto);
    onClose();
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title={pos.serieId ? 'Neues Foto an dieser Stelle' : 'Foto dokumentieren'} left="Abbrechen" onLeft={onClose} right="Sichern" rightDisabled={!foto} onRight={() => void save()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Section footer={pano ? '360°-Foto erkannt – es wird als Rundumansicht gezeigt.' : '360°: in der Insta360-App als 360°-Foto exportieren (in Fotos speichern), dann hier „Aus Fotos“ wählen.'}>
          {foto && <Image source={{ uri: foto.uri }} style={{ width: '100%', height: pano ? 160 : 220 }} resizeMode="cover" />}
          <Row icon="camera" iconBg="blue" label={foto ? 'Neu aufnehmen' : 'Foto aufnehmen'} tone="accent" onPress={() => void pickFoto('camera', true).then((p) => p && setFoto(p))} />
          <Row icon="photo.on.rectangle" iconBg="indigo" label="Aus Fotos (auch 360°)" tone="accent" onPress={() => void pickFoto('library', true).then((p) => p && setFoto(p))} />
        </Section>
        <Section title="Kategorie">
          {FOTODOKU_KATEGORIEN.map((k) => <Row key={k} label={FOTODOKU_LABEL[k]} checked={kat === k} onPress={() => setKat(k)} />)}
        </Section>
        <Section title="Beschreibung" footer="Der Raum ergibt sich aus der Stelle auf dem Plan. Ohne Netz wird alles später automatisch hochgeladen.">
          <TextInput style={input} placeholder="Titel (z. B. Vorwand Bad vor Beplankung)" placeholderTextColor={C.label3 as unknown as string} value={titel} onChangeText={setTitel} />
          <TextInput style={[input, { minHeight: 70 }]} multiline placeholder="Notiz (Leitungsführung, Abstände …)" placeholderTextColor={C.label3 as unknown as string} value={notiz} onChangeText={setNotiz} />
        </Section>
      </ScrollView>
    </View>
  );
}

interface Doku { id: string; kategorie: FotodokuKategorie; titel: string | null; notiz: string | null; ist_360: number; taken_at: string; file_key: string | null; location_id: string | null }

/** Local copy if this device took it, else downloaded once into the cache (needs network the first time). */
function useDokuDatei(id: string, token: string) {
  const [uri, setUri] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    const own = localFoto(id);
    if (own.exists) { setUri(own.uri); return; }
    const cache = new File(Paths.cache, `doku-${id}.jpg`);
    if (cache.exists) { setUri(cache.uri); return; }
    void File.downloadFileAsync(`${API_URL}/fotodoku/${id}/datei`, cache, { headers: { authorization: `Bearer ${token}` }, idempotent: true })
      .then((f) => !cancel && setUri(f.uri))
      .catch(() => !cancel && setFehler('Foto ist noch nicht auf diesem Gerät – es lädt, sobald Netz da ist.'));
    return () => { cancel = true; };
  }, [id, token]);
  return { uri, fehler };
}

export function FotodokuDetail({ id, token, onClose, eingebettet }: { id: string; token: string; onClose: () => void; eingebettet?: boolean }) {
  const { data } = useQuery<Doku & { ort: string | null }>(
    'SELECT f.id, f.kategorie, f.titel, f.notiz, f.ist_360, f.taken_at, f.file_key, f.location_id, l.name AS ort FROM foto_doku f LEFT JOIN location l ON l.id = f.location_id WHERE f.id = ?', [id]);
  const f = data[0];
  const { uri, fehler } = useDokuDatei(id, token);
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!uri || !f?.ist_360) return;
    try { setHtml(panoHtml(`data:image/jpeg;base64,${new File(uri).base64Sync()}`)); } catch { Alert.alert('360°-Ansicht', 'Das Foto konnte nicht geöffnet werden.'); }
  }, [uri, f?.ist_360]);
  if (!f) return null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {!eingebettet && <SheetBar title={f.titel || FOTODOKU_LABEL[f.kategorie]} right="Fertig" onRight={onClose} />}
      <View style={{ height: f.ist_360 ? 420 : 320, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        {fehler ? <Text style={[T.subhead, { color: '#fff', padding: 24, textAlign: 'center' }]}>{fehler}</Text>
          : !uri ? <ActivityIndicator color="#fff" />
          : f.ist_360 ? (html ? <WebView source={{ html }} originWhitelist={['*']} style={{ alignSelf: 'stretch', flex: 1, backgroundColor: '#000' }} containerStyle={{ alignSelf: 'stretch', flex: 1 }} scrollEnabled={false} bounces={false} onMessage={(e) => Alert.alert('360°-Ansicht', e.nativeEvent.data)} /> : <ActivityIndicator color="#fff" />)
          : <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {!!f.ist_360 && <Text style={[T.footnote, { marginBottom: 8 }]}>360°: wischen zum Umsehen, zwei Finger zum Zoomen.</Text>}
        <Section>
          <Row label="Kategorie" value={FOTODOKU_LABEL[f.kategorie]} />
          <Row label="Ort" value={f.ort ?? '–'} />
          <Row label="Aufgenommen" value={new Date(f.taken_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} />
          <Row label="Auf dem Server" value={f.file_key ? 'ja' : 'wartet auf Abgleich'} />
        </Section>
        {f.notiz && <Text style={[T.body, { padding: 8 }]}>{f.notiz}</Text>}
        <Text style={[T.footnote, { padding: 8 }]}>Mangel aus dem Foto, Bearbeiten und Entfernen: in der Web-App unter „Fotodokumentation“.</Text>
      </ScrollView>
    </View>
  );
}

/** Series at one spot: photos from different days, sorted by date; previews to jump, arrows, "Neues Foto hier". */
export function FotodokuSerie({ serieId, token, onClose, onNeu }: { serieId: string; token: string; onClose: () => void; onNeu: (p: { planId: string; x: number; y: number; serieId: string }) => void }) {
  const { data: fotos } = useQuery<{ id: string; taken_at: string; titel: string | null; kategorie: FotodokuKategorie; plan_id: string; pin_x: number; pin_y: number; file_key: string | null }>(
    'SELECT id, taken_at, titel, kategorie, plan_id, pin_x, pin_y, file_key FROM foto_doku WHERE coalesce(serie_id, id) = ? ORDER BY taken_at', [serieId]);
  const [i, setI] = useState<number | null>(null);
  if (!fotos.length) return null;
  const idx = i ?? fotos.length - 1;
  const f = fotos[Math.min(idx, fotos.length - 1)]!;
  const kopf = fotos[0]!;
  const quelle = (id: string, hochgeladen: boolean) => {
    const own = localFoto(id);
    if (own.exists) return { uri: own.uri };
    return hochgeladen ? { uri: `${API_URL}/fotodoku/${id}/datei?vorschau=1`, headers: { authorization: `Bearer ${token}` } } : null;
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title={`${kopf.titel || FOTODOKU_LABEL[kopf.kategorie]} · ${fotos.length} Fotos`} right="Fertig" onRight={onClose} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 }}>
        <Pressable disabled={idx === 0} onPress={() => setI(idx - 1)} hitSlop={10}><Text style={[T.title2, { color: idx === 0 ? C.label3 : C.accent }]}>‹</Text></Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={T.headline}>{new Date(f.taken_at).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</Text>
          <Text style={T.footnote}>Foto {idx + 1} von {fotos.length}</Text>
        </View>
        <Pressable disabled={idx === fotos.length - 1} onPress={() => setI(idx + 1)} hitSlop={10}><Text style={[T.title2, { color: idx === fotos.length - 1 ? C.label3 : C.accent }]}>›</Text></Pressable>
      </View>
      <ScrollView horizontal contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }} style={{ flexGrow: 0 }}>
        {fotos.map((x, j) => {
          const src = quelle(x.id, !!x.file_key);
          return (
            <Pressable key={x.id} onPress={() => setI(j)} style={{ width: 96, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: j === idx ? C.accent : 'transparent', backgroundColor: C.card }}>
              {src ? <Image source={src} style={{ width: '100%', height: 56 }} resizeMode="cover" /> : <View style={{ height: 56 }} />}
              <Text style={[T.caption, { textAlign: 'center', paddingVertical: 2, color: j === idx ? C.accent : C.label2 }]}>{new Date(x.taken_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ flex: 1 }}>
        <FotodokuDetail key={f.id} id={f.id} token={token} onClose={onClose} eingebettet />
      </View>
      <View style={{ padding: 16, paddingBottom: 34 }}>
        <Pressable onPress={() => onNeu({ planId: kopf.plan_id, x: kopf.pin_x, y: kopf.pin_y, serieId })} style={({ pressed }) => ({ backgroundColor: C.accent, borderRadius: 12, padding: 14, alignItems: 'center', opacity: pressed ? 0.8 : 1 })}>
          <Text style={[T.headline, { color: '#fff' }]}>Neues Foto an dieser Stelle</Text>
        </Pressable>
      </View>
    </View>
  );
}
