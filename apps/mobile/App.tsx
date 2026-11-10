import '@azure/core-asynciterator-polyfill';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, LogBox, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { BlurView } from 'expo-blur';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PowerSyncContext, usePowerSync, useQuery, useStatus } from '@powersync/react';
import type { PowerSyncDatabase } from '@powersync/react-native';
import {
  allowedTransitions,
  anzeigeNo,
  roomAt,
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
import { BesprechungTab } from './src/BesprechungTab';
import { PlanScreen } from './src/PlanScreen';
import { clearPlanFiles, usePlanFiles, type PlanFiles } from './src/planStore';
import type { MangelRow } from './src/schema';
import { loadSession, login, logout, type Session } from './src/session';
import { AMPEL_TINT, C, STATUS_TINT, T, TINT, type Tint } from './src/theme';
import { Pill, Row, SearchField, Section, Segmented, SheetBar } from './src/ui';

// Being offline on site is the normal case, not an error: keep the dev overlay quiet about it.
LogBox.ignoreLogs(['[PowerSync]: Sync error', '[PowerSync]: Could not POST streaming', 'Initial connect attempt']);

const TEST_USERS = [
  ['polier@example.test', 'Paul Polier', 'Polier'],
  ['bauleitung@example.test', 'Bea Bauleitung', 'Bauleitung'],
  ['elektro@example.test', 'Erik Elektro', 'NU Elektro Blitz'],
  ['fliesen@example.test', 'Fiona Fliesen', 'NU Fliesen Fuchs'],
  ['bauherr@example.test', 'Hanna Bauherr', 'Bauherr'],
] as const;

const PRIORITY_LABELS: Record<Priority, string> = { kritisch: 'Kritisch', normal: 'Normal', gering: 'Gering' };

/** Modules of the full product that are not built yet (CLAUDE.md, Umsetzungsreihenfolge). */
const COMING: [SFSymbol, Tint, string][] = [
  ['folder', 'blue', 'Dokumente'],
  ['building.2', 'gray', 'Nachunternehmer'],
  ['doc.plaintext', 'teal', 'Rechnungen'],
  ['chart.bar', 'green', 'Kosten'],
  ['cart', 'orange', 'Einkäufe'],
  ['car', 'purple', 'Fahrtenbuch'],
];

type Mangel = MangelRow & { id: string; location_name: string | null; gewerk_name: string | null; company_name: string | null };
const mNo = (m: { number: number | null }) => (m.number ? `M-${String(m.number).padStart(3, '0')}` : 'Neu');
const statusOf = (m: MangelRow) => (m.status ?? 'neu') as MangelStatus;
const escOf = (m: MangelRow) =>
  escalation({ status: statusOf(m), due_date: m.due_date ?? null, nachfrist_date: m.nachfrist_date ?? null, priority: (m.priority ?? 'normal') as Priority });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {!db || session === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} />
      ) : !session ? (
        <Login onLogin={setSession} />
      ) : (
        <PowerSyncContext.Provider value={db}>
          <Main
            session={session}
            onLogout={async () => {
              await db.disconnectAndClear(); // device data belongs to the user: remove on logout
              clearPlanFiles();
              await logout();
              setSession(null);
            }}
          />
        </PowerSyncContext.Provider>
      )}
    </SafeAreaProvider>
  );
}

function AppIcon({ size = 72 }: { size?: number }) {
  return (
    <View style={[st.appIcon, { width: size, height: size, borderRadius: size * 0.225 }]}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.36 }}>BA</Text>
    </View>
  );
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={[st.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: '#fff', fontWeight: '600', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={[st.login, { paddingTop: insets.top + 60 }]}>
      <AppIcon />
      <Text style={[T.largeTitle, { textAlign: 'center', marginTop: 18 }]}>Bau Akte Pro</Text>
      <Text style={[T.subhead, { textAlign: 'center', marginTop: 6, marginBottom: 32 }]}>Als Testbenutzer anmelden</Text>
      <Section footer="Nur für die lokale Entwicklung, ohne Passwort.">
        {TEST_USERS.map(([email, name, role]) => (
          <Row
            key={email}
            label={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar name={name} size={36} />
                <View>
                  <Text style={T.body}>{name}</Text>
                  <Text style={T.footnote}>{role}</Text>
                </View>
              </View>
            }
            value={busy === email ? <ActivityIndicator /> : undefined}
            chevron={busy !== email}
            onPress={() => {
              setBusy(email);
              login(email).then(onLogin, (e) => {
                setBusy(null);
                setError(String(e.message ?? e));
              });
            }}
          />
        ))}
      </Section>
      {error && <Text style={[T.footnote, { color: C.red, textAlign: 'center' }]}>{error}</Text>}
    </ScrollView>
  );
}

