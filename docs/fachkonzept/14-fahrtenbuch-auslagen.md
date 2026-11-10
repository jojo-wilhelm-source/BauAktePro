# Fahrtenbuch und Baustellen-Einkäufe

Stufe 3 (Geld). Beides ist **neu** und stand nicht im ursprünglichen Fachkonzept (entschieden 10.11.2026).

## Fahrtenbuch (einfach, kein Finanzamt-Fahrtenbuch)
- **Fahrzeuge** der Firma: Kennzeichen, Bezeichnung, Kraftstoff, zugeordnete Person (optional).
- **Fahrt:** Datum, Fahrzeug, Fahrer, km-Stand Start und Ende (km wird berechnet), Projekt (optional), Zweck.
  - Vorschlag: km-Stand Start = letzter km-Stand Ende des Fahrzeugs.
  - Warnung bei Lücken oder Rücksprüngen im km-Stand, aber keine Sperre.
- **Tanken:** Datum, Fahrzeug, Liter, Betrag (brutto), km-Stand, Tankstelle, Foto vom Beleg.
  - Verbrauch (l/100 km) zwischen zwei Tankvorgängen wird berechnet.
- **Auswertung:** km und Liter je Fahrzeug, Monat und Projekt; Export als CSV/PDF.
- Offline erfassbar (iPhone im Auto).
- ANNAHME: Kein ordnungsgemäßes Fahrtenbuch im steuerlichen Sinn. Einträge sind änderbar, Änderungen kommen ins Audit Log.

## Baustellen-Einkäufe (Auslagen)
- **Erfassen:** wer gekauft hat, Datum, Händler, Betrag brutto/netto/MwSt., Projekt, Gewerk/Kostengruppe, Zweck, **Foto vom Beleg**, Zahlungsart (Firmenkarte, bar, privat ausgelegt).
- **Freigabe:** Die Bauleitung des Projekts gibt frei oder lehnt mit Grund ab (Audit Log).
- Freigegebene Einkäufe fließen in die **Kostenübersicht** des Projekts.
- Privat ausgelegte Beträge sind **erstattbar**: Liste „zu erstatten“ je Person, Übergabe an die Buchhaltung (DATEV-Export wie bei Rechnungen). Die App zahlt nicht aus.
- Rechte: Jeder Projektbeteiligte der eigenen Firma darf erfassen und sieht eigene Einkäufe; Bauleitung, Einkauf und Geschäftsführung sehen alle des Projekts. NU und Bauherr sehen nichts.
- ❓ OFFEN (D3): Betragsgrenze, ab der die Geschäftsführung freigeben muss? Erstattung über die Lohnabrechnung oder separat?

## Umsetzungsstand (10.11.2026)
- **Einkäufe:** Web (Liste, Filter, Freigabe/Ablehnung mit Grund, Entscheidung zurücknehmen, „erstattet“ für privat ausgelegte Beträge, Belegfoto) und iPhone (Erfassen offline mit Belegfoto, Liste „Meine Einkäufe“). Nummer vergibt der Server (`EK-…`), doppelter Upload aus der App erzeugt keinen zweiten Einkauf.
- **Fahrtenbuch:** Fahrzeuge auf Firmenebene; Fahrt und Tanken im Web und offline am iPhone (km-Start wird mit dem letzten bekannten Stand vorbelegt, Lücken/Rücksprünge nur als Warnung). Verbrauch je Tankvorgang, CSV-Export im Web.
- **Rechte** (RLS + Sync-Regeln, Tests in `apps/api/test/rechte.test.ts`): Einkäufe sieht der Erfasser selbst, Bau-/Projektleitung und Einkauf sehen alle des Projekts, NU und Bauherr nichts. Fahrten und Tanken sieht der Fahrer selbst, Bau-/Projektleitung alle; Fahrzeuge legt die Leitung an.
- ANNAHME (D2): „Geschäftsführung“ ist noch keine eigene Rolle; bis dahin sieht die Bau-/Projektleitung alle Fahrten.
- Noch offen: Einkäufe/Fahrten nachträglich ändern (mit Audit Log), Auswertung je Monat als PDF, DATEV-Übergabe der Erstattungen.
