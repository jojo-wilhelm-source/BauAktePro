# Mängelmanagement

## Erfassen
- Pin im Plan oder QR-Code am Raum, Fotos mit Markierung, Text oder Sprache.
- **Genaue Verortung (entschieden 10.11.2026):** Der Plan lässt sich zoomen, der Pin sitzt auch im Zoom genau. Der **Raum wird aus der Pin-Position abgeleitet** (Raumflächen je Plan hinterlegt) und nur vorgeschlagen, die Person kann ihn ändern. Mehrere Fotos je Mangel, jedes mit Markierungen (Pfeil, Kreis, Text).
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
| +14 Tage | entfällt (entschieden 12.11.2026: keine Eskalation an die Geschäftsführung, sie hat keinen Zugang) |

Kritische Mängel haben **keine eigenen Eskalationszeiten**; sie unterscheiden sich nur durch die kürzere Frist (Startwert 3 Tage).

### Anzeige in der Mängeltabelle und 2. Nachfrist (entschieden)
- Die Eskalation wird **direkt in der Mängeltabelle** angezeigt: eine Spalte mit der aktuellen Eskalationsstufe (z. B. „Frist läuft“, „Frist in 2 Tagen“, „überfällig seit 5 Tagen“, „an Bauleitung gemeldet“), farbig als Ampel, filter- und sortierbar.
- Ist die Frist abgelaufen, schlägt die App in der Tabelle eine **2. Nachfrist** vor (Datum vorbelegt). Die Bauleitung übernimmt den Vorschlag, ändert das Datum oder verwirft ihn. Die gesetzte Nachfrist kommt ins Protokoll und wird dem NU mitgeteilt.

> ❓ **OFFEN – Länge der 2. Nachfrist:** ANNAHME bis zur Klärung: 7 Tage ab Setzen, bei kritischen Mängeln 3 Tage, einstellbar pro Projekt und Priorität. Was passiert nach Ablauf der 2. Nachfrist (z. B. Vorschlag Ersatzvornahme/Einbehalt)? Bleiben die automatischen Nachrichten aus der Tabelle oben erhalten (Annahme: ja)?

## Mangelanzeige (entschieden 10.11.2026)
- Die Bauleitung fasst mehrere Mängel eines NU zu einer **Mangelanzeige** zusammen. Jeder Mangel wird eine nummerierte **Position** (1, 2, 3 …) mit Ort, Beschreibung, Foto und Planausschnitt mit Pin.
- Kopf: Projekt, NU, Vertrag/Gewerk, Datum, Aufforderung zur Beseitigung bis zur **Frist** (vorbelegt aus den Mängelfristen, änderbar), Unterschrift der Bauleitung.
- Erzeugt wird ein **PDF** im Firmenlayout. Versand per E-Mail an den NU direkt aus der App, Kopie an die Bauleitung. Das PDF wird in der Dateiablage beim Projekt und beim NU abgelegt.
- Eine versendete Mangelanzeige ist **gesperrt** (Audit Log: wer, wann, an wen). Korrekturen sind eine neue Anzeige mit Verweis.
- In der Mängeltabelle sieht man, in welcher Anzeige ein Mangel steht und wann sie verschickt wurde. Die gesetzte Frist wird zur Frist der Mängel.
- Später: **2. Mangelanzeige** mit Nachfrist (siehe B7) aus denselben Positionen.
- ❓ OFFEN (D1): Rechtlicher Wortlaut (VOB/B § 13 Abs. 5 oder BGB), Versand nur per E-Mail oder zusätzlich als Einschreiben-Vermerk.

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

## Umsetzungsstand (10.11.2026): Liste, Ordner, Mängelbericht
- **Sortieren** nach Nummer, Firma, Datum (neueste/älteste zuerst), Frist, Ort.
- **Ordner-Ansicht** (separate Ansicht neben der Liste): Ordner und Unterordner nach Firma, Geschoss, Raum, Gewerk, Monat, Tag oder Status (z. B. Firma › Monat), auf- und zuklappbar.
- **Auswahl** per Häkchen (einzeln, ganzer Ordner, alle). Der **Mängelbericht** enthält nur die ausgewählten Mängel (ohne Auswahl: alle der Ansicht), in derselben Reihenfolge und mit denselben Ordnern als Überschriften, vorne eine Übersicht. Je Ordner gibt es einen eigenen „PDF“-Knopf.
- Rechte: Der Bericht enthält nur, was die Person sehen darf (RLS); ein NU bekommt fremde Mängel auch über eine manipulierte Auswahl nicht.

## Umsetzungsstand (12.11.2026): QR-Freimeldung je Mangelanzeige
- Jede **versendete Mangelanzeige** bekommt einen Link, als **QR-Code auf dem PDF** (unter dem Anschreiben) und als Link in der E-Mail an den Nachunternehmer.
- **Wer den Link hat** (z. B. der Monteur vor Ort, ohne Konto), sieht nur diese eine Anzeige: Positionen mit Beschreibung, Ort, Gewerk, Foto und Status, keine Preise oder anderen Mängel. Er trägt **Name und Firma** ein (bleibt auf seinem Gerät gespeichert) und meldet je Position:
  - **Behoben** mit **Pflicht-Foto** und optionalem Kommentar → Mangel „Behoben gemeldet“, das Foto wird Nachweisfoto am Mangel.
  - **Rückfrage** mit Pflicht-Kommentar → Mangel „Strittig“.
- Die **Bauleitung bekommt eine E-Mail** und entscheidet in der Mangelanzeige (Bereich „Freimeldungen per QR-Link“) oder am Mangel: **Abnehmen** oder **Nicht behoben** (Frist läuft weiter). Eine Freimeldung allein schließt nichts ab.
- **Link-Verwaltung** (nur Bau-/Projektleitung, in der Mangelanzeige): QR-Code anzeigen, Link kopieren, **sperren / wieder freigeben**, **neu erzeugen** (der alte Link, auch auf dem PDF, gilt dann nicht mehr). Der Link gilt **ohne Ablauf** (entschieden 12.11.2026).
- Protokoll: Jede Freimeldung und jede Link-Änderung steht im Audit Log; Freimeldungen über den Link mit dem eingetippten Namen und der Firma („per QR-Link“).
- Schutz: Langer Zufallsschlüssel je Anzeige; höchstens 30 Meldungen je Link und IP in 10 Minuten; Fotos höchstens 15 MB (JPG, PNG, HEIC).

## Nachträglich bearbeiten (entschieden 12.11.2026)
- Bauleitung und Polier bearbeiten Text, Ort (auch per Raum-QR), Gewerk und Priorität; die Bauleitung zusätzlich Frist und Bauherr-Sichtbarkeit. Im Web („Bearbeiten“ im Mangel) und in der App, auch offline (Warteschlange, geprüft gegen den aktuellen Stand).
- Jede Änderung steht im Protokoll. Abgenommene Mängel bleiben gesperrt (Grundprinzip 3).
- Ebenso korrigierbar: eigene Fahrten und Tankvorgänge (Leitung: alle), eigene Einkäufe solange „eingereicht“, Kontakte, Besprechungspunkte (in der Folgesitzung), Bautagebuch-Entwürfe (danach Nachtrag), LV-Entwürfe.
