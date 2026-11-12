# Lieferungen und Einkauf

## NU-Lieferungen
NU liefern ihr Material selbst. Für sie gibt es nur die **Lieferanmeldung** im Portal:
- Was, wann, Geschoss/Abladeort, Zeitfenster, Fahrzeug.
- Die Bauleitung bestätigt oder schlägt eine Alternative vor (Kran, Zufahrt, Aufzug).
- Wareneingang optional (Foto/Zustand), **kein** Mengenabgleich.

## Eigenbedarf des Unternehmens
```
Bedarf (aus Bemusterung, Bauzeitenplan oder Meldung des Poliers) → Bestellung (Freigabegrenze)
→ Auftragsbestätigung → Wareneingang (Lieferschein-Scan, Foto, Unterschrift)
```
Abweichungen erzeugen eine Reklamation oder einen Mangel.

## Einkaufs-Portal
- Alle Anforderungen und Bestellungen mit Status:
  `Angefordert → In Bearbeitung → Bestellt → Bestätigt → Geliefert → Abgeschlossen`
- Filter nach Projekt, Lieferant, Termin, Verzug.
- Versand an Lieferanten als PDF/E-Mail.
- Terminverfolgung (Bedarf gegenüber Liefertermin, Ampel, Warnung vor Bestellfristen).
- **Mengenabgleich** bestellt – geliefert – verbaut – abgerechnet (nur Eigenbedarf), wird von der Rechnungsprüfung genutzt.

## Stammdaten und Bestand
- Lieferantenstamm (Konditionen, Skonto, Rahmenverträge, Bewertung).
- Einfache Bestandsliste je Baustelle.
- Leihgeräte, Container, Gerüst mit Mietende.

> ❓ **OFFEN – Freigabegrenze für Bestellungen:** Gilt dieselbe Grenze wie für Nachträge (50.000 €) oder eine eigene?

## Ausbaustufe 2
Anfrage und Angebotsvergleich (im Datenmodell schon vorbereiten).

## Leistungsverzeichnis, Anfrage, Preisspiegel (umgesetzt 12.11.2026)
- **Rolle Einkauf:** eigener Zugang, vom Administrator den Projekten zugeordnet. Einkauf sowie Bau-/Projektleitung legen LVs an.
- **LV:** Titel, Gewerk, Angebotsfrist, Positionen (OZ, Kurztext, Menge, Einheit). Positionen per Einfügen aus Excel; GAEB-Import folgt (offene Frage). Nach dem Versand sind die Positionen gesperrt.
- **Anfrage:** pro Nachunternehmer ein eigener Link mit QR-Code per E-Mail (ohne Anmeldung, nur für dieses LV). Mit Portal-Zugang erscheint die Anfrage auch unter „Anfragen“.
- **Angebot:** Einheitspreise online (Summe live) plus Nachlass und Bemerkung; im Notfall PDF mit Angebotssumme. Ein neues Angebot ersetzt das alte im Preisspiegel; alle Stände bleiben gespeichert. Der Ersteller des LV bekommt eine Mail.
- **Preisspiegel:** Bieter nebeneinander (EP/GP), günstigster Preis je Position markiert, Summe, Nachlass, Rangfolge, fehlende Positionen. Bieter sehen nie fremde Preise.
- **Vergabe:** durch die Bau-/Projektleitung (ANNAHME: Einkauf bereitet vor). Der Polier sieht keine Angebote (ANNAHME).

## LV-Struktur, Ordner, Stammleistungen (entschieden 12.11.2026)
- **Ordner** je Projekt frei benennbar und verschachtelbar (z. B. Rohbau › Estrich, Ausbau › Trockenbau); LVs lassen sich verschieben.
- **Gliederung wie in AVA-Programmen:** Titel › Untertitel › Position, dazu Hinweistexte. Die OZ wird beim Speichern automatisch vergeben (01 · 01.01 · 01.01.0010, Schritt 10). Positionen mit Kurztext, Langtext, Menge, Einheit; Zeilen verschieben, einfügen, löschen.
- **Stammleistungen:** firmenweite Bibliothek (Kategorie, Kurztext, Langtext, Einheit) für Einkauf und Leitung; im LV „Aus Stammleistungen …“ (Suche, Mehrfachauswahl), mit ★ eine Position übernehmen.
- **Kopieren / als Vorlage:** LV als neuen Entwurf kopieren (gleiche Gliederung, ohne Preise).
- **Preisspiegel und Bieterseite** gegliedert nach Titeln, mit Titelsummen je Bieter. GAEB-Import (X83) folgt.