function useSyncState() {
  const status = useStatus();
  const { data: queue } = useQuery<{ n: number }>('SELECT count(*) AS n FROM ps_crud');
  const pending = queue[0]?.n ?? 0;
  const tint: Tint = status.connected ? (pending ? 'orange' : 'green') : 'red';
  const short = status.connected ? (pending ? `${pending} ausstehend` : 'Abgeglichen') : pending ? `Offline · ${pending} warten` : 'Offline';
  return { status, pending, tint, short };
}

function SyncPill() {
  const { tint, short } = useSyncState();
  return (
    <Pill tint={tint} dot>
      {short}
    </Pill>
  );
}

function LargeHeader({ eyebrow, title, right, children }: { eyebrow?: string; title: string; right?: ReactNode; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          {eyebrow && <Text style={T.footnote}>{eyebrow}</Text>}
          <Text style={T.largeTitle}>{title}</Text>
        </View>
        <View style={{ marginBottom: 8 }}>{right}</View>
      </View>
      {children}
    </View>
  );
}

type Tab = 'maengel' | 'plaene' | 'besprechung' | 'hinweise' | 'mehr';
const TABS: [Tab, SFSymbol, string][] = [
  ['maengel', 'exclamationmark.triangle', 'Mängel'],
  ['plaene', 'map', 'Pläne'],
  ['besprechung', 'person.2', 'Besprechung'],
  ['hinweise', 'bell', 'Hinweise'],
  ['mehr', 'ellipsis.circle', 'Mehr'],
];

