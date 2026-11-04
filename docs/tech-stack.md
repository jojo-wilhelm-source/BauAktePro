# Tech-Stack – Vorschlag

**Status:** Vom Nutzer angenommen (04.11.2026). Der Durchstich ist umgesetzt; endgültige Bestätigung nach dem Test auf dem iPad.

### Stand nach dem Durchstich
- **PowerSync-Lizenz geprüft:** Der selbst gehostete Dienst steht unter der Functional Source License (FSL). Kommerzielle Nutzung ist erlaubt, nur kein Konkurrenzprodukt zu PowerSync; nach 2 Jahren wird jede Version Apache 2.0. Die Client-Bibliotheken sind Apache 2.0. → passt.
- **Abweichung Drizzle:** Migrationen sind reine SQL-Dateien (`packages/db/migrations`), Zugriff über `postgres` (postgres.js). Grund: RLS-Policies, Funktionen und Rollen lassen sich in SQL klarer pflegen. Drizzle kann für typisierte Abfragen später ergänzt werden.
- **Anmeldung:** nur Test-Login ohne Passwort (`/auth/dev-login`, in Produktion abgeschaltet). Better Auth kommt mit dem nächsten Modul.
- **Lokale Verschlüsselung:** SQLCipher über op-sqlite, Schlüssel im iOS-Schlüsselbund.
- **Offen – Plan mit Zoom:** Im Durchstich wird der Plan ohne Zoom angezeigt, damit die Pins sicher sitzen. Zoom + Pins braucht eine eigene native PDFKit-Ansicht. Das ist der nächste Prüfpunkt.

## Ausgangslage

| Anforderung | Folge für den Stack |
|---|---|
| Ein Entwickler mit Claude Code | Möglichst **eine Sprache** für alles, viel geteilter Code, wenig Betrieb, bewährte Bausteine statt Eigenbau |
| iOS (iPhone + iPad) voll offline **und** Web für Windows und Portale | Zwei Oberflächen sind Pflicht. Je mehr Logik sie teilen, desto besser |
| Offline-Abgleich mit Konflikterkennung und „Entscheidung vormerken“ | Lokale Datenbank auf dem Gerät, Sync-Engine, Schreibzugriffe über die eigene API (damit der Server prüft) |
| Rechte und Sichtbarkeit serverseitig | Prüfung in der API **und** als zweite Sicherung in der Datenbank. Der Sync darf nur liefern, was die Person sehen darf |
| Große Pläne (A0-PDFs), Pins, Druck mit Maßstab | Native PDF-Anzeige auf dem iPad, PDF-Bearbeitung auf dem Server |
| Hosting in Deutschland | Anbieter mit deutschem Rechenzentrum, keine US-Pflichtdienste |
| Später: File Provider (iOS), Sync-Client (Windows), E-Rechnung | Muss sich ergänzen lassen, ohne den Kern umzubauen |

## Empfehlung auf einen Blick

**TypeScript durchgehend**, ein Monorepo, PostgreSQL als einzige Datenquelle, PowerSync für den Offline-Abgleich.

| Bereich | Wahl | Warum |
|---|---|---|
| Sprache | **TypeScript** (überall) | Eine Sprache für Server, Web und App. Typen, Validierung und Statusketten werden einmal geschrieben und überall genutzt |
| Monorepo | **pnpm + Turborepo** | Gemeinsame Pakete, ein Repository, ein Befehl für Tests |
| Datenbank | **PostgreSQL** | Bewährt, Row Level Security, JSONB für Zusatzfelder, Grundlage für den Sync |
| ORM / Migrationen | **Drizzle** | Typsicher, SQL-nah, Migrationen als Dateien |
| Backend | **Node.js + Fastify**, Validierung mit **zod** | Schlank, schnell, gut testbar. Gemeinsame zod-Schemas mit den Clients |
| Rechte | Policy-Schicht in der API **+ Postgres Row Level Security** | Zwei Sicherungen: Ein Fehler in der API öffnet trotzdem keine fremden Daten (NU-Isolation, Preissperre) |
| Offline-Sync | **PowerSync** (selbst gehostet) | Postgres → SQLite auf dem Gerät. Sync-Regeln filtern pro Benutzer. **Schreibzugriffe laufen über unsere API**, dort liegen Rechteprüfung, Konflikterkennung und Prüfung vorgemerkter Entscheidungen |
| iOS-App | **React Native mit Expo** | Teilt Logik und Typen mit Web und Server. Native Module, wo nötig (PDF, später File Provider) |
| Plan-Anzeige | iOS: natives **PDFKit** (über ein Expo-Modul); Web: **PDF.js** | Große Pläne flüssig mit Zoom; Pins als relative Koordinaten (Seite, x, y) pro Plan-Index |
| Web-App + Portale | **React + Vite**, ein Projekt mit Rollen-Ansichten | Bauleitung, NU-Portal und Bauherren-Portal teilen Komponenten; Rechte kommen vom Server |
| Anmeldung | **Better Auth** (Bibliothek, Daten in unserer Postgres) | Kein externer Dienst, Einladungen und Einmal-Links selbst umsetzbar. Face ID nur lokal als Gerätesperre |
| Dateien | **S3-kompatibler Objektspeicher** in Deutschland | Direkter Upload vom Gerät (vorsignierte URLs), Versionen und Indizes als eigene Objekte |
| Hintergrundjobs | **pg-boss** (Warteschlange in Postgres) | Eskalation, Nachfristen, Erinnerungen, PDF-Erzeugung ohne zusätzlichen Redis |
| PDF | **pdf-lib** (Stempel, Wasserzeichen, Aufdruck auf Pläne) + **Gotenberg** (HTML → PDF für Berichte und Protokolle) | Pläne bleiben maßstabsgetreu, Berichte als HTML-Vorlagen |
| Push | Apple Push (APNs) über Expo Notifications | Standard für iOS |
| E-Rechnung (Stufe 3) | **Mustang** (Java) als kleiner Zusatzdienst | Bewährteste Bibliothek für XRechnung/ZUGFeRD; in TypeScript gibt es nichts gleichwertiges |
| Tests | **Vitest**, Rechte-Tests gegen echte Postgres (Testcontainers), **Playwright** für Web | Rechte-Tests (NU-Isolation, Preissperre) laufen bei jedem Commit |
| Hosting | **Hetzner Cloud** (Deutschland), Docker Compose, Hetzner Object Storage | Günstig, deutsch, einfach. Postgres mit täglichem Backup + WAL-Archiv in den Objektspeicher |

