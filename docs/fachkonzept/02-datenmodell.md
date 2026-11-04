# Datenmodell (Grundgerüst)

```
Projekt → Ort (Gebäude, Geschoss, Abschnitt, Raum; rekursiv) → Plan
Gewerk ↔ Nachunternehmer ↔ Auftrag (+ Nachtrag)
Benutzer ↔ Projektrolle (Rolle pro Projekt) + Firmenrolle
Datei (Version/Index, Status, Ordner, Verknüpfungen) · Ordner (mit Alt)
Mitteilungen · Aufgaben (aus Beschlüssen/Punkten) · Vorlagen · Werte der Merkfunktion
```

## Gemeinsame Felder aller Fachobjekte
Mangel, Protokollpunkt, Tagesrapport, Bemusterungsposten, Lieferung, Bestellung, Rechnung, Stundenbuchung … haben alle:

- `projekt_id`, `ort_id`, `gewerk_id`
- `status` (Statuskette konfigurierbar)
- `sichtbarkeit` (intern / Bauherr / NU)
- `erstellt_von`, `erstellt_am`
- Änderungsprotokoll (Audit Log)
- Zusatzfelder (JSON, für eigene Felder)
- Verknüpfungen zu anderen Objekten (allgemeine Link-Tabelle)

## Offline-Anforderungen ans Modell
- IDs werden auf dem Gerät erzeugt (UUID).
- Änderungsverlauf und Versionsstand pro Objekt (für die Konflikterkennung).
- Papierkorb statt hartem Löschen (Soft Delete).

## Für später vorbereiten
- **Stufe 2:** Anfrage → Angebote → Vergabe → Bestellung.
- **Stufe 4:** Sync-Ordner mit denselben Rechten und Status.

## Mandanten (entschieden)
Zum Start gibt es nur **eine** Firma. Trotzdem bekommt jede Tabelle eine `firma_id` (bzw. erbt sie über `projekt_id`), und Firmen-Einstellungen hängen an dieser ID. So bleibt ein späterer Betrieb für mehrere Firmen offen, ohne das Modell umzubauen. Eine Oberfläche zur Verwaltung mehrerer Firmen wird **nicht** gebaut.

## Benennung im Code (entschieden)
Bezeichner sind **englisch**, deutsche Fachbegriffe ohne gute Übersetzung bleiben deutsch: `project_id`, `location_id`, `gewerk_id`, `status`, `visibility`, `created_by`. Deutsche Fachbegriffe: Gewerk, Nachtrag, Bemusterung, Regie, Polier, Bautagebuch, Abschlag (z. B. `Gewerk`, `Nachtrag`, `BemusterungItem`). Feldnamen in diesem Fachkonzept sind fachliche Namen, keine Spaltennamen.

> ❓ **OFFEN – Datenschutz vs. Unveränderlichkeit** (Hosting in Deutschland ist entschieden): Personenbezogene Daten (Arbeiter, Nachweise) unterliegen Löschpflichten (DSGVO), das Audit Log soll aber unveränderlich sein. Vorschlag: Personendaten im Log nur per Verweis speichern, damit sie sich anonymisieren lassen. Aufbewahrungsfristen sind festzulegen.
