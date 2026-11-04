import '@azure/core-asynciterator-polyfill';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { PowerSyncContext, usePowerSync, useQuery, useStatus } from '@powersync/react';
import type { PowerSyncDatabase } from '@powersync/react-native';
import {
  allowedTransitions,
  escalation,
  formatDate,
  MANGEL_STATUS_LABELS,
  PRIORITIES,
  ROLE_LABELS,
  type MangelStatus,
  type Priority,
  type ProjectRole,
} from '@bap/domain';
import { Connector, openDatabase } from './src/db';
import { PlanScreen } from './src/PlanScreen';
import type { MangelRow } from './src/schema';
import { loadSession, login, logout, type Session } from './src/session';

const BLUE = '#0a2463';
const AMPEL = { rot: '#d92d20', gelb: '#f5b400', gruen: '#12a150', grau: '#98a2b3' };
const TEST_USERS = [
  ['polier@example.test', 'Paul Polier', 'Polier'],
  ['bauleitung@example.test', 'Bea Bauleitung', 'Bauleitung'],
  ['elektro@example.test', 'Erik Elektro', 'NU Elektro Blitz'],
  ['fliesen@example.test', 'Fiona Fliesen', 'NU Fliesen Fuchs'],
  ['bauherr@example.test', 'Hanna Bauherr', 'Bauherr'],
] as const;

type Mangel = MangelRow & { id: string; location_name: string | null; gewerk_name: string | null; company_name: string | null };
const mNo = (m: { number: number | null }) => (m.number ? `M-${String(m.number).padStart(3, '0')}` : 'neu');
const escOf = (m: MangelRow) =>
  escalation({ status: (m.status ?? 'neu') as MangelStatus, due_date: m.due_date ?? null, nachfrist_date: m.nachfrist_date ?? null, priority: (m.priority ?? 'normal') as Priority });

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [db, setDb] = useState<PowerSyncDatabase | null>(null);

  useEffect(() => {
    void (async () => {
      setDb(await openDatabase());
      setSession(await loadSession());
    })();
  }, []);

  useEffect(() => {
    if (!db || !session) return;
    void db.connect(new Connector(session, `ios-${session.userId.slice(-4)}`));
    return () => void db.disconnect();
  }, [db, session]);

  if (!db || session === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!session) return <Login onLogin={setSession} />;
  return (
    <PowerSyncContext.Provider value={db}>
      <Main
        session={session}
        onLogout={async () => {
          await db.disconnectAndClear(); // device data belongs to the user: remove on logout
          await logout();
          setSession(null);
        }}
      />
    </PowerSyncContext.Provider>
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <SafeAreaView style={styles.login}>
      <Text style={styles.h1}>Bau Akte Pro</Text>
      <Text style={styles.hint}>Durchstich – Testbenutzer wählen</Text>
      {TEST_USERS.map(([email, name, role]) => (
        <Pressable key={email} style={styles.loginBtn} onPress={() => login(email).then(onLogin, (e) => setError(String(e.message ?? e)))}>
          <Text style={styles.bold}>{name}</Text>
          <Text style={styles.hint}>{role}</Text>
        </Pressable>
      ))}
      {error && <Text style={styles.error}>{error}</Text>}
    </SafeAreaView>
  );
}

function SyncBar() {
  const status = useStatus();
  const { data: queue } = useQuery<{ n: number }>('SELECT count(*) AS n FROM ps_crud');
  const pending = queue[0]?.n ?? 0;
  const color = status.connected ? (pending ? AMPEL.gelb : AMPEL.gruen) : AMPEL.rot;
  const text = status.connected
    ? pending ? `Online · ${pending} Änderung(en) werden übertragen` : 'Online · alles abgeglichen'
    : `Offline · ${pending} Änderung(en) warten${status.lastSyncedAt ? ` · Stand ${status.lastSyncedAt.toLocaleTimeString('de-DE')}` : ''}`;
  return (
    <View style={styles.syncBar}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.syncText}>{text}</Text>
    </View>
  );
}

