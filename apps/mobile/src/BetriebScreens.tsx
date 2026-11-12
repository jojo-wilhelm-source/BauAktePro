/**
 * Baustellen-Einkäufe and Fahrtenbuch on the phone (docs/fachkonzept/14). Everything works offline: entries go into
 * the local database (device id), are uploaded via /sync/upload, receipt photos follow once the entry is on the server.
 */
import { useMemo, useState } from 'react';
import { Image, ScrollView, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { usePowerSync, useQuery } from '@powersync/react';
import { formatDate, kmWarnung, nettoAusBrutto, ZAHLUNGSART_LABELS, type Zahlungsart } from '@bap/domain';
import { pickFoto, queueBeleg, type Picked } from './fotoStore';
import { C, T } from './theme';
import { Pill, Row, Section, Segmented, SheetBar } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => Number(s.replace(',', '.'));
const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const input = { ...T.body, paddingHorizontal: 16, paddingVertical: 12 } as const;

function Field({ label, value, onChange, placeholder, numeric }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; numeric?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={[T.body, { paddingLeft: 16, width: 130 }]}>{label}</Text>
      <TextInput style={[input, { flex: 1, textAlign: 'right' }]} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.label3 as unknown as string}
        keyboardType={numeric ? 'decimal-pad' : 'default'} />
    </View>
  );
}

function FotoRows({ foto, setFoto, label }: { foto: Picked | null; setFoto: (p: Picked) => void; label: string }) {
  return (
    <Section title={label} footer="Das Foto wird hochgeladen, sobald Netz da ist.">
      {foto && <Image source={{ uri: foto.uri }} style={{ width: '100%', height: 180 }} resizeMode="cover" />}
      <Row icon="camera" iconBg="blue" label={foto ? 'Neu aufnehmen' : 'Beleg fotografieren'} tone="accent" onPress={() => void pickFoto('camera').then((p) => p && setFoto(p))} />
      <Row icon="photo.on.rectangle" iconBg="indigo" label="Aus Fotos wählen" tone="accent" onPress={() => void pickFoto('library').then((p) => p && setFoto(p))} />
    </Section>
  );
}

