# Offene Punkte

Antwort direkt hinter **Entscheidung:** eintragen. Ist ein Punkt geklärt, die Entscheidung ins jeweilige Modul-Dokument übernehmen und den Punkt hier abhaken.

## A. Vor dem ersten Code klären (blockiert Stufe 1)

- [ ] **A1 – Tech-Stack.** Sprache, Backend, Datenbank, iOS (nativ Swift oder plattformübergreifend), Web-Framework, Offline-Sync-Ansatz, Dateispeicher, Hosting. → Vorschlag: [tech-stack.md](tech-stack.md).
  **Entscheidung:**
- [x] **A2 – Team und Rahmen.** Wer entwickelt (allein mit Claude / Team)? Erwartete Zahl an Nutzern und Projekten, typische Größe der Plandateien, Budget für Hosting.
  **Entscheidung:** Ich allein mit Claude Code. Nutzerzahlen, Dateigrößen und Hosting-Budget noch offen.
- [x] **A3 – Mandanten.** Nur eine Firma für immer, oder `firma_id` vorsehen, falls die App später an andere Firmen gehen soll?
  **Entscheidung:** `firma_id` vorsehen, zum Start nur eine Firma.
- [x] **A4 – Datenschutz und Hosting.** Hosting in der EU / Deutschland? Aufbewahrungs- und Löschfristen? Wie verträgt sich das unveränderliche Audit Log mit Löschpflichten (Vorschlag: Personendaten nur per Verweis, damit anonymisierbar)?
  **Entscheidung:** Cloud mit Rechenzentrum in Deutschland. Aufbewahrungsfristen und Anonymisierung im Audit Log noch offen (siehe A7).
- [x] **A5 – Sprache im Code.** Bezeichner, Kommentare und Commits auf Deutsch oder Englisch? (Das Datenmodell nutzt bisher deutsche Feldnamen wie `projekt_id`.)
  **Entscheidung:** Englisch, deutsche Fachbegriffe bleiben deutsch (`gewerk_id`, `Nachtrag`).
- [x] **A6 – Erster Ausschnitt.** Vorschlag: zuerst ein schmaler, durchgehender Ablauf (Projekte/Orte/Rollen → Mängel mit Plan-Pin → offline auf dem iPad → Abgleich → Web-Ansicht für die Bauleitung), danach die volle Dateiablage mit Prüfketten. Einverstanden?
  **Entscheidung:** Ja, schmaler Durchstich zuerst.
- [ ] **A7 – Datenschutz-Details.** Aufbewahrungs- und Löschfristen; Personendaten im Audit Log nur per Verweis (anonymisierbar) – einverstanden?
  **Entscheidung:**
- [ ] **A8 – Mengengerüst.** Ungefähre Zahl an Nutzern, Projekten pro Jahr, größte Plandateien (MB), Budget für Hosting pro Monat.
  **Entscheidung:**

## B. Fachliche Widersprüche und Lücken (Stufe 1)

- [x] **B1 – Bauherr weist Mängel direkt zu** vs. „Bauleitung bestätigt die Zuweisung“. Vorschlag: Der Bauherr meldet und schlägt ein Gewerk vor, die Bauleitung weist zu. → [01](fachkonzept/01-rollen-rechte.md), [04](fachkonzept/04-maengel.md)
  **Entscheidung:** Bauherr weist direkt zu, wirksam erst nach Bestätigung durch die Bauleitung.
- [x] **B2 – Abnahme durch den Ersteller:** Ein NU, der selbst gemeldet hat, dürfte seinen Mangel abnehmen. Vorschlag: nie durch den zuständigen NU. → [04](fachkonzept/04-maengel.md)
  **Entscheidung:** Bauleitung und Ersteller (Polier/Bauherr), nie der NU.
- [x] **B3 – Freigabegrenze:** genau 50.000 €? Netto oder brutto? Grenze inklusive? → [01](fachkonzept/01-rollen-rechte.md)
  **Entscheidung:** Bis einschließlich 50.000,00 € netto.
- [x] **B4 – Eskalationszeiten für kritische Mängel** (Annahme: halbiert). → [04](fachkonzept/04-maengel.md)
  **Entscheidung:** Keine eigenen Zeiten für kritische Mängel. Eskalation wird in der Mängeltabelle angezeigt, mit Vorschlag für eine 2. Nachfrist. Details siehe B7.
- [x] **B5 – Offline-Entscheidungen:** online nötig oder vormerken und später prüfen? Annahme: online nötig. → [05](fachkonzept/05-offline-sync.md)
  **Entscheidung:** Offline vormerken, beim Verbinden prüft der Server gegen den aktuellen Stand.
- [x] **B6 – Einkauf „fachliche Interna ohne Bezug“:** Was genau ist ausgeblendet? → [01](fachkonzept/01-rollen-rechte.md)
  **Entscheidung:** Ausgeblendet: Mängel ohne Kostenbezug, Bautagebuch-Details, Stundenbuchungen/Arbeiterdaten.
