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
