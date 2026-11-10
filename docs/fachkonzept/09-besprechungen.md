# Besprechungsprotokolle

## Zwei Arten mit eigenen Vorlagen
- **Bau-Besprechung** (Bauleitung, Bauherr, Planer): Termine, Pläne, Bemusterungen, Kosten, Mängel.
- **NU-Besprechung** (Bauleitung, Polier, NU): nach Geschossen und Abschnitten.

## Ablauf
```
Einladung (Kalender) → vorbefüllte Tagesordnung → Durchführung am iPad (auch offline)
→ Entwurf → Prüfung durch Bauleitung → Versand → Einspruchsfrist → genehmigt und gesperrt (PDF in der Ablage)
```
Die Tagesordnung wird vorbefüllt mit: offenen Punkten der letzten Besprechung, überfälligen Mängeln, fehlenden Plänen und Freigaben, Verzug, offenen Nachträgen.

## NU-Besprechung nach Geschoss
- Gliederung Gebäude → Geschoss → Abschnitt, dazu ein Block „Allgemein / Gesamtbaustelle“.
- Vor der Besprechung wählbar, welche Geschosse drankommen.
- Pro Geschoss lassen sich Punkte einem oder mehreren NU zuweisen (Frist, Verantwortlicher).
- Kategorien frei konfigurierbar (Voreinstellung: Neuer Punkt, Wichtig, Wiederholt, Mangel, Termin, Erledigt).
- Ansichten nach Geschoss, nach NU und nach Kategorie, jeweils als PDF.
- Offene Punkte erscheinen im Folgeprotokoll automatisch im richtigen Geschoss (als „Wiederholt“), erledigte entfallen.

## NU-Besprechung: Aufbau eines Punkts (entschieden 10.11.2026, nach Vorlage des Nutzers)
Jeder Punkt hat: **fortlaufende Nummer** (`P-014`, pro Projekt), **Ort** (Geschoss/Bauteil oder „Allgemein“), **Gewerk**, **Aufgabe** (Text), **Verantwortlich** (ein NU oder die eigene Firma), **Zuarbeit** (weitere NU), **Frist**, **Status**, optional **Plan-PIN** und „nur intern“.

**Status** (Farben wie die PINs im Plan):
| Status | Farbe | Bedeutung |
|---|---|---|
| Offen | Rot | noch nicht begonnen |
| In Arbeit | Orange | läuft |
| Erledigt | Grün | wird in der Folgesitzung archiviert |
| Info | Blau | Information/Vorleistung, keine Aufgabe |

- Ein Punkt lebt über mehrere Sitzungen. Jede Sitzung hält fest, welche Punkte mit welchem Status darin standen (Momentaufnahme beim Versand, danach gesperrt).
- **„Folgesitzung vorbereiten“ (1 Klick):** neue Sitzung, alle Punkte mit „Offen“ und „In Arbeit“ wandern mit, „Erledigt“ wird archiviert. ANNAHME: „Info“-Punkte wandern nicht automatisch mit, man kann sie bewusst übernehmen.
- **Auf Plan anzeigen / PIN setzen:** Ein Punkt kann einen PIN im Plan bekommen. Im Planviewer lässt sich filtern: „nur Punkte aus Besprechung Nr. 42“.
- **Am Tablet während der Besprechung**, auch offline: Status-Chips antippen (Rot → Orange → Grün), neue Punkte anlegen. Der Abgleich läuft wie bei den Mängeln.
- **Versand:** Protokoll als PDF an alle Teilnehmerfirmen; zusätzlich bekommt jeder NU seine **persönliche Aufgabenliste** (nur seine Punkte als Verantwortlicher oder Zuarbeit) als eigenes PDF.
- **Überfällige Mängel** der teilnehmenden NU werden in der Sitzung und im Protokoll mit aufgeführt.
- **Rechte:** Protokoll führen Bauleitung und Polier; versenden nur die Bauleitung (ANNAHME). Der NU sieht nur versendete Sitzungen, an denen er teilnimmt, und nur seine eigenen, nicht internen Punkte.

## Personalisierbar
Reihenfolge der Blöcke, Überschriften, Zusatzfelder je Punkt, Kopfzeile/Logo; Vorlagen pro Firma, Projekt und persönlich; Blöcke lassen sich während der Besprechung hinzufügen, verschieben und ausblenden.

## NU-Vorschläge
- NU legen im Portal Vorschläge an (Geschoss, Text, Foto, Kategorie). Sie landen in „Für nächste Besprechung“ und werden automatisch ins passende Geschoss der Tagesordnung gesetzt („vorgeschlagen von NU X“).
- Die Bauleitung übernimmt, ändert, stellt zurück oder lehnt mit Begründung ab (sichtbar für den NU).
- „Dringend“ löst sofort eine Benachrichtigung aus.
- Doppelte Vorschläge (gleicher Ort, gleiches Thema) werden zusammengeführt.

## Weiteres
- Fortlaufende Punktnummern (`P-014`).
- Beschlüsse werden zu Aufgaben mit Frist und Eskalation.
- Einzelne Punkte „nur intern“ (im Versand ausgeblendet).
- Optional Unterschrift (siehe ❓ Rechtssicherheit in [07-bautagebuch-bauzeitenplan.md](07-bautagebuch-bauzeitenplan.md)).
- KI-Entwurf aus Sprachaufnahme (muss immer geprüft werden).
- Suche über alle Protokolle.

> ❓ **OFFEN – Annahmen bis zur Bestätigung:** Die Bauleitung führt das Protokoll; Einspruchsfrist 7 Tage; Einladungen über iPhone-Kalender/Outlook.
