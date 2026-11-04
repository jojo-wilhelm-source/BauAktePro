# Bau Akte Pro

Bau-Organisationsanwendung für **ein** Bauunternehmen mit mehreren Projekten (im Datenmodell trotzdem mit `firma_id`, siehe Fachkonzept 02). Sie bündelt Mängel, Plan-Freigaben, Besprechungsprotokolle, Bautagebuch mit Bauzeitenplan, Bemusterung, Einkauf und Lieferungen, Rechnungs- und Stundenprüfung sowie eine Dateiablage. Jedes Fachobjekt ist mit einem **Ort** verknüpft (Gebäude → Geschoss → Abschnitt → Raum, dazu eine Planposition).

- **Geräte:** iOS-App für iPhone und iPad (voll offlinefähig), Web-App für Windows-Laptops, Browser-Portal für Externe (NU, Bauherr).
- **Nicht Teil des Systems:** Zahlungen. Die App gibt Rechnungen frei und übergibt sie an die Buchhaltung (DATEV-Export).

Das Fachkonzept liegt in [`docs/fachkonzept/`](docs/fachkonzept/README.md). **Lies vor jedem Modul das zugehörige Dokument.** Bei Widersprüchen gilt das Fachkonzept. Offene Fragen stehen gesammelt in [`docs/offene-punkte.md`](docs/offene-punkte.md).

## Grundprinzipien (gelten für alle Module)

1. **Der Ort ist das Kernobjekt.** Fachobjekte hängen an Projekt + Ort + Gewerk. QR-Codes und Plan-Pins führen direkt zum Ort.
2. **Rollen gelten pro Projekt**, zusätzlich gibt es eine Firmenrolle (Einkauf, Geschäftsführung).
3. **Unveränderlichkeit und Protokoll.** Freigaben, Abnahmen, Unterschriften, Statuswechsel und Rechteänderungen kommen ins Audit Log (Person, Zeit, Gerät). Gesperrte Objekte werden nie still geändert: Korrekturen sind neue Einträge mit Vermerk. Löschen bedeutet Papierkorb, wiederherstellen darf die Bauleitung.
4. **Offline zuerst** auf der Baustelle. Wird automatisch abgeglichen, Konflikte werden nie still überschrieben.
5. **Merkfunktion und Vorlagen.** Abschaltbar pro Benutzer und Feld, Ebene persönlich / Projekt / Firma. Eigene Felder lassen sich überall ergänzen.
6. **Benachrichtigung, wenn jemand betroffen ist.**
7. **Sichtbarkeit pro Objekt:** intern / Bauherr / NU, wird **serverseitig** gefiltert.
8. **Rechte werden serverseitig erzwungen.** Ausblenden in der Oberfläche ist nur Komfort.

## Arbeitsweise

1. **Nicht raten.** Bei fachlichen Lücken oder Widersprüchen kurz nachfragen oder die Annahme klar benennen und im Code und in der Doku mit `ANNAHME:` kennzeichnen. Neue offene Fragen kommen in `docs/offene-punkte.md`.
2. **Rechte und Sichtbarkeit zuerst.** Jeder Endpunkt und jede Abfrage prüft Projektrolle und Objektsichtbarkeit serverseitig. Pflicht-Tests: NU-Isolation (ein NU sieht nie fremde Gewerke, Preise oder interne Punkte) und Preissperre für den Bauherrn.
3. **Audit Log** für Freigaben, Abnahmen, Unterschriften, Statuswechsel und Rechteänderungen.
4. **Offline-Fähigkeit ist von Anfang an Teil des Datenmodells:** IDs werden auf dem Gerät erzeugt (UUID), es gibt einen Änderungsverlauf und eine Konflikterkennung.
5. **Konfigurieren statt fest einbauen:** Statusketten, Fristen, Eskalation, Kategorien, Freigabegrenzen, Plantypen und Zusatzfelder liegen in Konfiguration oder Vorlagen. Alle Werte im Fachkonzept sind nur Startwerte.
6. **Kleine, prüfbare Schritte** in der Reihenfolge unten. Vor jedem Modul: kurzer Plan, Änderungen am Datenmodell, Rechte, Tests.
7. **Keine Zahlungen auslösen.** Elektronische Unterschriften gelten nicht als rechtswirksam, bis das ausdrücklich geklärt ist.
8. **Sprache:** Oberfläche und Dokumente auf Deutsch (€, `dd.MM.yyyy`, deutsche Zahlenformate). **Code, Bezeichner, Kommentare und Commits auf Englisch**, deutsche Fachbegriffe ohne gute Übersetzung bleiben deutsch (`gewerk_id`, `Nachtrag`, `Bemusterung`, `Regie`, `Polier`).