## Leistungspakete, Kalkulation, Angebote per Hand, LV auf Papier (entschieden 12.11.2026)
- **Leistungspakete** in den Stammleistungen: ein Paket (z. B. „Bodenplatte“ je m²) enthält mehrere Positionen mit Menge je Bezugseinheit (Aushub 0,40 m³, Bewehrung 0,03 t, Schalung 0,20 m, Beton 0,25 m³). Beim Einfügen ins LV gibt man die Gesamtmenge an (z. B. 120 m²); das Paket wird als Untertitel mit ausmultiplizierten Mengen eingefügt. Mit ★ an einem Titel/Untertitel wird dessen Inhalt als Paket übernommen (je 1 St, Bezugseinheit danach anpassen).
- **Kalkulation:** eigene Einheitspreise je Position, im Preisspiegel ganz links (EP, GP, Titelsummen, Summe). Sehen nur Einkauf und Leitung, nie die Bieter (eigene Tabelle `lv_kalkulation`). Auch nach dem Versand änderbar.
- **Bieter nebeneinander:** Bieter 1, 2, 3 … rechts daneben, wahlweise „Günstigstes zuerst“ oder „Nach Eingang“; Abweichung jeder Angebotssumme zur Kalkulation in %, EP mehr als 20 % über Kalkulation rot.
- **Angebot erfassen:** Angebote per Mail/Papier tragen Einkauf oder Leitung selbst ein (EP je Position, EP-Spalte aus Excel einfügen, oder nur Summe). Erneutes Erfassen ersetzt das Angebot der Firma im Preisspiegel, alle Stände bleiben gespeichert. Das erste erfasste Angebot sperrt das LV wie ein Versand.
- **LV als PDF zum Ausfüllen:** liegt jeder Anfrage-Mail bei (mit Bietername, QR-Code und Link), ist auf der Bieterseite herunterladbar und im LV als neutrales PDF. Spalten EP/GP leer, Summen je Titel, Nachlass, Angebotssumme, Ort/Datum, Unterschrift und Stempel. Ausgefüllt kann der Bieter es einscannen und online hochladen oder zurückschicken (dann „Angebot erfassen“).

## Bestellanforderungen und Einkaufsportal (entschieden 12.11.2026)
- **Bestellanforderung** stellen Polier, Bau- und Projektleitung (Web und App, auch offline): Was, Positionen mit Menge/Einheit, benötigt am, dringend, Ort, Gewerk, Hinweis. Ablauf: Neu → In Bearbeitung → Angebote angefragt → Bestellt (Lieferant, Bestell-Nr., Liefertermin) → Geliefert; Einkauf/Leitung kann ablehnen (mit Grund), der Anforderer zurückziehen, solange sie neu ist. Jeder Statuswechsel im Audit Log.
- **Einkauf** ist ein eigener Benutzer mit Projektrolle „Einkauf“ auf allen seinen Baustellen (Testbenutzer Erika Einkauf).
- **Einkaufsportal:** zuerst ein Dashboard über alle Baustellen (Kennzahlen Neu / In Arbeit / Bestellt / Dringend / Überfällig, je Baustelle Anzahl, die dringendsten Anforderungen, älteste neue, nächster Bedarf; Baustellen mit Neuem oben). Erst ein Klick auf eine Baustelle zeigt deren Anforderungen.
- Aus einer Anforderung macht der Einkauf mit einem Klick ein **LV** (Positionen und Mengen übernommen); beim Versand der Anfrage springt die Anforderung auf „Angebote angefragt“.
- **Mitteilungen:** neue Anforderung → Einkauf (App + E-Mail), Leitung (nur App); Statuswechsel → Anforderer (App + E-Mail, „In Bearbeitung“ nur App). Mitteilungen-Zentrale im Web mit Zähler. ANNAHME: Ohne Einkauf auf der Baustelle bekommt die Leitung die E-Mail.
