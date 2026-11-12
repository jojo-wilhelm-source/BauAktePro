# Rollen und Rechte

**Projektleitung (entschieden 10.11.2026):** eigene Projektrolle mit **denselben Rechten wie die Bauleitung** (sieht und entscheidet alles, was die Bauleitung sieht und entscheidet).

Rollen gelten **pro Projekt**. Zusätzlich gibt es **Firmenrollen** für die projektübergreifende Sicht (Einkauf, Geschäftsführung). Rechte werden immer serverseitig geprüft.

| Rolle | Darf | Sieht nicht |
|---|---|---|
| **Bauleitung** | Alles im Projekt: prüfen, freigeben, abnehmen, Besprechungen leiten, Nachträge bis zur Freigabegrenze freigeben | – |
| **Polier** | Mängel, Tagesrapport, Wareneingang, Bedarf melden, Besprechung mitschreiben | Preise, Rechnungen |
| **NU** | Eigene Mängel bearbeiten und melden, Stunden und Arbeiter erfassen, Rechnungen einreichen, Lieferungen anmelden, Besprechungspunkte vorschlagen | Andere NU, interne Punkte, fremde Preise |
| **Bauherr** | Pläne (bestimmte Typen) und Bemusterungen freigeben, Status und Berichte sehen, Mängel melden und einem NU zuweisen (wirksam erst nach Bestätigung durch die Bauleitung) | NU-Preise, interne Notizen, Stundendetails, Allowance (falls ausgeblendet) |
| **Einkauf** (Firma) | Bedarf, Bestellungen, Lieferungen, kaufmännische Rechnungsprüfung, Lieferantenstamm | Mängel ohne Kostenbezug, Details aus dem Bautagebuch, Stundenbuchungen und Arbeiterdaten |
| **Geschäftsführung** (Firma) | Freigaben über den Grenzen, Auswertungen, Frühwarnung, projektübergreifende Sicht | – |

**Sicht des Einkaufs (entschieden):**
- **Ausgeblendet:** Mängel ohne Kostenbezug (ohne Verknüpfung zu Lieferung, Bestellung, Nachtrag oder Kostenfolge), Details aus dem Bautagebuch (Personal, Behinderungen, Unfälle), NU-Stundenbuchungen und Arbeiterdaten.
- **Sichtbar:** Mängel mit Kostenbezug, Lieferungen des Tages aus dem Bautagebuch, interne Protokollpunkte (soweit sie den Einkauf betreffen).

## Freigabegrenzen
- Konfigurierbar pro Firma und Projekt, später auch pro Person.
- Startwert: Nachträge und neue Verträge **bis einschließlich 50.000,00 € netto** gibt die Bauleitung frei, darüber die Geschäftsführung.

## Sichtbarkeit
- Jedes Objekt hat ein Sichtbarkeitsattribut: **intern / Bauherr / NU**. Abfragen werden serverseitig gefiltert.
- Ein NU sieht immer nur seine eigenen Gewerke, Aufträge, Mängel und Pläne.

## Externe Zugänge
- Per Einladung (Link oder E-Mail).
- **Einmal-Links ohne Login** nur für Bemusterungsentscheidungen: zeitlich begrenzt, nur einmal nutzbar, an eine E-Mail-Adresse gebunden, abschaltbar.

## Umsetzungsstand (10.11.2026): Projekte und Struktur
- **Neues Projekt** (Web, Projektauswahl → „+ Neues Projekt …“): Bau- und Projektleitung der eigenen Firma. Der Ersteller wird Bauleitung (bzw. Projektleitung, wenn das seine Rolle ist). ANNAHME (offene-punkte D8).
- **Struktur übernehmen** beim Anlegen oder später (Projekt & Struktur → „Struktur übernehmen …“): wählbar Orte, Gewerke, Ordnerstruktur, Nachunternehmer (mit Gewerken), eigenes Team. Zusammenführen nach Name/Pfad: Vorhandenes bleibt, nur Fehlendes kommt dazu. Nie übernommen: Mängel, Pläne, Dokumente, Verträge, Preise, Zugänge anderer Firmen.
- **Struktur ändern** (Projekt & Struktur): Orte als Baum (Gebäude › Geschoss › Abschnitt › Raum; Unterorte immer feiner), Gewerke anlegen, umbenennen, löschen. Was von Mängeln, Plänen oder Unterorten benutzt wird, lässt sich nicht löschen. Projekt umbenennen/Adresse.
- **Nachunternehmer je Projekt** (Web, Nachunternehmer): neu anlegen oder „Aus anderem Projekt …“ übernehmen (eine Firma, mehrere Projekte; Gewerke über den Namen zugeordnet; ohne Verträge, Preise und Zugang).
- Alles im Audit Log (Teamänderungen einzeln). Rechte-Tests in `apps/api/test/rechte.test.ts`.

## Umsetzungsstand (12.11.2026): Anmeldung, Einladungen, Zugänge
- **Anmeldung** mit E-Mail und Passwort (Web und App), „Passwort vergessen“ per E-Mail-Link. In der App danach offline nutzbar; Face ID sperrt die App beim Start und nach 5 Minuten im Hintergrund (abschaltbar unter „Mehr“).
- **Einladen** (Web, Bereich „Zugänge“, nur Bau-/Projektleitung): E-Mail, optional Name, Rolle (Polier, Bauleitung, Projektleitung, Einkauf, Nachunternehmer, Bauherr); bei Nachunternehmer/Bauherr die Firma aus dem Projekt. Der Eingeladene bekommt einen Link (14 Tage, einmalig), wählt Name und Passwort und ist sofort angemeldet. Wer schon einen Zugang in der Firma hat, wird direkt hinzugefügt.
- **Zugang entziehen** (Rechteänderung, im Audit Log): Danach kein Zugriff mehr, das Projekt verschwindet beim nächsten Abgleich vom Gerät. Den eigenen Zugang und die letzte Leitung eines Projekts kann man nicht entziehen. Offene Einladungen lassen sich zurückziehen.
- **Gesperrte Konten** (z. B. Mitarbeiter ausgeschieden) können sich weder anmelden noch die Sitzung verlängern. ANNAHME: Sperren eines ganzen Kontos (über alle Projekte) macht vorerst der Administrator in der Datenbank; eine Oberfläche dafür kommt mit der Benutzerverwaltung der Firma (offene-punkte D9).

## Umsetzungsstand (12.11.2026): Administrator, Firmen-Admin, NU-Portal
- **Administrator** (eigene Firma): sieht alle Projekte mit den Rechten der Bauleitung, auch ohne eingetragen zu sein; Bereich „Administration“: alle Personen mit Projekten und Rollen, **sperren/entsperren** (meldet auf allen Geräten ab), **Admin** und **Firmen-Admin** vergeben/entziehen. Den eigenen Admin-Zugang kann man nicht entziehen. Alles im Audit Log.
- **Firmen-Admin eines Nachunternehmers**: lädt weitere Personen seiner Firma (oder für seine Firma tätige Handwerker) in die Projekte seiner Firma ein – immer als Nachunternehmer seiner Firma; sieht und verwaltet nur die eigenen Leute („Mitarbeiter einladen“).
- **NU-Portal**: Startseite „Was ist zu tun?“ mit Kennzahlen, offenen Mängeln (überfällige zuerst, mit nächstem Schritt), erhaltenen Mangelanzeigen, Besprechungspunkten und eigenen Einreichungen/Stundenzetteln.

