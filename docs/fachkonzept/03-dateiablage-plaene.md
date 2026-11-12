# Dateiablage und Plan-Freigaben

## Ordnerlogik
- Jeder Ordner enthält **nur aktuelle, freigegebene Dateien** plus den Unterordner **Alt**.
- Wird ein neuer Index freigegeben, wandert der alte Stand automatisch (serverseitig) nach **Alt**: lesbar, nicht bearbeitbar, für NU standardmäßig ausgeblendet.
- Nicht freigegebene Dateien liegen im Bereich **„Eingang / Zur Prüfung“**, nie zwischen den gültigen.

## Dateistatus
`Nicht freigegeben` · `Freigegeben` · `Fehlerhaft` · `Ersetzt`. Der Status ist in der Liste und im Dateinamen sichtbar.

**Eigenschaften:** freigegeben von (Person, Firma, Rolle), Datum, Index, Ersteller, Vorgänger/Nachfolger, Verknüpfungen (Ort, Gewerk, Mängel, Protokolle, Bemusterung), wer die Datei geöffnet oder bestätigt hat.

## Fehler melden
1. Berechtigte melden eine Datei als fehlerhaft (Begründung ist Pflicht, optional mit Markierung im Plan).
2. Sofort erscheinen ein Warnsymbol und ein Hinweis beim Öffnen.
3. Die Bauleitung **bestätigt** (Datei gesperrt, Korrektur anfordern, alle Bestätiger informieren) oder **weist zurück**.

## Ablauf der Planfreigabe
```
Entwurf → Zur Prüfung → In Prüfung → Freigegeben | Freigegeben mit Anmerkungen | Abgelehnt → Ausgegeben → Ersetzt
```
- Prüfkette je Plantyp konfigurierbar (parallel oder nacheinander), mit Fristen und Eskalation.
- Kommentare direkt im Plan. Ein Kommentar lässt sich in einen Mangel oder eine Aufgabe umwandeln.
- **Bauherr-Freigabe** nur für konfigurierbare Plantypen. Voreinstellung: Grundrisse, Ansichten, Ausbau- und Raumbuchpläne, Sonderwunschpläne. Nicht: Werk-, Schal-, Bewehrungs- und Installationspläne.
- Bei Plänen mit Bemusterungsbezug kommt die Bauherr-Freigabe automatisch in die Kette, **aber erst nach der Bemusterungsentscheidung**. Ändert sich die Bemusterung nachträglich, gehen die betroffenen Pläne auf „Prüfung erforderlich“.
- Lesebestätigung, Verteiler, Warnhinweis bei veraltetem Stand („aktueller Stand: Index C“), Planvergleich zwischen Indizes (Stufe 4), Planlauf mit Soll-Terminen.

## Dokumente und Ordner (entschieden 10.11.2026)
- Unter **Dokumente** liegen Ordner und Unterordner, z. B. *Pläne/Architektur*, *Pläne/Tragwerk*, *Statik*, *Nachweise*, *Verträge*, *Protokolle*. Pläne sind eine Dokumentart mit PINs.
- **Jeder Ordner hat einen Unterordner „Alt“**: dort liegen automatisch die ersetzten Stände. Im Ordner selbst nur der aktuelle, freigegebene Stand.
- Neue Dateien und neue Stände landen zuerst in „Zur Prüfung“ und werden von Bau- oder Projektleitung freigegeben.
- **Alten Stand angeklickt:** Warnung „Veraltet – neuer Stand (Index C) vorhanden“ mit Knopf „Aktuellen Stand öffnen“. Der alte bleibt lesbar (mit Wasserzeichen).
- An jedem Dokument sieht man, ob es eine neuere Version gibt.

## Planstand per QR-Code prüfen (entschieden 10.11.2026)
- Jeder ausgegebene Plan (Download/Druck) bekommt unten rechts einen **QR-Code** mit Index und Freigabedatum.
- Scannt der Polier den Code mit der iPhone-Kamera, öffnet sich die Prüfseite: **grüner Haken „Aktueller Stand“** oder **rote Warnung „Veraltet – neuer Index C seit …“**. Anmeldung erforderlich, damit Planinformationen nicht öffentlich sind.

