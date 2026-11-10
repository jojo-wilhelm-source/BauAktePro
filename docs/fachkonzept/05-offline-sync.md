# Offline-Modus und Synchronisation

## Was offline verfügbar ist
- **Immer (automatisch):** gültige Grundrisse und Übersichtspläne aller eigenen Projekte, Projektstruktur, Kontakte, eigene offene Mängel und Aufgaben, Checklisten, Vorlagen, Merkfunktion.
- **Wahlweise:** Detail- und Werkpläne, Fotos, Protokolle, Verträge, ganze Ordner oder Geschosse („Offline halten“), mit Speicherlimit pro Gerät.

## Offline erfassbar
Mängel, Bautagebuch, Stunden, Wareneingang, Checklisten, Kommentare, Aufgaben, Uploads (Warteschlange).

## Grundsatz: Auf der Baustelle ohne Netz arbeiten (bekräftigt 10.11.2026)
Alles, was auf der Baustelle passiert, muss **ohne Internet** funktionieren und wird automatisch hochgeladen, sobald wieder Netz da ist. Jedes neue Modul wird so gebaut: Daten liegen auf dem Gerät, IDs entstehen auf dem Gerät, Änderungen gehen in die Upload-Warteschlange, der Server prüft beim Abgleich.

| Modul | Offline auf dem Gerät | Braucht Netz |
|---|---|---|
| Mängel | lesen, erfassen (Pin, Raum aus Pin), Status vormerken | – |
| Pläne | **alle Pläne des Projekts werden bei Netz automatisch aufs Gerät geladen**, auch ungeöffnete | Planfreigabe wird vorgemerkt |
| Mangelanzeigen | lesen (Bauleitung, Polier, NU: eigene versendete) | **Versenden** (E-Mail); später: Entwurf offline anlegen |
| Besprechungen | Protokoll schreiben, Teilnehmer, Punkte | Versand an Teilnehmer |
| Bautagebuch | Tagesbericht, Wetter, Personal, Fotos, Unterschrift | – |
| Fahrtenbuch | Fahrt, km-Stand, Tanken mit Belegfoto | – |
| Baustellen-Einkäufe | Beleg mit Foto erfassen | Freigabe wird vorgemerkt |
| Rechnungen | lesen | Einreichung/Freigabe vorgemerkt, Export an die Buchhaltung online |
| Dokumente | Ordner „offline halten“ | Upload großer Dateien bevorzugt im WLAN |

**Stand 10.11.2026 umgesetzt und im Simulator geprüft (iPhone 12):** Plan offline öffnen, Mangel offline auf dem Plan erfassen, Raum aus der Pin-Position, automatisches Hochladen mit Erfassungszeitpunkt beim Verbinden.

## Entscheidungen offline vormerken (entschieden)
Plan-Freigaben und -Ablehnungen, Abnahmen und Rechnungsfreigaben lassen sich **offline vormerken**:
1. Die Entscheidung wird lokal mit Person, Zeit, Gerät und dem **Stand, auf dem sie beruht** (Version/Index des Objekts) gespeichert. Sie ist deutlich als „vorgemerkt, noch nicht wirksam“ gekennzeichnet.
2. Beim Verbinden prüft der **Server** gegen den aktuellen Stand: Rechte noch vorhanden? Objekt unverändert (gleiche Version, z. B. kein neuer Index, kein neuer Mangel-Status)?
3. **Unverändert:** Die Entscheidung wird wirksam, Zeitpunkt der Wirksamkeit und der ursprüngliche Zeitpunkt kommen beide ins Audit Log.
4. **Geändert:** Die Entscheidung wird nicht angewendet, sondern der Person zur erneuten Entscheidung vorgelegt (mit Hinweis, was sich geändert hat).

**Nur online:** Rechteverwaltung.

## Sync
- Automatisch im Hintergrund, die Warteschlange ist sichtbar.
- Neue Planstände zuerst. Große Dateien nur im WLAN. Fotos erst klein, dann im Original.
- Offline angezeigte Pläne tragen „Stand zuletzt geprüft: …“. Gibt es einen neuen Index, erscheint beim Verbinden sofort eine Warnung.

## Konflikte
Nie still überschreiben: Beide Änderungen bleiben erhalten und werden zur Klärung angezeigt.

## Sicherheit
- Verschlüsselter lokaler Speicher, Geräte-Code bzw. Face ID.
- Geräte lassen sich per Admin sperren und löschen.
- Rechte werden beim nächsten Sync geprüft: Werden Rechte entzogen, verschwinden die Daten vom Gerät.

## Umsetzungsstand (10.11.2026): Gerät synchronisieren
- **Alles auf dem Gerät:** Daten aller eigenen Projekte (Mängel, Pläne, Besprechungen, Einkäufe, Fahrten, Ordner und Dokumente) kommen per Abgleich; die **Dateien** (alle Pläne, alle Mangelfotos, alle freigegebenen Dokumente) werden danach automatisch geladen – Pläne zuerst, dann Dokumente, dann Fotos.
- ANNAHME: Statt „Ordner offline halten“ liegen zunächst **alle freigegebenen Dokumente** auf dem Gerät (Datenmengen im Test klein). Auswahl je Ordner und Speicherlimit folgen, wenn nötig (offene-punkte D7).
- **Zwei Modi** (Mehr → Offline & Abgleich): *Automatisch* (Standard, verbunden, sobald Netz da ist) oder *Nur per Klick* (Gerät bleibt offline, gleicht nur bei „Jetzt abgleichen“ ab, z. B. um mobile Daten zu sparen).
- **Jetzt abgleichen** (Knopf, Statusanzeige oben antippen oder Mängelliste nach unten ziehen): erst Upload der Warteschlange, dann neue Daten, dann Fotos/Belege, dann fehlende Dateien.
- **Übersicht:** Verbindung, letzter Abgleich, was auf Upload wartet (Änderungen, Fotos, Belege), was auf dem Gerät liegt (je Art Anzahl und Speicher).
- **Aufräumen:** Dateien, die man nicht mehr sehen darf oder die ersetzt sind (neuer Planindex, neue Dokumentversion), werden nach einem vollständigen Abgleich gelöscht – nie vorher. Selbst aufgenommene Fotos in der Upload-Warteschlange werden nie gelöscht.
- Dokumente in der App: Mehr → Dokumente, nach Ordnern, offline lesbar (PDF mit Freigabe-Stempel und QR-Code).
- Im Simulator geprüft (iPhone 12): manueller Modus, neues Dokument im Büro freigegeben → erst nach „Jetzt abgleichen“ auf dem Gerät, danach ohne Netz geöffnet.