function TabBar({ tab, onTab, badges }: { tab: Tab; onTab: (t: Tab) => void; badges: Partial<Record<Tab, number>> }) {
  const insets = useSafeAreaInsets();
  return (
    <BlurView intensity={90} tint="systemChromeMaterial" style={[st.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map(([id, icon, label]) => {
        const active = tab === id;
        return (
          <Pressable key={id} style={st.tabItem} onPress={() => onTab(id)}>
            <View>
              <SymbolView name={icon} type={active ? 'monochrome' : 'monochrome'} size={24} tintColor={active ? C.accent : C.gray} />
              {!!badges[id] && (
                <View style={st.badge}>
                  <Text style={st.badgeText}>{badges[id]}</Text>
                </View>
              )}
            </View>
            <Text style={[st.tabLabel, { color: active ? C.accent : C.gray }]}>{label}</Text>
          </Pressable>
        );
      })}
    </BlurView>
  );
}

type Me = { role: ProjectRole; userId: string; companyId: string };
type Pending = { id: string; mangel_id: string; payload: string; base_version: number; occurred_at?: string };

function Main({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const db = usePowerSync();
  const { status } = useSyncState();
  const { data: memberships } = useQuery<{ project_id: string; role: ProjectRole; company_id: string; name: string }>(
    'SELECT pm.project_id, pm.role, pm.company_id, p.name FROM project_member pm JOIN project p ON p.id = pm.project_id WHERE pm.user_id = ? ORDER BY p.name DESC',
    [session.userId],
  );
  const [projectId, setProjectId] = useState<string | null>(null);
  const membership = memberships.find((m) => m.project_id === projectId) ?? memberships[0];
  const pid = membership?.project_id ?? '';

  const { data: maengel } = useQuery<Mangel>(
    `SELECT m.*, l.name AS location_name, g.name AS gewerk_name, c.name AS company_name
     FROM mangel m LEFT JOIN location l ON l.id = m.location_id LEFT JOIN gewerk g ON g.id = m.gewerk_id LEFT JOIN company c ON c.id = m.assigned_company_id
     WHERE m.project_id = ? ORDER BY coalesce(m.number, 9999), m.created_at`,
    [pid],
  );
  const { data: plans } = useQuery<{ id: string; name: string; plan_index: string }>('SELECT id, name, plan_index FROM plan WHERE project_id = ? ORDER BY name', [pid]);
  // All plans of the project are kept on the device, so they work on site without network.
  const { files: planFiles, loading: plansLoading } = usePlanFiles(plans, session, status.connected);
  const { data: pending } = useQuery<Pending>('SELECT * FROM pending_action');
  const { data: conflicts } = useQuery<{ id: string; reason: string; kind: string; entity_id: string; created_at: string }>(
    'SELECT * FROM sync_conflict WHERE project_id = ? ORDER BY created_at DESC',
    [pid],
  );

  // A pending decision is done once the server version moved past its base (applied) or a conflict for it arrived (refused).
  const { data: myConflicts } = useQuery<{ entity_id: string; created_at: string }>('SELECT entity_id, created_at FROM sync_conflict');
  useEffect(() => {
    for (const p of pending) {
      const m = maengel.find((x) => x.id === p.mangel_id);
      const applied = m && (m.version ?? 0) > p.base_version;
      const refused = myConflicts.some((c) => c.entity_id === p.mangel_id && new Date(c.created_at) >= new Date(p.occurred_at ?? 0));
      if (applied || refused) void db.execute('DELETE FROM pending_action WHERE id = ?', [p.id]);
    }
  }, [pending, maengel, myConflicts, db]);

  const [tab, setTab] = useState<Tab>('maengel');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ page: number; x: number; y: number; planId: string } | null>(null);
  const current = maengel.find((m) => m.id === selected);

  if (!membership) {
    return (
      <View style={[st.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator />
        <Text style={T.subhead}>{status.hasSynced ? 'Keine Projekte zugeordnet.' : 'Erster Abgleich läuft …'}</Text>
        <Pressable onPress={onLogout}>
          <Text style={[T.body, { color: C.accent }]}>Abmelden</Text>
        </Pressable>
      </View>
    );
  }
  const me: Me = { role: membership.role, userId: session.userId, companyId: membership.company_id };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {tab === 'maengel' && <MaengelTab project={membership.name} maengel={maengel} pending={pending} onSelect={setSelected} />}
      {tab === 'plaene' && <PlaeneTab project={membership.name} plans={plans} maengel={maengel} files={planFiles} downloading={plansLoading} onSelect={setSelected} onPick={setDraft} />}
      {tab === 'besprechung' && (
        <BesprechungTab
          projectId={pid}
          role={membership.role}
          userId={session.userId}
          header={(eyebrow) => <LargeHeader eyebrow={eyebrow} title="Besprechung" right={<SyncPill />} />}
        />
      )}
      {tab === 'hinweise' && <HinweiseTab project={membership.name} conflicts={conflicts} />}
      {tab === 'mehr' && (
        <MehrTab
          session={session}
          memberships={memberships}
          projectId={pid}
          onProject={setProjectId}
          onLogout={onLogout}
          plansOnDevice={`${Object.keys(planFiles).length} von ${plans.length}`}
        />
      )}
      <TabBar tab={tab} onTab={setTab} badges={{ hinweise: conflicts.length }} />

      <Modal visible={!!current} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        {current && <Detail m={current} me={me} pendingFor={pending.find((p) => p.mangel_id === current.id)} onClose={() => setSelected(null)} />}
      </Modal>
      <Modal visible={!!draft} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDraft(null)}>
        {draft && <NewMangel projectId={pid} pos={draft} me={me} onClose={() => setDraft(null)} />}
      </Modal>
    </View>
  );
}

type Scope = 'offen' | 'ueberfaellig' | 'erledigt' | 'alle';
const SCOPES: [Scope, string][] = [
  ['offen', 'Offen'],
  ['ueberfaellig', 'Überfällig'],
  ['erledigt', 'Erledigt'],
  ['alle', 'Alle'],
];

function MaengelTab({ project, maengel, pending, onSelect }: { project: string; maengel: Mangel[]; pending: Pending[]; onSelect: (id: string) => void }) {
  const [scope, setScope] = useState(0);
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const s = SCOPES[scope]![0];
    const needle = q.trim().toLowerCase();
    return maengel.filter((m) => {
      const done = statusOf(m) === 'abgenommen';
      const inScope = s === 'alle' || (s === 'offen' && !done) || (s === 'erledigt' && done) || (s === 'ueberfaellig' && escOf(m).ampel === 'rot');
      return inScope && (!needle || `${mNo(m)} ${m.description} ${m.location_name} ${m.company_name ?? ''}`.toLowerCase().includes(needle));
    });
  }, [maengel, scope, q]);

  return (
    <FlatList
      data={visible}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ paddingBottom: 120 }}
      keyboardDismissMode="on-drag"
      ListHeaderComponent={
        <LargeHeader eyebrow={project} title="Mängel" right={<SyncPill />}>
          <SearchField value={q} onChange={setQ} />
          <Segmented values={SCOPES.map(([, l]) => l)} index={scope} onChange={setScope} />
        </LargeHeader>
      }
      ListEmptyComponent={<Text style={[T.subhead, { textAlign: 'center', padding: 40 }]}>Keine Mängel in dieser Ansicht</Text>}
      renderItem={({ item: m, index }) => {
        const e = escOf(m);
        const p = pending.find((x) => x.mangel_id === m.id);
        const first = index === 0;
        const last = index === visible.length - 1;
        return (
          <View style={{ marginHorizontal: 16 }}>
            <Pressable
              onPress={() => onSelect(m.id)}
              style={({ pressed }) => [
                st.listRow,
                first && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
                last && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
                pressed && { backgroundColor: C.fill },
              ]}
            >
              <View style={[st.ampelBar, { backgroundColor: TINT[AMPEL_TINT[e.ampel]] }]} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[T.footnote, { fontVariant: ['tabular-nums'] }]}>{mNo(m)}</Text>
                  {m.priority === 'kritisch' && <Pill tint="red">Kritisch</Pill>}
                </View>
                <Text style={T.headline} numberOfLines={2}>
                  {m.description}
                </Text>
                <Text style={T.subhead} numberOfLines={1}>
                  {m.location_name} · {m.company_name ?? m.gewerk_name}
                  {m.assigned_company_id && !m.assignment_confirmed ? ' (Vorschlag)' : ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <Pill tint={STATUS_TINT[statusOf(m)]}>{MANGEL_STATUS_LABELS[statusOf(m)]}</Pill>
                  <Pill tint={AMPEL_TINT[e.ampel]} dot>
                    {e.label}
                  </Pill>
                  {p && <Pill tint="orange">Vorgemerkt: {MANGEL_STATUS_LABELS[JSON.parse(p.payload).to as MangelStatus]}</Pill>}
                  {!m.number && <Pill tint="orange">Noch nicht übertragen</Pill>}
                </View>
              </View>
              <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={C.label3} />
            </Pressable>
            {!last && <View style={[st.hairline, { marginLeft: 32 }]} />}
          </View>
        );
      }}
    />
  );
}