## PIN-Farben im Plan (entschieden 10.11.2026)
Rot = offen, Orange = in Arbeit, Grün = erledigt, Blau = Info/Besprechungspunkt. Die Fristen-Ampel bleibt in den Listen.

## Upload / Download / Druck
- **Upload:** App, Drag & Drop im Browser, Teilen aus iOS, E-Mail an die Projektadresse; mehrere Dateien und Ordner. Ordner, Gewerk, Index und Status werden aus dem Dateinamen vorgeschlagen, die Namenskonvention ist prüfbar.
- **Download:** einzeln und als ZIP.
- **Direktdruck** mit Format und Maßstab, auch auf Plottern, mit Aufdruck von Stand, Freigabe und Druckdatum. Nicht freigegebene oder fehlerhafte Dateien bekommen ein Wasserzeichen oder sind gesperrt (konfigurierbar).
- Anbindung an einen Planserver: später.

## Laufwerk wie OneDrive (Stufe 4 – Struktur und Rechte aber von Anfang an passend bauen)
- iOS: Projektordner in der Dateien-App (File-Provider-Erweiterung). Windows: Sync-Client mit „Dateien bei Bedarf“, Ordner offline haltbar.
- Der Sync folgt den Rechten. Freigegebene Dateien sind schreibgeschützt.
- Neue Dateien aus dem Ordner starten als „Nicht freigegeben, zur Prüfung“. Verschieben in den freigegebenen Bereich gibt **nicht** frei.
- Konflikte erzeugen eine Konfliktkopie. Statussymbole am Dateisymbol.

## Umsetzungsstand (10.11.2026): einfacher Upload, Pläne aus der Dateiablage
- **Hochladen ohne Formular:** Dateien in den gewählten Ordner ziehen oder „Hochladen“ wählen. Gleicher Name im Ordner = neue Version (Index/Version wird aus dem Dateinamen erkannt, z. B. `Grundriss EG_Index_C.pdf`), sonst ein neues Dokument.
- **Ordner-Art:** Jeder Ordner ist „Pläne“ oder „Dokumente“; Unterordner erben die Art. Ein PDF in einem Planordner wird automatisch ein **Plan** und erscheint unter „Pläne“, gruppiert nach Ordner. Der Ort kommt aus dem Ordner („Ort der Pläne“), sonst aus dem Dateinamen (z. B. „OG 1“), sonst das erste Geschoss (ANNAHME).
- Jeder Upload landet „Zur Prüfung“; erst die Freigabe macht ihn zum gültigen Stand, der alte wandert nach „Alt“.
- Ordner anlegen: Bau- und Projektleitung (Fehler „Interner Fehler“ behoben, Regressionstest vorhanden).

## Raum-QR-Etiketten (entschieden 12.11.2026)
- Unter „Raum-QR-Etiketten“ (Bau-/Projektleitung, Polier) ein PDF mit einem Etikett je Raum: QR-Code links, rechts wählbar Raumname, Raumnummer, Geschoss, Gebäude, Projekt. Standard 2 × 8 = 16 je A4-Seite; Spalten, Zeilen, Ränder, Abstände, QR-Größe, Schrift und Rahmen frei einstellbar (Vorschau live, Format je Projekt speicherbar durch die Leitung). Auswahl: alle Räume oder ein Geschoss/Gebäude.
- Raumnummern werden dort bzw. in der Struktur gepflegt.
- Der QR-Code enthält den Link …/raum/<id>. In der App: beim neuen Mangel „Raum per QR-Code“ (Kamera, offline) – ohne Plan möglich (+ in der Mängelliste). Mit der iPhone-Kamera gescannt öffnet er die App direkt mit einem neuen Mangel in diesem Raum; im Browser die Mängelliste des Raums.
- ANNAHME: Dieselbe Raumwahl per QR bekommt die Fotodokumentation, sobald sie gebaut ist.