## Wie der Offline-Abgleich funktioniert

```
iPad (SQLite) ──lesen──▶ PowerSync-Dienst ◀── Postgres (Sync-Regeln: nur was die Person sehen darf)
     │
     └─schreiben (Warteschlange)──▶ eigene API ──▶ Postgres
                                       │
                                       ├─ Rechte prüfen
                                       ├─ Konflikt? (base_version ≠ aktuelle version) → Konflikt speichern, beide Stände zeigen
                                       └─ vorgemerkte Entscheidung? → gegen aktuellen Stand prüfen, wirksam oder neu vorlegen
```

- Jedes Objekt hat eine `version`. Das Gerät schickt bei jeder Änderung die Version mit, auf der es aufbaut.
- IDs sind UUIDs, die das Gerät selbst erzeugt.
- Weil alle Schreibzugriffe über die eigene API laufen, ist PowerSync nur für das **Lesen** zuständig. Fällt PowerSync einmal weg, lässt sich der Lesepfad durch eine eigene „Änderungen seit Version X“-Schnittstelle ersetzen. Die Abhängigkeit bleibt also begrenzt.

## Projektstruktur

```
apps/
  api/        Fastify-Server, Jobs, PDF
  web/        React (Bauleitung, Einkauf, GF, NU-Portal, Bauherren-Portal)
  mobile/     Expo-App (iPhone/iPad)
packages/
  domain/     Typen, zod-Schemas, Statusketten, Rechte-Regeln (geteilt)
  db/         Drizzle-Schema, Migrationen, RLS-Policies, Sync-Regeln
  ui/         gemeinsame Formate (€, Datum), Texte
infra/        Docker Compose, Backup-Skripte
```

## Verworfene Alternativen

| Alternative | Warum nicht (jetzt) |
|---|---|
| **iOS nativ in Swift + Web in React** | Beste iPad-Qualität und einfachster File Provider, aber zwei komplette Oberflächen in zwei Sprachen. Für einen Entwickler zu viel doppelte Arbeit. **Rückfalloption**, falls die Plan-Anzeige in React Native nicht reicht |
| **Flutter** | Web-Version schwächer für Tabellen und Portale; Dart ist eine zusätzliche Sprache ohne Gewinn auf dem Server |
| **Firebase / Supabase Cloud** | US-Anbieter bzw. Abhängigkeit von einer Plattform; Rechte- und Sync-Logik wäre schwerer selbst zu kontrollieren |
| **Eigener Sync von Grund auf** | Viel Aufwand und fehleranfällig. Erst wenn PowerSync nicht passt |
| **CRDTs (z. B. Automerge)** | Das Fachkonzept will Konflikte **zeigen**, nicht automatisch zusammenführen. Versionsnummern reichen |
| **Keycloak** | Mächtig, aber ein weiterer schwerer Dienst zum Betreiben |

## Risiken und wie der Durchstich sie prüft

| Risiko | Prüfung im Durchstich |
|---|---|
| Große Pläne ruckeln in React Native | A0-PDF mit 50 MB+ auf einem älteren iPad öffnen, zoomen, Pins setzen |
| PowerSync-Sync-Regeln bilden die Sichtbarkeit nicht sauber ab | NU-Testkonto darf auf dem Gerät nachweislich keine fremden Mängel haben |
| Konflikte und vorgemerkte Entscheidungen | Zwei Geräte offline, gleichen Mangel ändern, verbinden → Konflikt wird angezeigt |
| Lizenz von PowerSync (selbst gehostete Ausgabe) | Lizenzbedingungen vor der Entscheidung prüfen |
| File Provider mit Expo (Stufe 4) | Nicht im Durchstich; vor Stufe 4 kleinen Test mit einer nativen Swift-Erweiterung im Expo-Projekt |
| Betrieb der Datenbank allein | Backup und Wiederherstellung einmal komplett testen. Alternativ verwaltete Postgres bei einem deutschen Anbieter (z. B. IONOS oder STACKIT, Angebot prüfen) |

## Nächster Schritt

Wenn der Vorschlag passt: Monorepo aufsetzen und den Durchstich bauen (Projekte/Orte/Rollen → Mängel mit Plan-Pin → offline auf dem iPad → Abgleich → Web-Ansicht Bauleitung). Nach dem Durchstich wird der Stack bestätigt oder an den Risikostellen angepasst.
