/**
 * NU-Besprechung on the tablet (docs/fachkonzept/09): everything works offline.
 * - Status chips: tap Offen → In Arbeit → Erledigt. Recorded as punkt_action (upload queue) and shown
 *   immediately as "vorgemerkt"; the server applies it only if the Punkt is unchanged.
 * - New Punkte: created locally with a device id; the server assigns the number on upload.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { usePowerSync, useQuery } from '@powersync/react';
import { besprechungNo, formatDate, nextPunktStatus, punktNo, PUNKT_STATUS, PUNKT_STATUS_LABELS, PUNKT_TONE, type ProjectRole, type PunktStatus } from '@bap/domain';
import { C, T, TINT, type Tint } from './theme';
import { Pill, Row, Section, Segmented, SheetBar } from './ui';

const TONE_TINT: Record<string, Tint> = { red: 'red', orange: 'orange', green: 'green', blue: 'blue', gray: 'gray' };

type PunktRow = {
  id: string;
  number: number | null;
  first_besprechung_id: string;
  location_id: string | null;
  location_name: string | null;
  location_sort: number | null;
  text: string;
  responsible_name: string | null;
  status: PunktStatus;
  status_snapshot: PunktStatus | null;
  due_date: string | null;
  internal: number;
  carried: number | null;
  version: number;
};

export function BesprechungTab({ projectId, role, userId, header }: { projectId: string; role: ProjectRole; userId: string; header: (eyebrow: string) => ReactNode }) {
  const db = usePowerSync();
  const { data: meetings } = useQuery<{ id: string; number: number; title: string; held_at: string; place: string | null; status: string }>(
    'SELECT id, number, title, held_at, place, status FROM besprechung WHERE project_id = ? ORDER BY held_at DESC LIMIT 4',
    [projectId],
  );
  const [idx, setIdx] = useState(0);
  const m = meetings[idx] ?? meetings[0];
  const mid = m?.id ?? '';
  // Punkte of this meeting (via eintrag) plus Punkte created here on the device and not uploaded yet (no eintrag yet).
  const { data: punkte } = useQuery<PunktRow>(
    `SELECT p.*, l.name AS location_name, l.sort AS location_sort, c.name AS responsible_name, e.carried, e.status_snapshot
     FROM besprechung_punkt p
     LEFT JOIN besprechung_eintrag e ON e.punkt_id = p.id AND e.besprechung_id = ?
     LEFT JOIN location l ON l.id = p.location_id LEFT JOIN company c ON c.id = p.responsible_company_id
     WHERE e.besprechung_id IS NOT NULL OR (p.first_besprechung_id = ? AND p.number IS NULL)
     ORDER BY l.sort, p.number`,
    [mid, mid],
  );
  const { data: pending } = useQuery<{ punkt_id: string; status: PunktStatus; base_version: number }>('SELECT punkt_id, status, base_version FROM pending_punkt');
  const [adding, setAdding] = useState(false);

  // A pending chip is done once the server version moved past its base (applied) – or a conflict arrived (see Hinweise).
  useEffect(() => {
    for (const p of pending) {
      const cur = punkte.find((x) => x.id === p.punkt_id);
      if (cur && cur.version > p.base_version) void db.execute('DELETE FROM pending_punkt WHERE punkt_id = ?', [p.punkt_id]);
    }
  }, [pending, punkte, db]);

  const internal = role === 'bauleitung' || role === 'polier';
  const editable = internal && m?.status === 'entwurf';
  const groups = useMemo(() => {
    const map = new Map<string, PunktRow[]>();
    for (const p of punkte) {
      const k = p.location_name ?? 'Allgemein';
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Allgemein' ? -1 : b === 'Allgemein' ? 1 : a.localeCompare(b, 'de')));
  }, [punkte]);

  const tap = async (p: PunktRow) => {
    const shown = pending.find((x) => x.punkt_id === p.id)?.status ?? p.status;
    const to = nextPunktStatus(shown);
    const now = new Date().toISOString();
    await db.writeTransaction(async (tx) => {
      if (p.number == null) {
        // Not uploaded yet: just change the local row, it goes up with the new status.
        await tx.execute('UPDATE besprechung_punkt SET status = ? WHERE id = ?', [to, p.id]);
        return;
      }
      await tx.execute('INSERT INTO punkt_action (id, punkt_id, payload, base_version, occurred_at) VALUES (?, ?, ?, ?, ?)', [
        Crypto.randomUUID(), p.id, JSON.stringify({ status: to }), p.version, now,
      ]);
      await tx.execute('DELETE FROM pending_punkt WHERE punkt_id = ?', [p.id]);
      await tx.execute('INSERT INTO pending_punkt (id, punkt_id, status, base_version, occurred_at) VALUES (?, ?, ?, ?, ?)', [Crypto.randomUUID(), p.id, to, p.version, now]);
    });
  };

  if (!m) {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {header('Noch keine Besprechung')}
        <Text style={[T.subhead, { textAlign: 'center', padding: 40 }]}>Besprechungen werden in der Web-Ansicht angelegt.</Text>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {header(`${m.title} ${besprechungNo(m.number)} · ${formatDate(m.held_at)}`)}
        <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 18 }}>
          {meetings.length > 1 && <Segmented values={meetings.map((x) => besprechungNo(x.number))} index={idx} onChange={setIdx} />}
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill tint={m.status === 'versendet' ? 'green' : 'orange'}>{m.status === 'versendet' ? 'Versendet · gesperrt' : 'Entwurf · in Bearbeitung'}</Pill>
            {editable && (
              <Pressable onPress={() => setAdding(true)} hitSlop={8}>
                <Text style={[T.body, { color: C.accent, fontWeight: '600' }]}>+ Punkt</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={{ paddingHorizontal: 16 }}>
          {groups.map(([name, list]) => (
            <Section key={name} title={name}>
              {list.map((p) => {
                const pend = pending.find((x) => x.punkt_id === p.id);
                const st = m.status === 'versendet' ? (p.status_snapshot ?? p.status) : (pend?.status ?? p.status);
                const tone = TONE_TINT[PUNKT_TONE[st]]!;
                return (
                  <View key={p.id} style={s.row}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <Text style={[T.footnote, { fontVariant: ['tabular-nums'] }]}>{punktNo(p.number)}</Text>
                        {!!p.carried && <Pill tint="gray">W</Pill>}
                        {!!p.internal && <Pill tint="red">intern</Pill>}
                        {p.number == null && <Pill tint="orange">noch nicht übertragen</Pill>}
                      </View>
                      <Text style={T.callout}>{p.text}</Text>
                      <Text style={T.footnote}>
                        {p.responsible_name ?? '–'}
                        {p.due_date ? ` · Frist ${formatDate(p.due_date)}` : ''}
                      </Text>
                      {pend && <Text style={[T.caption, { color: TINT.orange }]}>vorgemerkt – wird beim Abgleich geprüft</Text>}
                    </View>
                    <Pressable
                      disabled={!editable || st === 'info'}
                      onPress={() => void tap(p)}
                      style={({ pressed }) => [s.chip, { backgroundColor: `${TINT[tone]}24`, opacity: pressed ? 0.6 : 1 }]}
                      hitSlop={6}
                    >
                      <View style={[s.dot, { backgroundColor: TINT[tone] }]} />
                      <Text style={[s.chipText, { color: TINT[tone] }]}>{PUNKT_STATUS_LABELS[st]}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </Section>
          ))}
          {editable && <Text style={[T.footnote, { marginHorizontal: 16 }]}>Status antippen: Offen → In Arbeit → Erledigt. Funktioniert auch ohne Netz.</Text>}
        </View>
      </ScrollView>
      <Modal visible={adding} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAdding(false)}>
        {adding && <NewPunkt projectId={projectId} besprechungId={m.id} userId={userId} onClose={() => setAdding(false)} />}
      </Modal>
    </View>
  );
}

function NewPunkt({ projectId, besprechungId, userId, onClose }: { projectId: string; besprechungId: string; userId: string; onClose: () => void }) {
  const db = usePowerSync();
  const { data: orte } = useQuery<{ id: string; name: string }>("SELECT id, name FROM location WHERE project_id = ? AND kind IN ('geschoss', 'abschnitt') ORDER BY sort", [projectId]);
  const { data: firmen } = useQuery<{ id: string; name: string }>(
    'SELECT DISTINCT c.id, c.name FROM company c JOIN project_member pm ON pm.company_id = c.id WHERE pm.project_id = ? ORDER BY c.name',
    [projectId],
  );
  const [text, setText] = useState('');
  const [ort, setOrt] = useState<string | null>(null);
  const [firma, setFirma] = useState<string | null>(null);
  const [status, setStatus] = useState<PunktStatus>('offen');
  const save = async () => {
    if (!text.trim()) return;
    await db.execute(
      `INSERT INTO besprechung_punkt (id, project_id, first_besprechung_id, location_id, text, responsible_company_id, support_company_ids, status, internal, version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 0, 0, ?, ?)`,
      [Crypto.randomUUID(), projectId, besprechungId, ort, text.trim(), firma, status, userId, new Date().toISOString()],
    );
    onClose();
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Neuer Punkt" left="Abbrechen" onLeft={onClose} right="Sichern" rightDisabled={!text.trim()} onRight={save} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Section>
          <TextInput
            style={[T.body, { minHeight: 90, padding: 16, paddingTop: 14, textAlignVertical: 'top' }]}
            multiline
            autoFocus
            value={text}
            onChangeText={setText}
            placeholder="Aufgabe, z. B. „Raum 04.035 fertigstellen“"
            placeholderTextColor={C.label3 as unknown as string}
          />
        </Section>
        <Section title="Status">
          <View style={{ padding: 10 }}>
            <Segmented values={PUNKT_STATUS.map((x) => PUNKT_STATUS_LABELS[x])} index={PUNKT_STATUS.indexOf(status)} onChange={(i) => setStatus(PUNKT_STATUS[i]!)} />
          </View>
        </Section>
        <Section title="Ort">
          <Row label="Allgemein" checked={ort === null} onPress={() => setOrt(null)} />
          {orte.map((o) => (
            <Row key={o.id} label={o.name} checked={ort === o.id} onPress={() => setOrt(o.id)} />
          ))}
        </Section>
        <Section title="Verantwortlich" footer="Gewerk, Zuarbeit und Frist lassen sich in der Web-Ansicht ergänzen. Der Punkt wird auch ohne Netz gespeichert.">
          {firmen.map((f) => (
            <Row key={f.id} label={f.name} checked={firma === f.id} onPress={() => setFirma(firma === f.id ? null : f.id)} />
          ))}
        </Section>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
