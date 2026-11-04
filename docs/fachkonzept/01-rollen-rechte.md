# Rollen und Rechte

Rollen gelten **pro Projekt**. Zusätzlich gibt es **Firmenrollen** für die projektübergreifende Sicht (Einkauf, Geschäftsführung). Rechte werden immer serverseitig geprüft.

| Rolle | Darf | Sieht nicht |
|---|---|---|
| **Bauleitung** | Alles im Projekt: prüfen, freigeben, abnehmen, Besprechungen leiten, Nachträge bis zur Freigabegrenze freigeben | – |
| **Polier** | Mängel, Tagesrapport, Wareneingang, Bedarf melden, Besprechung mitschreiben | Preise, Rechnungen |
| **NU** | Eigene Mängel bearbeiten und melden, Stunden und Arbeiter erfassen, Rechnungen einreichen, Lieferungen anmelden, Besprechungspunkte vorschlagen | Andere NU, interne Punkte, fremde Preise |
| **Bauherr** | Pläne (bestimmte Typen) und Bemusterungen freigeben, Status und Berichte sehen, Mängel melden und einem NU zuweisen (wirksam erst nach Bestätigung durch die Bauleitung) | NU-Preise, interne Notizen, Stundendetails, Allowance (falls ausgeblendet) |
| **Einkauf** (Firma) | Bedarf, Bestellungen, Lieferungen, kaufmännische Rechnungsprüfung, Lieferantenstamm | Mängel ohne Kostenbezug, Details aus dem Bautagebuch, Stundenbuchungen und Arbeiterdaten |
| **Geschäftsführung** (Firma) | Freigaben über den Grenzen, Auswertungen, Frühwarnung, projektübergreifende Sicht | – |

**Sicht des Einkaufs (entschieden):**
- **Ausgeblendet:** Mängel ohne Kostenbezug (ohne Verknüpfung zu Lieferung, Bestellung, Nachtrag oder Kostenfolge), Details aus dem Bautagebuch (Personal, Behinderungen, Unfälle), NU-Stundenbuchungen und Arbeiterdaten.
- **Sichtbar:** Mängel mit Kostenbezug, Lieferungen des Tages aus dem Bautagebuch, interne Protokollpunkte (soweit sie den Einkauf betreffen).

## Freigabegrenzen
- Konfigurierbar pro Firma und Projekt, später auch pro Person.
- Startwert: Nachträge und neue Verträge **bis einschließlich 50.000,00 € netto** gibt die Bauleitung frei, darüber die Geschäftsführung.

## Sichtbarkeit
- Jedes Objekt hat ein Sichtbarkeitsattribut: **intern / Bauherr / NU**. Abfragen werden serverseitig gefiltert.
- Ein NU sieht immer nur seine eigenen Gewerke, Aufträge, Mängel und Pläne.

## Externe Zugänge
- Per Einladung (Link oder E-Mail).
- **Einmal-Links ohne Login** nur für Bemusterungsentscheidungen: zeitlich begrenzt, nur einmal nutzbar, an eine E-Mail-Adresse gebunden, abschaltbar.