function PlaeneTab(props: {
  project: string;
  plans: { id: string; name: string; plan_index: string }[];
  maengel: Mangel[];
  files: PlanFiles;
  downloading: boolean;
  onSelect: (id: string) => void;
  onPick: (p: { page: number; x: number; y: number; planId: string }) => void;
}) {
  const [planIdx, setPlanIdx] = useState(0);
  const plan = props.plans[planIdx] ?? props.plans[0];
  return (
    <View style={{ flex: 1 }}>
      <LargeHeader eyebrow={props.project} title="Pläne" right={<SyncPill />}>
        {props.plans.length > 1 && (
          <Segmented values={props.plans.map((p) => p.name)} index={planIdx} onChange={setPlanIdx} />
        )}
        {plan && (
          <Text style={T.footnote}>
            {plan.name} · Index {plan.plan_index} · Tippen auf eine freie Stelle erfasst einen Mangel
          </Text>
        )}
      </LargeHeader>
      {plan ? (
        <View style={st.planCard}>
          <PlanScreen
            planId={plan.id}
            fileUri={props.files[plan.id] ?? null}
            downloading={props.downloading}
            maengel={props.maengel}
            ampel={(m) => escOf(m).ampel}
            onSelect={props.onSelect}
            onPick={(p) => props.onPick({ ...p, planId: plan.id })}
          />
        </View>
      ) : (
        <Text style={[T.subhead, { textAlign: 'center', padding: 40 }]}>Kein Plan vorhanden</Text>
      )}
    </View>
  );
}

