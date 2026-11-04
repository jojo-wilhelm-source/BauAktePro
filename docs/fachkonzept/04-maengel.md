# Mängelmanagement

## Erfassen
- Pin im Plan oder QR-Code am Raum, Fotos mit Markierung, Text oder Sprache.
- **Pflicht:** Ort, Gewerk, Beschreibung. **Optional:** Kategorie, Priorität, Frist.
- Hinweis auf mögliche Doppelmeldungen.

## Zuweisen
- Das Gewerk liefert einen NU-Vorschlag, die Bauleitung bestätigt.
- Frist nach Standard je Priorität (Startwerte: kritisch 3 Tage, normal 14 Tage).
- NU dürfen selbst Mängel melden (z. B. Mängel an Vorleistungen).
- Der **Bauherr** darf einen Mangel direkt einem NU zuweisen. Die Zuweisung wird aber erst wirksam, wenn die Bauleitung bestätigt (bis dahin Status „Neu“ mit vorgeschlagenem NU; der NU sieht den Mangel erst nach der Bestätigung).

## Status
```
Neu → Zugewiesen → In Bearbeitung → Behoben gemeldet → Geprüft/Abgenommen
                                           ↘ Nicht behoben (zurück zu In Bearbeitung)
Strittig: NU widerspricht → Bauleitung entscheidet
```
- Jeder Statuswechsel kommt mit Person, Zeit und Foto ins Protokoll.
- **Abnehmen** dürfen die Bauleitung und der Ersteller, wenn er Polier oder Bauherr ist. **Ein NU nimmt nie ab**, auch nicht einen Mangel, den er selbst gemeldet hat.

## Nachweis
- Der NU meldet „behoben“ mit Foto, es gibt eine Vorher/Nachher-Ansicht.
- Wiederholte Ablehnungen zählen in die NU-Bewertung.

## Merkfunktion
- Vorschläge für Mangelart, Beschreibung, Priorität, Frist und Zuständigkeit je Gewerk.
- „Wie letzter Mangel“ übernimmt alles außer Foto und Ort.
- Nach Wiederholung: „Als Vorlage speichern?“
- Schalter pro Benutzer und Feld; Ebene persönlich / Projekt / Firma; gemerkte Werte lassen sich einsehen, bearbeiten und löschen.
- Die Bauleitung kann Mangelkataloge je Gewerk festlegen.

## Eigene Felder
Typen Text, Auswahl, Zahl, Datum, Ja/Nein; je Gewerk/Projekt; Pflicht oder optional; Sichtbarkeit pro Rolle; ebenfalls merkbar.

## Eskalation (Startwerte, einstellbar pro Priorität und Projekt)
| Zeitpunkt | Aktion |
|---|---|
| 2 Tage vor Fristende | Erinnerung an den NU |
| Fristende | Status „überfällig“, Nachricht an NU und Polier |
| +7 Tage | Meldung an die Bauleitung |
| +14 Tage | Meldung an die Geschäftsführung und Eintrag in die NU-Bewertung |

Kritische Mängel haben **keine eigenen Eskalationszeiten**; sie unterscheiden sich nur durch die kürzere Frist (Startwert 3 Tage).

### Anzeige in der Mängeltabelle und 2. Nachfrist (entschieden)
- Die Eskalation wird **direkt in der Mängeltabelle** angezeigt: eine Spalte mit der aktuellen Eskalationsstufe (z. B. „Frist läuft“, „Frist in 2 Tagen“, „überfällig seit 5 Tagen“, „an Bauleitung gemeldet“), farbig als Ampel, filter- und sortierbar.
- Ist die Frist abgelaufen, schlägt die App in der Tabelle eine **2. Nachfrist** vor (Datum vorbelegt). Die Bauleitung übernimmt den Vorschlag, ändert das Datum oder verwirft ihn. Die gesetzte Nachfrist kommt ins Protokoll und wird dem NU mitgeteilt.

> ❓ **OFFEN – Länge der 2. Nachfrist:** ANNAHME bis zur Klärung: 7 Tage ab Setzen, bei kritischen Mängeln 3 Tage, einstellbar pro Projekt und Priorität. Was passiert nach Ablauf der 2. Nachfrist (z. B. Vorschlag Ersatzvornahme/Einbehalt)? Bleiben die automatischen Nachrichten aus der Tabelle oben erhalten (Annahme: ja)?

## Weiteres
- Mängelliste als PDF (je Gewerk, Geschoss, Abnahme).
- Offene Mängel blockieren die Endabnahme.
- Kostenfolge (Einbehalt, Ersatzvornahme), verknüpft mit Rechnung bzw. Nachtrag.
- Auswertungen: Quote, Behebungsdauer, Wiederholer.

## Ansichten
- **Polier:** „Heute“
- **Bauleitung:** Liste + Plan + Filter + Ampel
- **NU:** nur eigene Mängel
- **Bauherr:** eigene und abnahmerelevante Mängel, ohne interne Notizen
