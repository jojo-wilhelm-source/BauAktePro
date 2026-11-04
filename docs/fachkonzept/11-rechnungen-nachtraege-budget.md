# Rechnungen, Nachträge, Budget

**Keine Zahlungsauslösung.** Die App gibt frei und übergibt an die Buchhaltung.

## Eingang
- NU-Portal, E-Mail an die Projektadresse, Foto/Scan.
- E-Rechnung (XRechnung/ZUGFeRD) wird direkt eingelesen, PDFs per Texterkennung.
- Arten: Abschlag, Teilrechnung, Schlussrechnung, Regie, Nachtrag.
- Prüf- und Zahlungsfristen laufen ab Eingang.

## Prüfung pro Position
Ampel grün/gelb/rot, Kürzung mit Begründung. Geprüft wird gegen:
- Auftrag (Summe, bisher abgerechnet, Rest, Nachträge)
- Leistungsstand/Aufmaß aus dem Bautagebuch
- bestätigte Stunden und Anordnungen
- Lieferungen und Mengenabgleich
- offene Mängel und möglichen Einbehalt
- Nachweise (Freistellung, Versicherung, SOKA/Unbedenklichkeit)
- Rechnerisches, USt, Hinweis auf Bauabzugsteuer, Doppelrechnung

## Ablauf
```
Eingegangen → Zuordnung → Fachliche Prüfung (Bauleitung) → Kaufmännische Prüfung → Freigabe
→ Übergabe an Buchhaltung → Bezahlt (Rückmeldung per Schnittstelle oder manuell)
```
Nebenstatus: gekürzt, zurückgewiesen (mit Begründung an den NU), strittig. Der NU sieht Status, Kürzungen und Zahlungstermin.

> ❓ **OFFEN – Betragsgrenze für Rechnungen:** Gilt zusätzlich zur Kette Bauleitung → Kaufmann eine Betragsgrenze (z. B. Schlussrechnung ab X € durch die Geschäftsführung)? Die Nachtragsgrenze gilt **nicht** automatisch für Rechnungen.

## Übergabe an die Buchhaltung
Zahlungsdatensatz (Rechnung, NU, Betrag, Kürzungen, Einbehalt, Skonto, Fälligkeit, Kostenstelle) per Export bzw. DATEV.

## Abschlagsrechnungen
- Je Auftrag wahlweise nach Zahlungsplan (feste Raten/Meilensteine) oder nach Leistungsstand/Aufmaß.
- Fortlaufend nummeriert; werden in der Schlussrechnung automatisch angerechnet.
- Übersicht pro Auftrag: Summe, Abschläge, Rest, Einbehalte.

## Nachträge
```
Angebot → Prüfung → Beauftragung → (erst dann abrechenbar)
```
- Unbeauftragte Nachträge werden bei der Rechnungsprüfung markiert.
- Freigabe bis 50.000 € durch die Bauleitung, darüber durch die Geschäftsführung (siehe [01-rollen-rechte.md](01-rollen-rechte.md)).

## Einbehalte und Bürgschaften
Sicherheitseinbehalt, Gewährleistungsbürgschaft, Rückgabetermine; Skonto- und Zahlungsfristen mit Erinnerung.

## Budget und Frühwarnung
- Pro Gewerk: Auftrag, Nachträge, geprüft, freigegeben, bezahlt, Einbehalt, Rest, Prognose.
- Warnung bei Überschreitung oder auffälligen Kürzungen.
- Der Bauherr sieht höchstens freigegebene Summen, falls gewünscht.