function HinweiseTab({ project, conflicts }: { project: string; conflicts: { id: string; reason: string; kind: string; created_at: string }[] }) {
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
      <LargeHeader eyebrow={project} title="Hinweise" right={<SyncPill />} />
      <View style={{ paddingHorizontal: 16 }}>
        {conflicts.length === 0 ? (
          <View style={st.emptyState}>
            <SymbolView name="checkmark.circle" size={48} tintColor={C.green} />
            <Text style={T.headline}>Alles abgeglichen</Text>
            <Text style={[T.subhead, { textAlign: 'center' }]}>Konflikte aus dem Offline-Abgleich erscheinen hier.</Text>
          </View>
        ) : (
          <Section title="Aus dem Offline-Abgleich" footer="Die Bauleitung klärt Konflikte in der Web-Ansicht.">
            {conflicts.map((c) => (
              <Row
                key={c.id}
                icon={c.kind === 'conflict' ? 'arrow.triangle.2.circlepath' : 'xmark.octagon'}
                iconBg={c.kind === 'conflict' ? 'orange' : 'red'}
                label={<Text style={T.body}>{c.reason}</Text>}
                subtitle={`${c.kind === 'conflict' ? 'Konflikt' : 'Nicht übernommen'} · ${new Date(c.created_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}`}
              />
            ))}
          </Section>
        )}
      </View>
    </ScrollView>
  );
}

function MehrTab(props: {
  session: Session;
  memberships: { project_id: string; role: ProjectRole; name: string }[];
  projectId: string;
  onProject: (id: string) => void;
  onLogout: () => void;
  plansOnDevice: string;
}) {
  const { status, pending, tint, short } = useSyncState();
  const role = props.memberships.find((m) => m.project_id === props.projectId)?.role;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
      <LargeHeader title="Mehr" />
      <View style={{ paddingHorizontal: 16 }}>
        <Section>
          <Row
            label={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Avatar name={props.session.name ?? props.session.email} size={56} />
                <View>
                  <Text style={T.title2}>{props.session.name ?? props.session.email}</Text>
                  <Text style={T.subhead}>
                    {role ? ROLE_LABELS[role] : ''} · {props.session.email}
                  </Text>
                </View>
              </View>
            }
          />
        </Section>
        <Section title="Projekt">
          {props.memberships.map((m) => (
            <Row key={m.project_id} label={m.name} subtitle={ROLE_LABELS[m.role]} checked={m.project_id === props.projectId} onPress={() => props.onProject(m.project_id)} />
          ))}
        </Section>
        <Section title="Abgleich" footer="Pläne und Mängel sind auf dem Gerät gespeichert und verschlüsselt. Änderungen werden übertragen, sobald eine Verbindung besteht.">
          <Row icon="arrow.triangle.2.circlepath" iconBg={tint} label="Status" value={short} />
          <Row icon="tray.and.arrow.up" iconBg="blue" label="Ausstehende Änderungen" value={String(pending)} />
          <Row icon="map" iconBg="indigo" label="Pläne auf dem Gerät" value={props.plansOnDevice} />
          <Row icon="clock" iconBg="gray" label="Letzter Abgleich" value={status.lastSyncedAt ? status.lastSyncedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–'} />
        </Section>
        <Section title="In Vorbereitung">
          {COMING.map(([icon, bg, label]) => (
            <Row key={label} icon={icon} iconBg={bg} label={<Text style={[T.body, { color: C.label2 }]}>{label}</Text>} value="bald" />
          ))}
        </Section>
        <Section>
          <Row label="Abmelden" tone="destructive" onPress={props.onLogout} />
        </Section>
      </View>
    </ScrollView>
  );
}