- [ ] **B7 – 2. Nachfrist bei Mängeln.** Wie lang ist der Vorschlag (Annahme: 7 Tage, kritisch 3 Tage)? Was passiert nach Ablauf (Vorschlag Ersatzvornahme/Einbehalt)? Bleiben die automatischen Nachrichten (Erinnerung an NU, Meldung an Bauleitung/Geschäftsführung) zusätzlich zur Anzeige in der Tabelle erhalten (Annahme: ja)? → [04](fachkonzept/04-maengel.md)
  **Entscheidung:**

## C. Später klären (Stufe 2–3)

- [ ] **C1 – Rechtssicherheit der Unterschriften** (Bautagebuch, Protokolle). Vor dem Produktivstart juristisch klären. → [07](fachkonzept/07-bautagebuch-bauzeitenplan.md)
- [ ] **C2 – Protokoll:** Die Bauleitung führt das Protokoll, Einspruchsfrist 7 Tage, Einladungen über iPhone-Kalender/Outlook – bestätigen. → [09](fachkonzept/09-besprechungen.md)
- [ ] **C3 – Betragsgrenze für Rechnungsfreigaben** (z. B. Schlussrechnung ab X € durch die Geschäftsführung)? → [11](fachkonzept/11-rechnungen-nachtraege-budget.md)
- [ ] **C4 – Freigabegrenze für Bestellungen:** dieselbe wie für Nachträge? → [12](fachkonzept/12-einkauf-lieferungen.md)
- [ ] **C5 – Arbeiterdaten:** Wer sieht die Nachweise, wie lange werden sie aufbewahrt? → [08](fachkonzept/08-nu-portal-stunden.md)
- [ ] **C6 – Planserver-Anbindung:** Welches System, wann? (Zunächst nur Upload und E-Mail-Import.)
- [ ] **C7 – Angebotsvergleich:** Stufe 2, Datenmodell vorbereiten.

## D. Neue Module (10.11.2026)

- [ ] **D1 – Mangelanzeige:** Rechtlicher Wortlaut (VOB/B § 13 Abs. 5 oder BGB)? Nur E-Mail oder zusätzlich Einschreiben-Vermerk? Absender-Adresse (persönlich oder z. B. maengel@firma.de)? → [04](fachkonzept/04-maengel.md)
  **Entscheidung:**
- [ ] **D2 – Fahrtenbuch:** Wer sieht die Fahrten anderer (Annahme: Geschäftsführung und der Fahrer selbst)? → [14](fachkonzept/14-fahrtenbuch-auslagen.md)
  **Entscheidung:**
- [ ] **D3 – Baustellen-Einkäufe:** Betragsgrenze für Freigabe durch die Geschäftsführung? Erstattung über Lohn oder separat? → [14](fachkonzept/14-fahrtenbuch-auslagen.md)
  **Entscheidung:**
- [ ] **D4 – Stundenzettel:** Wer bestätigt die Stunden vom Polier (Bauleitung, Annahme)? Werden Helferstunden einer Firma zugeordnet, die keinen Zugang hat (Annahme: ja, Firma wird vom Polier angelegt)? → [08](fachkonzept/08-nu-portal-stunden.md)
  **Entscheidung:**
- [ ] **D5 – Ordnerstruktur:** Startordner je Projekt (Vorschlag: Pläne/Architektur, Pläne/Tragwerk, Pläne/TGA, Statik, Nachweise, Verträge, Protokolle, Fotos)? → [03](fachkonzept/03-dateiablage-plaene.md)
  **Entscheidung:**
- [ ] **D6 – Baubesprechung mit Bauherr:** Sieht der Bauherr die nicht internen Punkte der Baubesprechung im Portal (Annahme bisher: nein, nur das Protokoll-PDF)? Bekommt er eine eigene Aufgabenliste? → [09](fachkonzept/09-besprechungen.md)
  **Entscheidung:**
- [ ] **D7 – Offline-Speicher:** Sollen wirklich alle Dokumente und Fotos aufs Gerät, oder nur gewählte Ordner („offline halten“)? Speicherlimit je Gerät? Große Dateien nur im WLAN laden (Annahme bisher: alles, auch mobil)? → [05](fachkonzept/05-offline-sync.md)
  **Entscheidung:**
- [ ] **D8 – Projekte anlegen:** Wer darf neue Projekte anlegen (Annahme: Bau- und Projektleitung der eigenen Firma; später ggf. nur Geschäftsführung)? Gibt es Firmen-Vorlagen unabhängig von einem Projekt („Musterprojekt“)? → [01](fachkonzept/01-rollen-rechte.md)
  **Entscheidung:**
- [ ] **D9 – Benutzerverwaltung der Firma:** Wer sperrt ein ganzes Konto (z. B. Mitarbeiter ausgeschieden) – Geschäftsführung, Bauleitung? Zwei-Faktor-Anmeldung (z. B. Code per App) für Bau-/Projektleitung gewünscht? „Mit Microsoft anmelden“ nötig? → [01](fachkonzept/01-rollen-rechte.md)
  **Entscheidung:**