function Main({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const db = usePowerSync();
  const status = useStatus();
  const { data: memberships } = useQuery<{ project_id: string; role: ProjectRole; company_id: string; name: string }>(
    'SELECT pm.project_id, pm.role, pm.company_id, p.name FROM project_member pm JOIN project p ON p.id = pm.project_id WHERE pm.user_id = ? ORDER BY p.name DESC',
    [session.userId],
  );
  const [projectId, setProjectId] = useState<string | null>(null);
  const me = memberships.find((m) => m.project_id === projectId) ?? memberships[0];
  const pid = me?.project_id ?? '';

  const { data: maengel } = useQuery<Mangel>(
    `SELECT m.*, l.name AS location_name, g.name AS gewerk_name, c.name AS company_name
     FROM mangel m LEFT JOIN location l ON l.id = m.location_id LEFT JOIN gewerk g ON g.id = m.gewerk_id LEFT JOIN company c ON c.id = m.assigned_company_id
     WHERE m.project_id = ? ORDER BY coalesce(m.number, 9999), m.created_at`,
    [pid],
  );
  const { data: plans } = useQuery<{ id: string; name: string; plan_index: string }>('SELECT id, name, plan_index FROM plan WHERE project_id = ?', [pid]);
  const { data: pending } = useQuery<{ id: string; mangel_id: string; payload: string; base_version: number }>('SELECT * FROM pending_action');
  const { data: conflicts } = useQuery<{ id: string; reason: string; kind: string }>('SELECT * FROM sync_conflict WHERE project_id = ? ORDER BY created_at DESC', [pid]);

  // A pending decision is done once the server version moved past its base (applied or rejected → see conflicts).
  const { data: myConflicts } = useQuery<{ entity_id: string; created_at: string }>('SELECT entity_id, created_at FROM sync_conflict');
  useEffect(() => {
    for (const p of pending) {
      const m = maengel.find((x) => x.id === p.mangel_id);
      const applied = m && (m.version ?? 0) > p.base_version;
      const refused = myConflicts.some((c) => c.entity_id === p.mangel_id && new Date(c.created_at) >= new Date((p as { occurred_at?: string }).occurred_at ?? 0));
      if (applied || refused) void db.execute('DELETE FROM pending_action WHERE id = ?', [p.id]);
    }
  }, [pending, maengel, myConflicts, db]);

  const [tab, setTab] = useState<'liste' | 'plan' | 'konflikte'>('liste');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: number; x: number; y: number } | null>(null);
  const current = maengel.find((m) => m.id === selected);

  if (!me) {
    return (
      <SafeAreaView style={styles.center}>
        <SyncBar />
        <Text style={styles.hint}>{status.hasSynced ? 'Keine Projekte.' : 'Erster Abgleich läuft …'}</Text>
        <Pressable onPress={onLogout}><Text style={styles.link}>Abmelden</Text></Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => memberships.length > 1 && setProjectId(memberships[(memberships.indexOf(me) + 1) % memberships.length]!.project_id)}>
          <Text style={styles.headerTitle}>{me.name} {memberships.length > 1 ? '⇄' : ''}</Text>
          <Text style={styles.headerSub}>{ROLE_LABELS[me.role]} · {session.email}</Text>
        </Pressable>
        <Pressable onPress={onLogout}><Text style={styles.headerLink}>Abmelden</Text></Pressable>
      </View>
      <SyncBar />
      <View style={styles.tabs}>
        {(['liste', 'plan', 'konflikte'] as const).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'liste' ? `Mängel (${maengel.length})` : t === 'plan' ? 'Plan' : `Hinweise (${conflicts.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'liste' && (
        <FlatList
          data={maengel}
          keyExtractor={(m) => m.id}
          ListEmptyComponent={<Text style={[styles.hint, { padding: 20 }]}>Keine Mängel.</Text>}
          renderItem={({ item: m }) => {
            const e = escOf(m);
            const p = pending.find((x) => x.mangel_id === m.id);
            return (
              <Pressable style={styles.row} onPress={() => setSelected(m.id)}>
                <View style={[styles.dot, { backgroundColor: AMPEL[e.ampel], marginTop: 6 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bold}>{mNo(m)} · {m.description}</Text>
                  <Text style={styles.hint}>{m.location_name} · {m.gewerk_name} · {m.company_name ?? '–'}{m.assigned_company_id && !m.assignment_confirmed ? ' (Vorschlag)' : ''}</Text>
                  <Text style={styles.hint}>{MANGEL_STATUS_LABELS[(m.status ?? 'neu') as MangelStatus]} · {e.label}</Text>
                  {p && <Text style={styles.pending}>Vorgemerkt: → {MANGEL_STATUS_LABELS[JSON.parse(p.payload).to as MangelStatus]}</Text>}
                  {!m.number && <Text style={styles.pending}>Noch nicht übertragen</Text>}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      {tab === 'plan' && plans[0] && (
        <View style={{ flex: 1 }}>
          <Text style={[styles.hint, { padding: 8 }]}>{plans[0].name} · Index {plans[0].plan_index} – Tippen erfasst einen Mangel</Text>
          <PlanScreen planId={plans[0].id} token={session.token} maengel={maengel} ampel={(m) => escOf(m).ampel} onSelect={setSelected} onPick={setDraft} />
        </View>
      )}

      {tab === 'konflikte' && (
        <ScrollView style={{ padding: 12 }}>
          {conflicts.length === 0 && <Text style={styles.hint}>Keine offenen Hinweise.</Text>}
          {conflicts.map((c) => (
            <View key={c.id} style={[styles.card, { borderLeftColor: c.kind === 'conflict' ? AMPEL.gelb : AMPEL.rot }]}>
              <Text style={styles.bold}>{c.kind === 'conflict' ? 'Konflikt' : 'Nicht übernommen'}</Text>
              <Text>{c.reason}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!current} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        {current && (
          <Detail
            m={current}
            me={{ role: me.role, userId: session.userId, companyId: me.company_id }}
            pendingFor={pending.find((p) => p.mangel_id === current.id)}
            onClose={() => setSelected(null)}
          />
        )}
      </Modal>
      <Modal visible={!!draft} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDraft(null)}>
        {draft && <NewMangel projectId={pid} planId={plans[0]?.id ?? null} pos={draft} me={{ role: me.role, userId: session.userId, companyId: me.company_id }} onClose={() => setDraft(null)} />}
      </Modal>
    </SafeAreaView>
  );
}

type Me = { role: ProjectRole; userId: string; companyId: string };

function Detail({ m, me, pendingFor, onClose }: { m: Mangel; me: Me; pendingFor?: { payload: string }; onClose: () => void }) {
  const db = usePowerSync();
  const { data: notes } = useQuery<{ id: string; text: string }>('SELECT id, text FROM mangel_note WHERE mangel_id = ?', [m.id]);
  const e = escOf(m);
  const transitions = m.number
    ? allowedTransitions(me, { status: (m.status ?? 'neu') as MangelStatus, createdBy: m.created_by ?? '', creatorRole: (m.creator_role ?? 'polier') as ProjectRole, assignedCompanyId: m.assigned_company_id ?? null })
    : [];

  /** Record the decision locally; it is uploaded when online and applied only if the Mangel is unchanged. */
  const decide = async (to: MangelStatus) => {
    const row = [Crypto.randomUUID(), m.id, 'transition', JSON.stringify({ to }), m.version ?? 1, new Date().toISOString()];
    await db.writeTransaction(async (tx) => {
      await tx.execute('INSERT INTO mangel_action (id, mangel_id, action, payload, base_version, occurred_at) VALUES (?, ?, ?, ?, ?, ?)', row);
      await tx.execute('INSERT INTO pending_action (id, mangel_id, action, payload, base_version, occurred_at) VALUES (?, ?, ?, ?, ?, ?)', row);
    });
    onClose();
  };

  return (
    <ScrollView style={styles.sheet}>
      <View style={styles.sheetHead}>
        <Text style={styles.h2}>{mNo(m)}</Text>
        <Pressable onPress={onClose}><Text style={styles.link}>Schließen</Text></Pressable>
      </View>
      <Text style={styles.desc}>{m.description}</Text>
      {[
        ['Status', MANGEL_STATUS_LABELS[(m.status ?? 'neu') as MangelStatus]],
        ['Ort', m.location_name],
        ['Gewerk', m.gewerk_name],
        ['Nachunternehmer', `${m.company_name ?? '–'}${m.assigned_company_id && !m.assignment_confirmed ? ' (Vorschlag)' : ''}`],
        ['Priorität', m.priority],
        ['Frist', `${formatDate(m.due_date)}${m.nachfrist_date ? ` · 2. Nachfrist ${formatDate(m.nachfrist_date)}` : ''}`],
        ['Eskalation', e.label],
      ].map(([k, v]) => (
        <View key={k} style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={styles.v}>{v ?? '–'}</Text></View>
      ))}
      {pendingFor && <Text style={styles.pending}>Vorgemerkt: → {MANGEL_STATUS_LABELS[JSON.parse(pendingFor.payload).to as MangelStatus]} (wird beim Abgleich geprüft)</Text>}
      {!pendingFor && (
        <View style={styles.actions}>
          {transitions.filter((t) => t !== 'zugewiesen').map((t) => (
            <Pressable key={t} style={styles.btn} onPress={() => decide(t)}><Text style={styles.btnText}>→ {MANGEL_STATUS_LABELS[t]}</Text></Pressable>
          ))}
          {transitions.length === 0 && <Text style={styles.hint}>Keine Statuswechsel für Ihre Rolle möglich.</Text>}
        </View>
      )}
      {notes.length > 0 && (
        <View style={styles.notes}>
          <Text style={styles.bold}>Interne Notizen</Text>
          {notes.map((n) => <Text key={n.id}>{n.text}</Text>)}
        </View>
      )}
    </ScrollView>
  );
}

function NewMangel({ projectId, planId, pos, me, onClose }: { projectId: string; planId: string | null; pos: { page: number; x: number; y: number }; me: Me; onClose: () => void }) {
  const db = usePowerSync();
  const { data: rooms } = useQuery<{ id: string; name: string }>("SELECT id, name FROM location WHERE project_id = ? AND kind = 'raum' ORDER BY sort", [projectId]);
  const { data: gewerke } = useQuery<{ id: string; name: string; company_id: string | null }>(
    'SELECT g.id, g.name, gc.company_id FROM gewerk g LEFT JOIN gewerk_company gc ON gc.gewerk_id = g.id WHERE g.project_id = ? ORDER BY g.name',
    [projectId],
  );
  const [description, setDescription] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [gewerk, setGewerk] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>('normal');
  const roomId = room ?? rooms[0]?.id;
  const g = useMemo(() => gewerke.find((x) => x.id === (gewerk ?? gewerke[0]?.id)), [gewerke, gewerk]);

  const save = async () => {
    if (!description.trim() || !roomId || !g) return;
    // Local insert with a device-generated id. Number, status and confirmation are set by the server on upload.
    await db.execute(
      `INSERT INTO mangel (id, project_id, location_id, gewerk_id, description, priority, status, plan_id, pin_page, pin_x, pin_y,
         assigned_company_id, assignment_confirmed, reporter_company_id, created_by, creator_role, created_at, version, visible_to_bauherr)
       VALUES (?, ?, ?, ?, ?, ?, 'neu', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 0)`,
      [Crypto.randomUUID(), projectId, roomId, g.id, description.trim(), priority, planId, pos.page, pos.x, pos.y, g.company_id, me.companyId, me.userId, me.role, new Date().toISOString()],
    );
    onClose();
  };

  return (
    <ScrollView style={styles.sheet}>
      <View style={styles.sheetHead}>
        <Text style={styles.h2}>Neuer Mangel</Text>
        <Pressable onPress={onClose}><Text style={styles.link}>Abbrechen</Text></Pressable>
      </View>
      <Text style={styles.k}>Beschreibung *</Text>
      <TextInput style={styles.input} multiline value={description} onChangeText={setDescription} placeholder="Was ist der Mangel?" />
      <Text style={styles.k}>Ort *</Text>
      <Chips items={rooms} value={roomId} onChange={setRoom} />
      <Text style={styles.k}>Gewerk *</Text>
      <Chips items={gewerke} value={g?.id} onChange={setGewerk} />
      <Text style={styles.k}>Priorität</Text>
      <Chips items={PRIORITIES.map((p) => ({ id: p, name: p }))} value={priority} onChange={(p) => setPriority(p as Priority)} />
      <Pressable style={[styles.btn, styles.primary, !description.trim() && { opacity: 0.4 }]} onPress={save}>
        <Text style={[styles.btnText, { color: '#fff' }]}>Speichern (auch offline)</Text>
      </Pressable>
    </ScrollView>
  );
}

function Chips({ items, value, onChange }: { items: { id: string; name: string }[]; value?: string; onChange: (id: string) => void }) {
  return (
    <View style={styles.chips}>
      {items.map((i) => (
        <Pressable key={i.id} style={[styles.chip, value === i.id && styles.chipActive]} onPress={() => onChange(i.id)}>
          <Text style={value === i.id ? { color: '#fff' } : undefined}>{i.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f5f6f8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  login: { flex: 1, padding: 24, gap: 10, justifyContent: 'center', backgroundColor: '#f5f6f8' },
  loginBtn: { backgroundColor: '#fff', borderRadius: 10, padding: 16, borderWidth: 1, borderColor: '#dde1e7' },
  h1: { fontSize: 28, fontWeight: '700', color: BLUE },
  h2: { fontSize: 22, fontWeight: '700' },
  bold: { fontWeight: '600', fontSize: 15 },
  hint: { color: '#667085', fontSize: 13 },
  error: { color: '#d92d20' },
  link: { color: BLUE, fontWeight: '600' },
  header: { backgroundColor: BLUE, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  headerLink: { color: '#fff' },
  syncBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#dde1e7' },
  syncText: { fontSize: 12, color: '#344054' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tabs: { flexDirection: 'row', gap: 6, padding: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dde1e7' },
  tabActive: { backgroundColor: BLUE, borderColor: BLUE },
  tabText: { color: '#1c2230' },
  tabTextActive: { color: '#fff' },
  row: { flexDirection: 'row', gap: 10, backgroundColor: '#fff', padding: 14, borderBottomWidth: 1, borderColor: '#eef0f3' },
  pending: { color: '#b54708', fontSize: 13, marginTop: 4, fontWeight: '600' },
  card: { backgroundColor: '#fff', padding: 12, borderRadius: 8, borderLeftWidth: 4, marginBottom: 10, gap: 4 },
  sheet: { flex: 1, padding: 20, backgroundColor: '#fff' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  desc: { fontSize: 17, marginBottom: 12 },
  kv: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#eef0f3' },
  k: { width: 140, color: '#667085', marginTop: 10 },
  v: { flex: 1, marginTop: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  btn: { borderWidth: 1, borderColor: BLUE, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  primary: { backgroundColor: BLUE, alignItems: 'center', marginTop: 20 },
  btnText: { color: BLUE, fontWeight: '600' },
  notes: { marginTop: 16, backgroundColor: '#fff8e6', padding: 10, borderRadius: 8, gap: 4 },
  input: { borderWidth: 1, borderColor: '#dde1e7', borderRadius: 8, padding: 10, minHeight: 80, marginTop: 6, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: '#dde1e7', borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  chipActive: { backgroundColor: BLUE, borderColor: BLUE },
});