export function EinkaufScreen({ projectId, userId, userName, onClose }: { projectId: string; userId: string; userName: string; onClose: () => void }) {
  const db = usePowerSync();
  const { data: mine } = useQuery<{ id: string; number: number | null; datum: string; haendler: string; zweck: string; betrag_brutto: number; status: string }>(
    'SELECT id, number, datum, haendler, zweck, betrag_brutto, status FROM einkauf WHERE project_id = ? ORDER BY datum DESC, created_at DESC LIMIT 30',
    [projectId],
  );
  const [f, setF] = useState({ haendler: '', zweck: '', brutto: '', mwst: 19, zahlungsart: 'firmenkarte' as Zahlungsart, gekauft_von: userName });
  const [foto, setFoto] = useState<Picked | null>(null);
  const valid = f.haendler.trim() && f.zweck.trim() && f.brutto !== '' && num(f.brutto) >= 0;
  const save = async () => {
    if (!valid) return;
    const id = Crypto.randomUUID();
    await db.execute(
      `INSERT INTO einkauf (id, project_id, gekauft_von, datum, haendler, betrag_brutto, mwst_satz, zweck, zahlungsart, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'eingereicht', ?, ?)`,
      [id, projectId, f.gekauft_von, today(), f.haendler.trim(), num(f.brutto), f.mwst, f.zweck.trim(), f.zahlungsart, userId, new Date().toISOString()],
    );
    if (foto) await queueBeleg(db, 'einkauf', id, foto);
    setF({ ...f, haendler: '', zweck: '', brutto: '' });
    setFoto(null);
  };
  const ZA = Object.keys(ZAHLUNGSART_LABELS) as Zahlungsart[];
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Einkauf erfassen" left="Fertig" onLeft={onClose} right="Sichern" rightDisabled={!valid} onRight={() => void save()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Section>
          <Field label="Händler" value={f.haendler} onChange={(v) => setF({ ...f, haendler: v })} placeholder="z. B. Bauhaus" />
          <Field label="Wofür" value={f.zweck} onChange={(v) => setF({ ...f, zweck: v })} placeholder="z. B. Abdeckfolie" />
          <Field label="Betrag brutto" value={f.brutto} onChange={(v) => setF({ ...f, brutto: v })} placeholder="0,00 €" numeric />
          <Field label="Gekauft von" value={f.gekauft_von} onChange={(v) => setF({ ...f, gekauft_von: v })} />
        </Section>
        <Section title="MwSt" footer={f.brutto ? `Netto ${euro(nettoAusBrutto(num(f.brutto), f.mwst))}` : undefined}>
          <View style={{ padding: 10 }}><Segmented values={['19 %', '7 %', '0 %']} index={[19, 7, 0].indexOf(f.mwst)} onChange={(i) => setF({ ...f, mwst: [19, 7, 0][i]! })} /></View>
        </Section>
        <Section title="Bezahlt mit">
          <View style={{ padding: 10 }}><Segmented values={ZA.map((z) => ZAHLUNGSART_LABELS[z])} index={ZA.indexOf(f.zahlungsart)} onChange={(i) => setF({ ...f, zahlungsart: ZA[i]! })} /></View>
        </Section>
        <FotoRows foto={foto} setFoto={setFoto} label="Beleg" />
        <Section title="Meine Einkäufe">
          {mine.map((e) => (
            <Row key={e.id} label={`${e.haendler} · ${e.zweck}`} subtitle={`${formatDate(e.datum)} · ${euro(e.betrag_brutto)}`}
              value={<Pill tint={e.number == null ? 'orange' : e.status === 'freigegeben' ? 'green' : e.status === 'abgelehnt' ? 'red' : 'gray'}>{e.number == null ? 'wartet auf Netz' : e.status === 'freigegeben' ? 'Freigegeben' : e.status === 'abgelehnt' ? 'Abgelehnt' : 'Eingereicht'}</Pill>} />
          ))}
          {mine.length === 0 && <Row label={<Text style={T.subhead}>Noch keine Einkäufe</Text>} />}
        </Section>
      </ScrollView>
    </View>
  );
}

type Fz = { id: string; kennzeichen: string; bezeichnung: string; fahrer_id: string | null; art: 'fahrzeug' | 'maschine' | 'tankstelle' | null };
const ART_LABEL = { fahrzeug: 'Fahrzeug', maschine: 'Maschine', tankstelle: 'Mobile Tankstelle' } as const;

/**
 * Fahrtenbuch on the phone (offline): trips and fill-ups of vehicles, fill-ups of machines with Betriebsstunden,
 * diesel from the mobile station, refilling the station. Only reaches the device if the administrator granted it.
 */
