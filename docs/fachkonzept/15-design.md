# Gestaltung im Apple-Stil

Entschieden 10.11.2026: Die ganze Anwendung (iOS **und** Web) folgt den Apple Human Interface Guidelines.

## Grundsätze
- **Schrift:** Systemschrift (SF Pro auf Apple-Geräten, `-apple-system`; auf Windows Segoe UI als Ersatz). Große Titel (34 pt) oben in jeder Liste, Fließtext 17 pt.
- **Farben:** iOS-Systemfarben (Blau `#007AFF` als Akzent, Grün, Orange, Rot für die Ampel), Hintergrund gruppiert hellgrau `#F2F2F7`, Karten weiß. **Hell- und Dunkelmodus** automatisch.
- **Flächen:** abgerundete Ecken (10–14 px), gruppierte Listen mit Einzug („inset grouped“), Trennlinien statt Rahmen, durchscheinende Leisten mit Unschärfe (Sidebar, Tab-Leiste, Navigationsleiste).
- **Navigation:**
  - iPad und Web: **Seitenleiste** (Projekt oben, darunter Module mit Symbolen), Liste in der Mitte, Detail rechts (Split View).
  - iPhone: **Tab-Leiste** unten (Heute, Mängel, Pläne, Mehr), Navigationsstapel mit Zurück-Pfeil.
- **Status** als farbige Kapseln („Pills“), Zahlen in Tabellen rechtsbündig mit tabellarischen Ziffern.
- **Bedienung:** Segmentschalter statt Reitern, Blätter („Sheets“) für Neu-Formulare, Wischaktionen in Listen (iOS), Suchfeld oben in jeder Liste.
- **Symbole:** SF Symbols auf iOS; im Web gleichwertige Linien-Symbole (eigene SVGs im Stil von SF Symbols).

## Umsetzung
- Web: gemeinsame Design-Tokens als CSS-Variablen (`apps/web/src/styles.css`), Komponenten in `apps/web/src/ui/`.
- iOS: Theme in `apps/mobile/src/theme.ts`, native Bausteine von Expo/React Native (z. B. `expo-symbols`, `expo-blur`), wo möglich echte iOS-Steuerelemente.
