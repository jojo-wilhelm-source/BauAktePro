# Offline-Modus und Synchronisation

## Was offline verfügbar ist
- **Immer (automatisch):** gültige Grundrisse und Übersichtspläne aller eigenen Projekte, Projektstruktur, Kontakte, eigene offene Mängel und Aufgaben, Checklisten, Vorlagen, Merkfunktion.
- **Wahlweise:** Detail- und Werkpläne, Fotos, Protokolle, Verträge, ganze Ordner oder Geschosse („Offline halten“), mit Speicherlimit pro Gerät.

## Offline erfassbar
Mängel, Bautagebuch, Stunden, Wareneingang, Checklisten, Kommentare, Aufgaben, Uploads (Warteschlange).

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