export function FahrtenbuchScreen({ projectId, projectName, userId, onClose }: { projectId: string; projectName: string; userId: string; onClose: () => void }) {
  const db = usePowerSync();
  const { data: fahrzeuge } = useQuery<Fz>('SELECT id, kennzeichen, bezeichnung, fahrer_id, art FROM fahrzeug ORDER BY art, bezeichnung');
  const mineFirst = useMemo(() => [...fahrzeuge].sort((a, b) => Number(b.fahrer_id === userId) - Number(a.fahrer_id === userId)), [fahrzeuge, userId]);
  const [fzId, setFzId] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const fz = mineFirst.find((x) => x.id === fzId) ?? mineFirst[0];
  const art = fz?.art ?? 'fahrzeug';
  const stationen = fahrzeuge.filter((x) => x.art === 'tankstelle');
  const { data: last } = useQuery<{ km: number | null; bh: number | null }>(
    `SELECT (SELECT max(km) FROM (SELECT km_ende AS km FROM fahrt WHERE fahrzeug_id = ? UNION ALL SELECT km_stand FROM tankvorgang WHERE fahrzeug_id = ?)) AS km,
            (SELECT max(betriebsstunden) FROM tankvorgang WHERE fahrzeug_id = ?) AS bh`,
    [fz?.id ?? '', fz?.id ?? '', fz?.id ?? ''],
  );
  const { data: liste } = useQuery<{ id: string; art: string; datum: string; km: number | null; zweck: string | null; liter: number | null; betrag: number | null; bh: number | null }>(
    `SELECT id, 'fahrt' AS art, datum, (km_ende - km_start) AS km, zweck, NULL AS liter, NULL AS betrag, NULL AS bh FROM fahrt WHERE fahrzeug_id = ?
     UNION ALL SELECT id, 'tanken', datum, NULL, NULL, liter, betrag_brutto, betriebsstunden FROM tankvorgang WHERE fahrzeug_id = ? OR quelle_id = ?
     ORDER BY datum DESC LIMIT 20`,
    [fz?.id ?? '', fz?.id ?? '', fz?.id ?? ''],
  );
  const lastKm = last[0]?.km ?? null;
  const [modeRaw, setMode] = useState(0); // 0 Fahrt, 1 Tanken
  const mode = art === 'fahrzeug' ? modeRaw : 1;
  const [f, setF] = useState({ km_start: '', km_ende: '', zweck: '', mitProjekt: true, liter: '', betrag: '', km_stand: '', bh: '', tankstelle: '', quelle: '' });
  const [foto, setFoto] = useState<Picked | null>(null);
  const start = f.km_start || (lastKm != null ? String(lastKm) : '');
  const warn = mode === 0 && start ? kmWarnung(lastKm, Number(start)) : null;
  const ausStation = !!f.quelle && art !== 'tankstelle';
  const valid = fz && (mode === 0
    ? start !== '' && f.km_ende !== '' && Number(f.km_ende) >= Number(start) && f.zweck.trim()
    : num(f.liter) > 0 && (art !== 'fahrzeug' || (f.km_stand || start) !== '') && (art !== 'maschine' || f.bh !== '') && (ausStation || art === 'maschine' || f.betrag !== ''));
  const save = async () => {
    if (!valid || !fz) return;
    const id = Crypto.randomUUID();
    if (mode === 0) {
      await db.execute('INSERT INTO fahrt (id, fahrzeug_id, fahrer_id, datum, km_start, km_ende, project_id, zweck) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, fz.id, userId, today(), Number(start), Number(f.km_ende), f.mitProjekt ? projectId : null, f.zweck.trim()]);
    } else {
      await db.execute('INSERT INTO tankvorgang (id, fahrzeug_id, fahrer_id, datum, liter, betrag_brutto, km_stand, betriebsstunden, quelle_id, tankstelle, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, fz.id, userId, today(), num(f.liter), f.betrag !== '' ? num(f.betrag) : null, art === 'fahrzeug' ? Number(f.km_stand || start) : null,
          art === 'maschine' ? num(f.bh) : null, ausStation ? f.quelle : null, ausStation ? null : f.tankstelle || null, f.mitProjekt ? projectId : null]);
      if (foto && !ausStation) await queueBeleg(db, 'tankvorgang', id, foto);
    }
    setF({ km_start: '', km_ende: '', zweck: '', mitProjekt: f.mitProjekt, liter: '', betrag: '', km_stand: '', bh: '', tankstelle: '', quelle: f.quelle });
    setFoto(null);
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Fahrtenbuch" left="Fertig" onLeft={onClose} right="Sichern" rightDisabled={!valid} onRight={() => void save()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Section>
          <Row icon={art === 'maschine' ? 'gearshape.2' : art === 'tankstelle' ? 'fuelpump' : 'car'} iconBg={art === 'tankstelle' ? 'orange' : art === 'maschine' ? 'indigo' : 'blue'}
            label={fz ? fz.bezeichnung : 'Kein Fahrzeug verfügbar'} subtitle={fz ? `${ART_LABEL[art]} · ${fz.kennzeichen}` : undefined} chevron onPress={() => setPick(!pick)} />
          {pick && mineFirst.map((x) => (
            <Row key={x.id} label={x.bezeichnung} subtitle={ART_LABEL[x.art ?? 'fahrzeug']} checked={x.id === fz?.id} onPress={() => { setFzId(x.id); setPick(false); }} />
          ))}
        </Section>
        {art === 'fahrzeug' && <View style={{ marginBottom: 14 }}><Segmented values={['Fahrt', 'Tanken']} index={mode} onChange={setMode} /></View>}
        {!fz ? null : mode === 0 ? (
          <Section title={`letzter km-Stand ${lastKm ?? '–'}`} footer={warn ?? 'km-Stand Start ist mit dem letzten bekannten Stand vorbelegt.'}>
            <Field label="km Start" value={start} onChange={(v) => setF({ ...f, km_start: v })} numeric />
            <Field label="km Ende" value={f.km_ende} onChange={(v) => setF({ ...f, km_ende: v })} placeholder="km-Stand" numeric />
            {f.km_ende !== '' && <Row label="Strecke" value={`${Number(f.km_ende) - Number(start)} km`} />}
            <Field label="Zweck" value={f.zweck} onChange={(v) => setF({ ...f, zweck: v })} placeholder="z. B. Material holen" />
            <Row label={projectName} checked={f.mitProjekt} onPress={() => setF({ ...f, mitProjekt: !f.mitProjekt })} />
          </Section>
        ) : (
          <>
            {art !== 'tankstelle' && stationen.length > 0 && (
              <Section title="Getankt an">
                <Row label="Öffentliche Tankstelle" checked={!f.quelle} onPress={() => setF({ ...f, quelle: '' })} />
                {stationen.map((x) => <Row key={x.id} label={x.bezeichnung} checked={f.quelle === x.id} onPress={() => setF({ ...f, quelle: x.id })} />)}
              </Section>
            )}
            <Section title={art === 'tankstelle' ? 'Tankstelle befüllen' : 'Tanken'} footer={art === 'maschine' && last[0]?.bh != null ? `Letzte Betriebsstunden: ${last[0].bh}` : undefined}>
              <Field label="Liter" value={f.liter} onChange={(v) => setF({ ...f, liter: v })} placeholder="0,00" numeric />
              {art === 'maschine' && <Field label="Betriebsstunden" value={f.bh} onChange={(v) => setF({ ...f, bh: v })} placeholder="Bh" numeric />}
              {art === 'fahrzeug' && <Field label="km-Stand" value={f.km_stand || start} onChange={(v) => setF({ ...f, km_stand: v })} numeric />}
              {!ausStation && <Field label="Betrag brutto" value={f.betrag} onChange={(v) => setF({ ...f, betrag: v })} placeholder={art === 'maschine' ? 'optional' : '0,00 €'} numeric />}
              {!ausStation && <Field label={art === 'tankstelle' ? 'Lieferant' : 'Tankstelle'} value={f.tankstelle} onChange={(v) => setF({ ...f, tankstelle: v })} />}
              <Row label={projectName} checked={f.mitProjekt} onPress={() => setF({ ...f, mitProjekt: !f.mitProjekt })} />
            </Section>
            {!ausStation && <FotoRows foto={foto} setFoto={setFoto} label="Beleg" />}
          </>
        )}
        <Section title="Zuletzt (meine Einträge)">
          {liste.map((l) => <Row key={l.id} icon={l.art === 'fahrt' ? 'car' : 'fuelpump'} iconBg={l.art === 'fahrt' ? 'blue' : 'orange'}
            label={l.art === 'fahrt' ? `${(l.km ?? 0).toLocaleString('de-DE')} km · ${l.zweck ?? ''}` : `${(l.liter ?? 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} l${l.bh != null ? ` · ${l.bh} Bh` : ''}${l.betrag != null ? ` · ${euro(l.betrag)}` : ''}`} subtitle={formatDate(l.datum)} />)}
          {liste.length === 0 && <Row label={<Text style={T.subhead}>Noch keine Einträge</Text>} />}
        </Section>
      </ScrollView>
    </View>
  );
}
