/**
 * Bautagebuch on iPhone/iPad (docs/fachkonzept/07), fully offline: the Polier fills in the day (prefilled from the
 * last report), signs with the finger and adds Nachträge. Everything goes into tagesbericht_action (ordered queue);
 * the server applies each step only if the report is unchanged, otherwise it becomes a Hinweis (never overwritten).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import * as Crypto from 'expo-crypto';
import { usePowerSync, useQuery } from '@powersync/react';
import { formatDate, isPlausibleSignature, wochentag, type Signature } from '@bap/domain';
import { C, T } from './theme';
import { Pill, Row, Section, SheetBar } from './ui';

interface Wetter { text?: string; temp_min?: number | null; temp_max?: number | null; niederschlag?: string; wind?: string }
interface Draft {
  id: string; project_id: string; datum: string; bereich: string; wetter: Wetter; personal: { firma: string; anzahl: number; taetigkeit?: string }[];
  geraete: { name: string; anzahl: number }[]; leistungen: { text: string }[]; lieferungen: string; behinderungen: string; besonderheiten: string;
}
interface Synced { id: string; datum: string; bereich: string | null; wetter: string; personal: string; geraete: string; leistungen: string; lieferungen: string | null; behinderungen: string | null; besonderheiten: string | null; status: string; signed_at: string | null; countersigned_at: string | null; version: number }
interface Lokal { id: string; datum: string; payload: string; status: string; expected_version: number; nachtraege: string; countersigned: number }

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const j = <X,>(s: string | null | undefined, d: X): X => {
  try { return s ? (JSON.parse(s) as X) : d; } catch { return d; }
};
const input = { ...T.body, paddingHorizontal: 16, paddingVertical: 12 } as const;
const fromSynced = (r: Synced, projectId: string): Draft => ({
  id: r.id, project_id: projectId, datum: r.datum, bereich: r.bereich ?? '', wetter: j(r.wetter, {}), personal: j(r.personal, []), geraete: j(r.geraete, []),
  leistungen: j(r.leistungen, []), lieferungen: r.lieferungen ?? '', behinderungen: r.behinderungen ?? '', besonderheiten: r.besonderheiten ?? '',
});

export function BautagebuchScreen({ projectId, role, onClose }: { projectId: string; role: string | undefined; onClose: () => void }) {
  const db = usePowerSync();
  const { data: synced } = useQuery<Synced>('SELECT * FROM tagesbericht WHERE project_id = ? ORDER BY datum DESC LIMIT 60', [projectId]);
  const { data: lokal } = useQuery<Lokal>('SELECT * FROM tagesbericht_lokal WHERE project_id = ?', [projectId]);
  const { data: conflicts } = useQuery<{ entity_id: string }>('SELECT entity_id FROM sync_conflict');
  const [open, setOpen] = useState<string | null>(null);

  // Local work is dropped once the server state includes it (or the server refused it → Hinweis).
  useEffect(() => {
    for (const l of lokal) {
      const s = synced.find((x) => x.id === l.id);
      if ((s && s.version >= l.expected_version) || conflicts.some((c) => c.entity_id === l.id)) void db.execute('DELETE FROM tagesbericht_lokal WHERE id = ?', [l.id]);
    }
  }, [synced, lokal, conflicts, db]);

  const days = useMemo(() => {
    const m = new Map<string, { id: string; datum: string; status: string; pending: boolean; countersigned: boolean; personen: number }>();
    for (const s of synced) m.set(s.id, { id: s.id, datum: s.datum, status: s.status, pending: false, countersigned: !!s.countersigned_at, personen: j<{ anzahl: number }[]>(s.personal, []).reduce((a, p) => a + (Number(p.anzahl) || 0), 0) });
    for (const l of lokal) {
      const d = j<Draft | null>(l.payload, null);
      m.set(l.id, { id: l.id, datum: l.datum, status: l.status, pending: true, countersigned: !!l.countersigned, personen: (d?.personal ?? []).reduce((a, p) => a + (Number(p.anzahl) || 0), 0) });
    }
    return [...m.values()].sort((a, b) => b.datum.localeCompare(a.datum));
  }, [synced, lokal]);

  const neu = async () => {
    const d = today();
    const existing = days.find((x) => x.datum === d);
    if (existing) return setOpen(existing.id);
    // Vortag-Übernahme: personnel, equipment and area from the last report on the device.
    const last = synced.find((s) => s.datum < d);
    const id = Crypto.randomUUID();
    const draft: Draft = {
      id, project_id: projectId, datum: d, bereich: last?.bereich ?? '', wetter: {}, personal: last ? j(last.personal, []) : [{ firma: 'Eigene Firma', anzahl: 0 }],
      geraete: last ? j(last.geraete, []) : [], leistungen: [{ text: '' }], lieferungen: '', behinderungen: '', besonderheiten: '',
    };
    await db.execute('INSERT INTO tagesbericht_lokal (id, project_id, datum, payload, status, expected_version, nachtraege, countersigned, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
      [id, projectId, d, JSON.stringify(draft), 'neu', 0, '[]', new Date().toISOString()]);
    setOpen(id);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Bautagebuch" left="Fertig" onLeft={onClose} right="Heute" onRight={() => void neu()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Section title="Tagesberichte" footer="Funktioniert ohne Netz. Unterschriebene Berichte sind gesperrt, Ergänzungen nur als Nachtrag. Die Bauleitung zeichnet gegen.">
          {days.map((d) => (
            <Row key={d.id} label={`${wochentag(d.datum)}, ${formatDate(d.datum)}`} subtitle={`${d.personen} Personen`} chevron onPress={() => setOpen(d.id)}
              value={<Pill tint={d.pending ? 'orange' : d.countersigned ? 'green' : d.status === 'unterschrieben' ? 'blue' : 'gray'}>
                {d.pending ? (d.status === 'unterschrieben' ? 'Unterschrieben · wartet auf Netz' : 'wartet auf Netz') : d.countersigned ? 'Gegengezeichnet' : d.status === 'unterschrieben' ? 'Unterschrieben' : 'Entwurf'}
              </Pill>} />
          ))}
          {days.length === 0 && <Row label={<Text style={T.subhead}>Noch keine Berichte – „Heute“ tippen</Text>} />}
        </Section>
      </ScrollView>
      <Modal visible={!!open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(null)}>
        {open && (synced.some((s) => s.id === open) || lokal.some((l) => l.id === open)) && <BerichtScreen id={open} projectId={projectId} leitung={role === 'bauleitung' || role === 'projektleitung'} synced={synced.find((s) => s.id === open) ?? null} lokal={lokal.find((l) => l.id === open) ?? null} onClose={() => setOpen(null)} />}
      </Modal>
    </View>
  );
}

function BerichtScreen({ id, projectId, leitung, synced, lokal, onClose }: { id: string; projectId: string; leitung: boolean; synced: Synced | null; lokal: Lokal | null; onClose: () => void }) {
  const db = usePowerSync();
  const { data: nachtraege } = useQuery<{ id: string; text: string; created_at: string }>('SELECT id, text, created_at FROM tagesbericht_nachtrag WHERE bericht_id = ? ORDER BY created_at', [id]);
  const initial = useRef<Draft>(lokal ? j<Draft>(lokal.payload, null as never) : fromSynced(synced!, projectId));
  const [d, setD] = useState<Draft>(initial.current);
  const [dirty, setDirty] = useState(lokal?.status === 'neu');
  const [sign, setSign] = useState<'unterschreiben' | 'gegenzeichnen' | null>(null);
  const [nachtrag, setNachtrag] = useState('');
  const status = lokal?.status === 'unterschrieben' || synced?.status === 'unterschrieben' ? 'unterschrieben' : 'entwurf';
  const ro = status !== 'entwurf';
  const countersigned = !!synced?.countersigned_at || !!lokal?.countersigned;
  const pendingNachtraege = j<{ text: string; at: string }[]>(lokal?.nachtraege, []);
  // Version the server will have once everything queued is applied.
  const base = lokal && lokal.status !== 'neu' ? lokal.expected_version : (synced?.version ?? 0);
  const set = (p: Partial<Draft>) => { setD({ ...d, ...p }); setDirty(true); };

  /** Queues an action and records the expected outcome locally (shown until the server confirms it). */
  const queue = async (action: 'speichern' | 'unterschreiben' | 'gegenzeichnen' | 'nachtrag', payload: object, local: { status?: string; nachtraege?: object[]; countersigned?: boolean; draft?: Draft }) => {
    const now = new Date().toISOString();
    const bumps = action === 'nachtrag' ? 0 : 1;
    await db.writeTransaction(async (tx) => {
      await tx.execute('INSERT INTO tagesbericht_action (id, bericht_id, action, payload, base_version, occurred_at) VALUES (?, ?, ?, ?, ?, ?)', [Crypto.randomUUID(), id, action, JSON.stringify(payload), base, now]);
      const draft = local.draft ?? d;
      await tx.execute('DELETE FROM tagesbericht_lokal WHERE id = ?', [id]);
      await tx.execute('INSERT INTO tagesbericht_lokal (id, project_id, datum, payload, status, expected_version, nachtraege, countersigned, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        id, projectId, draft.datum, JSON.stringify(draft), local.status ?? (lokal?.status === 'neu' ? 'entwurf' : (lokal?.status ?? status)), base + bumps,
        JSON.stringify(local.nachtraege ?? pendingNachtraege), (local.countersigned ?? countersigned) ? 1 : 0, now,
      ]);
    });
  };
  const clean = (x: Draft): Draft => ({ ...x, leistungen: x.leistungen.filter((l) => l.text.trim()), personal: x.personal.filter((p) => p.firma.trim()), geraete: x.geraete.filter((g) => g.name.trim()) });
  const save = async () => {
    const c = clean(d);
    await queue('speichern', { ...c, bereich: c.bereich || null, lieferungen: c.lieferungen || null, behinderungen: c.behinderungen || null, besonderheiten: c.besonderheiten || null }, { draft: d, status: 'entwurf' });
    setDirty(false);
  };
  const onSigned = async (s: Signature) => {
    const kind = sign!;
    setSign(null);
    if (kind === 'unterschreiben') {
      if (dirty) await save();
      // re-read: save() just bumped the expected version
      const [l] = await db.getAll<Lokal>('SELECT * FROM tagesbericht_lokal WHERE id = ?', [id]);
      const b = l ? l.expected_version : base;
      const now = new Date().toISOString();
      await db.writeTransaction(async (tx) => {
        await tx.execute('INSERT INTO tagesbericht_action (id, bericht_id, action, payload, base_version, occurred_at) VALUES (?, ?, ?, ?, ?, ?)', [Crypto.randomUUID(), id, 'unterschreiben', JSON.stringify({ signature: s }), b, now]);
        await tx.execute('DELETE FROM tagesbericht_lokal WHERE id = ?', [id]);
        await tx.execute('INSERT INTO tagesbericht_lokal (id, project_id, datum, payload, status, expected_version, nachtraege, countersigned, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
          [id, projectId, d.datum, JSON.stringify(clean(d)), 'unterschrieben', b + 1, '[]', now]);
      });
    } else await queue('gegenzeichnen', { signature: s }, { countersigned: true, status: 'unterschrieben' });
  };
  const addNachtrag = async () => {
    const text = nachtrag.trim();
    if (text.length < 3) return;
    await queue('nachtrag', { text }, { nachtraege: [...pendingNachtraege, { text, at: new Date().toISOString() }], status: 'unterschrieben' });
    setNachtrag('');
  };
  const discardNew = async () => {
    if (lokal?.status === 'neu') await db.execute('DELETE FROM tagesbericht_lokal WHERE id = ?', [id]);
    onClose();
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder?: string, numeric?: boolean) => (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={[T.body, { paddingLeft: 16, width: 130 }]}>{label}</Text>
      <TextInput editable={!ro} style={[input, { flex: 1, textAlign: 'right', color: ro ? C.label2 : C.label }]} value={value} onChangeText={onChange} placeholder={ro ? '–' : placeholder}
        placeholderTextColor={C.label3 as unknown as string} keyboardType={numeric ? 'numbers-and-punctuation' : 'default'} />
    </View>
  );
  const area = (label: string, key: 'lieferungen' | 'behinderungen' | 'besonderheiten') => (
    <Section title={label}>
      <TextInput editable={!ro} multiline style={[input, { minHeight: 64, color: ro ? C.label2 : C.label }]} value={d[key]} onChangeText={(v) => set({ [key]: v })} placeholder={ro ? '–' : ''} placeholderTextColor={C.label3 as unknown as string} />
    </Section>
  );
  const sep = <View style={{ height: 0.5, backgroundColor: C.separator, marginLeft: 16 }} />;
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title={`${wochentag(d.datum).slice(0, 2)}, ${formatDate(d.datum)}`} left={dirty && lokal?.status === 'neu' ? 'Verwerfen' : 'Fertig'} onLeft={() => void (dirty && lokal?.status === 'neu' ? discardNew() : onClose())}
        right={ro ? undefined : 'Sichern'} rightDisabled={!dirty} onRight={() => void save()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 12 }}>
          <Pill tint={lokal ? 'orange' : countersigned ? 'green' : ro ? 'blue' : 'gray'}>
            {(ro ? (countersigned ? 'Gegengezeichnet' : 'Unterschrieben') : 'Entwurf') + (lokal && lokal.status !== 'neu' ? ' · wartet auf Netz' : '')}
          </Pill>
        </View>
        <Section>
          {field('Bereich', d.bereich, (v) => set({ bereich: v }), 'z. B. Bauteil A')}{sep}
          {field('Wetter', d.wetter.text ?? '', (v) => set({ wetter: { ...d.wetter, text: v } }), 'z. B. bewölkt')}{sep}
          {field('Temp. min °C', d.wetter.temp_min == null ? '' : String(d.wetter.temp_min), (v) => set({ wetter: { ...d.wetter, temp_min: num(v) } }), '–', true)}{sep}
          {field('Temp. max °C', d.wetter.temp_max == null ? '' : String(d.wetter.temp_max), (v) => set({ wetter: { ...d.wetter, temp_max: num(v) } }), '–', true)}{sep}
          {field('Niederschlag', d.wetter.niederschlag ?? '', (v) => set({ wetter: { ...d.wetter, niederschlag: v } }), 'keiner')}
        </Section>

        <Section title={`Personal · ${d.personal.reduce((a, p) => a + (Number(p.anzahl) || 0), 0)} Personen`}>
          {d.personal.map((p, i) => (
            <View key={i}>
              {i > 0 && sep}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput editable={!ro} style={[input, { flex: 1, color: C.label }]} value={p.firma} placeholder="Firma" placeholderTextColor={C.label3 as unknown as string}
                  onChangeText={(v) => set({ personal: d.personal.map((x, k) => (k === i ? { ...x, firma: v } : x)) })} />
                <Stepper value={p.anzahl} disabled={ro} onChange={(n) => set({ personal: d.personal.map((x, k) => (k === i ? { ...x, anzahl: n } : x)) })} />
              </View>
            </View>
          ))}
          {!ro && <Row label="Firma hinzufügen" icon="plus" iconBg="green" tone="accent" onPress={() => set({ personal: [...d.personal, { firma: '', anzahl: 1 }] })} />}
        </Section>

        <Section title="Geräte">
          {d.geraete.map((g, i) => (
            <View key={i}>
              {i > 0 && sep}
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput editable={!ro} style={[input, { flex: 1, color: C.label }]} value={g.name} placeholder="z. B. Turmdrehkran" placeholderTextColor={C.label3 as unknown as string}
                  onChangeText={(v) => set({ geraete: d.geraete.map((x, k) => (k === i ? { ...x, name: v } : x)) })} />
                <Stepper value={g.anzahl} min={1} disabled={ro} onChange={(n) => set({ geraete: d.geraete.map((x, k) => (k === i ? { ...x, anzahl: n } : x)) })} />
              </View>
            </View>
          ))}
          {d.geraete.length === 0 && ro && <Row label={<Text style={T.subhead}>keine</Text>} />}
          {!ro && <Row label="Gerät hinzufügen" icon="plus" iconBg="green" tone="accent" onPress={() => set({ geraete: [...d.geraete, { name: '', anzahl: 1 }] })} />}
        </Section>

        <Section title="Ausgeführte Leistungen">
          {d.leistungen.map((l, i) => (
            <View key={i}>
              {i > 0 && sep}
              <TextInput editable={!ro} multiline style={[input, { color: C.label }]} value={l.text} placeholder="z. B. Estrich 1. OG Nord eingebracht" placeholderTextColor={C.label3 as unknown as string}
                onChangeText={(v) => set({ leistungen: d.leistungen.map((x, k) => (k === i ? { text: v } : x)) })} />
            </View>
          ))}
          {!ro && <Row label="Leistung hinzufügen" icon="plus" iconBg="green" tone="accent" onPress={() => set({ leistungen: [...d.leistungen, { text: '' }] })} />}
        </Section>
        {area('Lieferungen', 'lieferungen')}
        {area('Behinderungen', 'behinderungen')}
        {area('Besonderheiten / Unfälle / Besuche', 'besonderheiten')}

        {ro && (
          <Section title="Nachträge" footer="Der unterschriebene Bericht bleibt unverändert; Nachträge werden mit Name und Zeit angehängt.">
            {nachtraege.map((n) => <Row key={n.id} label={n.text} subtitle={new Date(n.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} />)}
            {pendingNachtraege.map((n, i) => <Row key={`p${i}`} label={n.text} value={<Pill tint="orange">wartet auf Netz</Pill>} />)}
            <TextInput style={[input, { minHeight: 44, color: C.label }]} multiline value={nachtrag} onChangeText={setNachtrag} placeholder="Nachtrag schreiben …" placeholderTextColor={C.label3 as unknown as string} />
            <Row label="Nachtrag speichern" tone="accent" onPress={nachtrag.trim().length >= 3 ? () => void addNachtrag() : undefined} />
          </Section>
        )}

        <Section footer="Unterschriften dienen der Dokumentation; ob sie rechtsverbindlich sind, ist noch zu klären.">
          {!ro && <Row icon="signature" iconBg="blue" label="Unterschreiben und sperren" tone="accent" onPress={() => setSign('unterschreiben')} />}
          {ro && leitung && !countersigned && <Row icon="signature" iconBg="green" label="Gegenzeichnen" tone="accent" onPress={() => setSign('gegenzeichnen')} />}
          {ro && (countersigned || !leitung) && <Row icon="lock" iconBg="gray" label={countersigned ? 'Unterschrieben und gegengezeichnet' : 'Unterschrieben – wartet auf Gegenzeichnung'} />}
        </Section>
      </ScrollView>
      <Modal visible={!!sign} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setSign(null)}>
        <SignaturePad title={sign === 'gegenzeichnen' ? 'Gegenzeichnen' : 'Unterschreiben'} onCancel={() => setSign(null)} onDone={(s) => void onSigned(s)} />
      </Modal>
    </View>
  );
}

