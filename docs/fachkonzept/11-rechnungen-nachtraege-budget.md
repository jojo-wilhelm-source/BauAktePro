# Rechnungen, Nachträge, Budget

**Keine Zahlungsauslösung.** Die App gibt frei und übergibt an die Buchhaltung.

## Einreichung durch den NU (entschieden 10.11.2026)
- Der NU lädt über seinen Projektzugang **Nachträge** (Angebot) und **Rechnungen** hoch: PDF (später E-Rechnung), Art, Betrag netto, Bezug/Titel, Bemerkung.
- **Bau- und Projektleitung** sehen alle Einreichungen des Projekts (gleicher Zugang) und entscheiden: `Eingereicht → In Prüfung → Freigegeben | Abgelehnt (mit Begründung)`; Nachträge über der Freigabegrenze (50.000 € netto) gehen an die Geschäftsführung (ANNAHME: Status „Freigabe GF erforderlich“, Geschäftsführungs-Sicht folgt).
- Der NU sieht nur die eigenen Einreichungen, Status und Begründung. Andere NU, Bauherr und Polier sehen sie nicht (ANNAHME: Polier nicht – Kosten).
- Freigabe heißt nicht Zahlung: Rechnungen gehen danach in die Prüfung/Buchhaltungsübergabe (Abschnitt unten).

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

## Umsetzungsstand (10.11.2026)
- **Ein Menüpunkt „Nachträge & Rechnungen“**, darin getrennte Bereiche mit **eigenen Nummernkreisen** (`NT-001…`, `RE-001…`).
- **Entscheidung revidierbar:** Die Bau-/Projektleitung kann eine Freigabe, Ablehnung oder „GF erforderlich“ **zurücknehmen** (Grund Pflicht) – die Einreichung steht dann wieder „In Prüfung“. Im Audit Log als `entscheidung_zurueckgenommen`. Der NU kann eine Einreichung **zurückziehen**, solange sie noch niemand prüft.
- **Nachunternehmer-Verzeichnis** mit Kontaktdaten, Gewerken und Verträgen (Auftragssumme netto). Preise sieht nur die Leitung; der NU sieht nur sich selbst ohne Preise.
- **Kostenübersicht je Gewerk:** Budget (per Klick änderbar), Auftrag, Nachträge beauftragt/offen, abgerechnet, freigegebene Baustellen-Einkäufe, anerkannte Regiestunden, Prognose = Auftrag + beauftragte Nachträge + Einkäufe. Ampel: rot, wenn die Prognose inkl. offener Nachträge das Budget übersteigt, gelb ab 95 %. Nur Bau-/Projektleitung.