## Umsetzungsreihenfolge

| Stufe | Module |
|---|---|
| **1 Fundament** | 1. Projekte, Orte, Benutzer, Rollen/Rechte · 2. Dateiablage und Plan-Freigaben · 3. Mängel mit Verortung, Merkfunktion, Eskalation · 4. Offline-Modus für Pläne und Mängel, Benachrichtigungen |
| **2 Baualltag** | 5. Bautagebuch mit Unterschrift und Bauzeitenplan · 6. NU-Portal mit Stunden und Arbeitern · 7. Besprechungsprotokolle · 8. Bemusterung |
| **3 Geld und Beschaffung** | 9. Verträge, Nachträge, Rechnungsprüfung, Abschläge, Freigabe an die Buchhaltung, Budget · 10. Lieferanmeldung, Einkauf, Wareneingang, Mengenabgleich |
| **4 Ausbau** | 11. Sync-Ordner (Windows, iOS-Dateien-App) · 12. Anfragen und Angebotsvergleich, Bewertungen, KI-Funktionen, Planvergleich, weitere Schnittstellen |

**Start mit einem schmalen Durchstich** (vor der vollen Stufe 1): Projekte/Orte/Rollen → Mängel mit Plan-Pin → offline auf dem iPad erfassen → Abgleich mit dem Server → Web-Ansicht für die Bauleitung. Damit wird das Schwierigste (Offline-Abgleich) zuerst geprüft. Danach die volle Dateiablage mit Prüfketten und der Rest von Stufe 1.

Spätere Stufen werden **im Datenmodell schon vorbereitet** (z. B. Anfrage → Angebot → Vergabe → Bestellung, Sync-Ordner mit denselben Rechten).

## Rahmen

- **Team:** ein Entwickler zusammen mit Claude Code. Deshalb wenige Sprachen, möglichst viel geteilter Code, wenig Betriebsaufwand, bewährte Bibliotheken statt Eigenbau.
- **Hosting:** Cloud mit Rechenzentrum in **Deutschland** (DSGVO).

## Tech-Stack

**Vorschlag liegt vor, noch nicht bestätigt:** [`docs/tech-stack.md`](docs/tech-stack.md) (TypeScript-Monorepo, PostgreSQL, Fastify, React, Expo, PowerSync, Hetzner). Abweichungen davon erst begründen und nachfragen. Kritische Anforderungen: Offline-Abgleich mit Konfliktbehandlung, Dateispeicher für große Pläne, serverseitige Rechteprüfung, PDF- und Druckerzeugung, Einlesen von E-Rechnungen (XRechnung/ZUGFeRD), spätere Anbindung von File Provider (iOS) und Sync-Client (Windows).
Schnittstellen: DATEV-Export (andere Buchhaltung später), GAEB, Kalender (iPhone/Outlook), E-Mail-Eingang.

## Projektstruktur und Befehle

```
apps/api      Fastify-Server (Rechte, Konflikte, Upload-Endpunkt für die App)
apps/web      React-Web (Bauleitung u. a.)
apps/mobile   Expo-App iPhone/iPad (PowerSync, offline)
packages/domain  geteilte Regeln: Statusketten, Eskalation, Formate (mit Tests)
packages/db      SQL-Migrationen inkl. RLS, Seed, DB-Zugriff (asUser)
infra/           docker-compose (Postgres, PowerSync), Sync-Regeln
```

| Zweck | Befehl |
|---|---|
| Docker starten | `colima start` |
| Datenbank + PowerSync starten | `pnpm db:up` |
| Migrationen / Testdaten | `pnpm db:migrate` · `pnpm db:seed` |
| API / Web | `pnpm dev:api` · `pnpm dev:web` (http://localhost:5173) |
| Tests | `pnpm test` (Rechte-Tests brauchen die laufende DB, setzen die Testdaten neu) |
| iOS-App | `cd apps/mobile && npx expo run:ios` |
| Sync-Sicht prüfen | `node scripts/check-sync.mjs elektro` |

**Regeln im Code**
- Jeder DB-Zugriff der API läuft über `asUser(sql, userId, …)` – nie über die Admin-Verbindung (Ausnahme: Test-Login).
- Sichtbarkeit steht an **zwei** Stellen: RLS-Policies (`packages/db/migrations`) und Sync-Regeln (`infra/powersync/sync-config.yaml`). Ändert sich eine, muss die andere mit – und ein Test in `apps/api/test/rechte.test.ts` dazu.
- Statuswechsel nur über `packages/domain` (`canTransition`), nie direkt `status` setzen.
- Die App schreibt Entscheidungen in `mangel_action` (Upload-Warteschlange), nicht direkt in `mangel`.