function Detail({ m, me, pendingFor, onClose }: { m: Mangel; me: Me; pendingFor?: { payload: string }; onClose: () => void }) {
  const db = usePowerSync();
  const { data: notes } = useQuery<{ id: string; text: string }>('SELECT id, text FROM mangel_note WHERE mangel_id = ?', [m.id]);
  const { data: anzeigen } = useQuery<{ number: number | null; status: string; sent_at: string | null }>(
    `SELECT a.number, a.status, a.sent_at FROM mangelanzeige_position p JOIN mangelanzeige a ON a.id = p.anzeige_id
     WHERE p.mangel_id = ? ORDER BY a.status = 'versendet' DESC, a.sent_at DESC`,
    [m.id],
  );
  const e = escOf(m);
  const transitions = m.number
    ? allowedTransitions(me, { status: statusOf(m), createdBy: m.created_by ?? '', creatorRole: (m.creator_role ?? 'polier') as ProjectRole, assignedCompanyId: m.assigned_company_id ?? null }).filter(
        (t) => t !== 'zugewiesen',
      )
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
  const negative = (to: MangelStatus) => to === 'nicht_behoben' || to === 'strittig';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title={mNo(m)} right="Fertig" onRight={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <View style={{ gap: 8, marginBottom: 24, marginHorizontal: 4 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill tint={STATUS_TINT[statusOf(m)]}>{MANGEL_STATUS_LABELS[statusOf(m)]}</Pill>
            {m.priority === 'kritisch' && <Pill tint="red">Kritisch</Pill>}
          </View>
          <Text style={T.title2}>{m.description}</Text>
        </View>
        <Section>
          <Row icon="mappin.and.ellipse" iconBg="red" label="Ort" value={m.location_name ?? '–'} />
          <Row icon="hammer" iconBg="orange" label="Gewerk" value={m.gewerk_name ?? '–'} />
          <Row
            icon="building.2"
            iconBg="indigo"
            label="Nachunternehmer"
            value={`${m.company_name ?? '–'}${m.assigned_company_id && !m.assignment_confirmed ? ' (Vorschlag)' : ''}`}
          />
          <Row icon="flag" iconBg="gray" label="Priorität" value={PRIORITY_LABELS[(m.priority ?? 'normal') as Priority]} />
        </Section>
        <Section title="Frist">
          <Row icon="calendar" iconBg="blue" label="Frist" value={formatDate(m.due_date)} />
          {m.nachfrist_date ? <Row icon="calendar.badge.exclamationmark" iconBg="orange" label="2. Nachfrist" value={formatDate(m.nachfrist_date)} /> : null}
          <Row
            icon="gauge.with.needle"
            iconBg={AMPEL_TINT[e.ampel]}
            label="Eskalation"
            value={
              <Pill tint={AMPEL_TINT[e.ampel]} dot>
                {e.label}
              </Pill>
            }
          />
        </Section>
        {anzeigen.length > 0 && (
          <Section title="Mangelanzeige">
            {anzeigen.map((a, i) => (
              <Row
                key={i}
                icon="doc.text"
                iconBg={a.status === 'versendet' ? 'green' : 'orange'}
                label={a.status === 'versendet' ? anzeigeNo(a.number) : 'Entwurf'}
                value={a.status === 'versendet' && a.sent_at ? `versendet ${formatDate(a.sent_at)}` : 'noch nicht versendet'}
              />
            ))}
          </Section>
        )}
        {pendingFor ? (
          <Section footer="Die Entscheidung wird beim nächsten Abgleich gegen den aktuellen Stand geprüft.">
            <Row
              icon="clock.arrow.circlepath"
              iconBg="orange"
              label="Vorgemerkt"
              value={MANGEL_STATUS_LABELS[JSON.parse(pendingFor.payload).to as MangelStatus]}
            />
          </Section>
        ) : transitions.length > 0 ? (
          <Section title="Status ändern" footer="Funktioniert auch offline: Die Entscheidung wird vorgemerkt und beim Abgleich geprüft.">
            {transitions.map((t) => (
              <Row key={t} label={MANGEL_STATUS_LABELS[t]} tone={negative(t) ? 'destructive' : 'accent'} chevron onPress={() => decide(t)} />
            ))}
          </Section>
        ) : null}
        {notes.length > 0 && (
          <Section title="Interne Notizen" footer="Nur für Bauleitung und Polier sichtbar.">
            {notes.map((n) => (
              <Row key={n.id} label={n.text} />
            ))}
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

function NewMangel({ projectId, pos, me, onClose }: { projectId: string; pos: { page: number; x: number; y: number; planId: string }; me: Me; onClose: () => void }) {
  const db = usePowerSync();
  const { data: rooms } = useQuery<{ id: string; name: string }>("SELECT id, name FROM location WHERE project_id = ? AND kind = 'raum' ORDER BY sort", [projectId]);
  const { data: gewerke } = useQuery<{ id: string; name: string; company_id: string | null; company_name: string | null }>(
    `SELECT g.id, g.name, gc.company_id, c.name AS company_name FROM gewerk g
     LEFT JOIN gewerk_company gc ON gc.gewerk_id = g.id LEFT JOIN company c ON c.id = gc.company_id
     WHERE g.project_id = ? ORDER BY g.name`,
    [projectId],
  );
  const [description, setDescription] = useState('');
  const { data: areas } = useQuery<{ location_id: string; plan_id: string; page: number; x0: number; y0: number; x1: number; y1: number }>(
    'SELECT location_id, plan_id, page, x0, y0, x1, y1 FROM location_area WHERE plan_id = ?',
    [pos.planId],
  );
  // Genaue Verortung: the room under the pin is the suggestion (works offline, areas are on the device).
  const suggested = roomAt(areas, { plan_id: pos.planId, page: pos.page, x: pos.x, y: pos.y });
  const [room, setRoom] = useState<string | null>(null);
  const [gewerk, setGewerk] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>('normal');
  const roomId = room ?? suggested ?? rooms[0]?.id;
  const g = useMemo(() => gewerke.find((x) => x.id === (gewerk ?? gewerke[0]?.id)), [gewerke, gewerk]);
  const valid = !!description.trim() && !!roomId && !!g;

  const save = async () => {
    if (!valid) return;
    // Local insert with a device-generated id. Number, status and confirmation are set by the server on upload.
    await db.execute(
      `INSERT INTO mangel (id, project_id, location_id, gewerk_id, description, priority, status, plan_id, pin_page, pin_x, pin_y,
         assigned_company_id, assignment_confirmed, reporter_company_id, created_by, creator_role, created_at, version, visible_to_bauherr)
       VALUES (?, ?, ?, ?, ?, ?, 'neu', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, 0)`,
      [Crypto.randomUUID(), projectId, roomId, g!.id, description.trim(), priority, pos.planId, pos.page, pos.x, pos.y, g!.company_id, me.companyId, me.userId, me.role, new Date().toISOString()],
    );
    onClose();
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SheetBar title="Neuer Mangel" left="Abbrechen" onLeft={onClose} right="Sichern" rightDisabled={!valid} onRight={save} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Section>
          <TextInput
            style={[T.body, { minHeight: 96, padding: 16, paddingTop: 14, textAlignVertical: 'top' }]}
            multiline
            autoFocus
            value={description}
            onChangeText={setDescription}
            placeholder="Was ist der Mangel?"
            placeholderTextColor={C.label3 as unknown as string}
          />
        </Section>
        <Section title="Priorität">
          <View style={{ padding: 10 }}>
            <Segmented values={PRIORITIES.map((p) => PRIORITY_LABELS[p])} index={PRIORITIES.indexOf(priority)} onChange={(i) => setPriority(PRIORITIES[i]!)} />
          </View>
        </Section>
        <Section
          title="Ort"
          footer={suggested ? (roomId === suggested ? 'Aus der Position auf dem Plan übernommen.' : 'Abweichend von der Position auf dem Plan gewählt.') : 'An dieser Stelle ist kein Raum hinterlegt.'}
        >
          {rooms.map((r) => (
            <Row key={r.id} label={r.name} checked={r.id === roomId} onPress={() => setRoom(r.id)} />
          ))}
        </Section>
        <Section title="Gewerk" footer={`NU-Vorschlag: ${g?.company_name ?? '–'}. Die Bauleitung bestätigt die Zuweisung. Der Mangel wird auch ohne Netz gespeichert.`}>
          {gewerke.map((x) => (
            <Row key={x.id} label={x.name} checked={x.id === g?.id} onPress={() => setGewerk(x.id)} />
          ))}
        </Section>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  login: { paddingHorizontal: 20, paddingBottom: 40, alignItems: 'stretch', maxWidth: 520, width: '100%', alignSelf: 'center' },
  appIcon: { backgroundColor: TINT.blue, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  avatar: { backgroundColor: '#8E8E93', alignItems: 'center', justifyContent: 'center' },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.separator },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabLabel: { fontSize: 10, fontWeight: '500' },
  badge: { position: 'absolute', top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: TINT.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, paddingVertical: 12, paddingRight: 16, paddingLeft: 12 },
  ampelBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: C.separator },
  planCard: { flex: 1, marginHorizontal: 16, marginBottom: 100, borderRadius: 12, overflow: 'hidden', backgroundColor: C.card },
  emptyState: { alignItems: 'center', gap: 10, paddingVertical: 60, paddingHorizontal: 30 },
});