function Stepper({ value, onChange, min = 0, disabled }: { value: number; onChange: (n: number) => void; min?: number; disabled?: boolean }) {
  const btn = (label: string, n: number) => (
    <Pressable disabled={disabled} onPress={() => onChange(Math.max(min, n))} hitSlop={6}
      style={({ pressed }) => ({ width: 34, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.fill : 'transparent' })}>
      <Text style={[T.body, { color: disabled ? C.label3 : C.accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 10 }}>
      {!disabled && btn('−', value - 1)}
      <Text style={[T.body, { minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{value}</Text>
      {!disabled && btn('+', value + 1)}
    </View>
  );
}

/** Finger signature: strokes in 0..1 coordinates, drawn as short line segments (no native drawing module needed). */
export function SignaturePad({ title, onCancel, onDone }: { title: string; onCancel: () => void; onDone: (s: Signature) => void }) {
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [strokes, setStrokes] = useState<[number, number][][]>([]);
  const cur = useRef<[number, number][] | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const pt = (x: number, y: number): [number, number] => [Math.min(1, Math.max(0, x / sizeRef.current.w)), Math.min(1, Math.max(0, y / sizeRef.current.h))];
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        cur.current = [pt(e.nativeEvent.locationX, e.nativeEvent.locationY)];
        setStrokes((s) => [...s, cur.current!]);
      },
      onPanResponderMove: (e) => {
        if (!cur.current || cur.current.length >= 2000) return;
        const p = pt(e.nativeEvent.locationX, e.nativeEvent.locationY);
        const last = cur.current[cur.current.length - 1]!;
        if (Math.hypot((p[0] - last[0]) * sizeRef.current.w, (p[1] - last[1]) * sizeRef.current.h) < 2) return;
        cur.current.push(p);
        setStrokes((s) => [...s.slice(0, -1), [...cur.current!]]);
      },
      onPanResponderRelease: () => { cur.current = null; },
    }),
  ).current;
  const sig: Signature = { w: Math.round(size.w), h: Math.round(size.h), strokes: strokes.filter((s) => s.length >= 2).slice(0, 60) };
  const ok = sig.strokes.length > 0 && isPlausibleSignature(sig);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title={title} left="Abbrechen" onLeft={onCancel} right="Fertig" rightDisabled={!ok} onRight={() => onDone(sig)} />
      <View style={{ padding: 16, gap: 10 }}>
        <View {...pan.panHandlers} onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          style={{ height: 220, backgroundColor: C.card, borderRadius: 12, borderWidth: 0.5, borderColor: C.separator, overflow: 'hidden' }}>
          <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: 24, bottom: 50, height: 0.5, backgroundColor: C.separator }} />
          {strokes.flatMap((s, si) =>
            s.slice(1).map((p, i) => {
              const a = s[i]!;
              const x1 = a[0] * size.w, y1 = a[1] * size.h, x2 = p[0] * size.w, y2 = p[1] * size.h;
              const len = Math.hypot(x2 - x1, y2 - y1);
              return (
                <View key={`${si}-${i}`} pointerEvents="none" style={{
                  position: 'absolute', left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1.2, width: len + 1.2, height: 2.4, borderRadius: 1.2, backgroundColor: C.label,
                  transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
                }} />
              );
            }),
          )}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[T.footnote, { flex: 1 }]}>Mit dem Finger unterschreiben. Danach ist der Bericht gesperrt.</Text>
          <Pressable onPress={() => setStrokes([])} hitSlop={8}><Text style={[T.body, { color: C.accent }]}>Löschen</Text></Pressable>
        </View>
      </View>
    </View>
  );
}
