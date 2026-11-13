# 16 Fotodokumentation auf Plänen (entschieden 12./13.11.2026)

Zweck: Zustände festhalten, bevor sie verschlossen werden – Wände vor dem Beplanken, Schächte, Doppelböden, Hohlraum- und Abhangdecken, Installationen –, dazu Bestand und Baufortschritt. Jedes Foto hat eine Stelle auf dem Plan, eine Kategorie und einen Raum.

## Ablauf
- **App (iPhone/iPad, offline):** auf dem Plan eine freie Stelle tippen → „Foto dokumentieren“ (oder „Mangel erfassen“). Foto aufnehmen oder aus „Fotos“ wählen, Kategorie, Titel, Notiz. Der Raum ergibt sich aus der Stelle (Raumflächen des Plans). Ohne Netz liegt alles auf dem Gerät und wird später hochgeladen.
- **Web:** Seite „Fotodokumentation“: Plan mit Foto-Pins (Kamera, 360° lila), daneben die Galerie mit Vorschaubildern; Filter nach Plan und Kategorie; „Foto auf Plan setzen“ (mehrere Dateien auf einmal) oder „Fotos ohne Planposition“.
- **Mangel aus Foto:** Beschreibung, Gewerk, Frist → Mangel mit derselben Planposition und demselben Ort, das Foto wird angehängt; das Foto verweist danach auf den Mangel.
- Bearbeiten (Kategorie, Titel, Notiz, 360°), Entfernen = Papierkorb (eigene Fotos; fremde nur die Bauleitung). Alles im Audit Log.

## 360°-Fotos (Insta360)
- Erkannt am Seitenverhältnis 2:1 (equirectangular, ab 2000 px Breite) oder an XMP „ProjectionType equirectangular“; von Hand umschaltbar.
- Anzeige als Rundumansicht (eigener WebGL-Viewer, gleiche Logik in Web und App, offline): ziehen/wischen zum Umsehen, Mausrad/zwei Finger zum Zoomen.
- **Heute:** In der Insta360-App das Foto als 360°-Foto exportieren (in „Fotos“ speichern) und in Bau Akte Pro „Aus Fotos (auch 360°)“ wählen.
- **Direkt mit der Insta360 aufnehmen (13.11.2026):** In der App „Mit Insta360 aufnehmen“: iPhone/iPad mit dem WLAN der Kamera verbinden, „Verbinden“ (zeigt Modell und Akku), „Auslösen“ – die App löst über die offizielle OSC-Schnittstelle aus (X3, X4, X5, ONE RS …, Adresse 192.168.42.1), wartet, bis die Kamera das 360°-Bild zusammengesetzt hat, und überträgt es direkt an die Stelle auf dem Plan. Ohne Internet. In der Kamera muss „Stitching in der Kamera“ an sein. Getestet mit einem Kamera-Simulator (`scripts/osc-kamera-simulator.mjs`); Test mit echter Kamera steht aus.
- Reines Bluetooth (Koppeln/Wecken der Kamera) bräuchte das Insta360-SDK auf Antrag (D14); die Bilder kommen auch dort über das Kamera-WLAN.
- Normale Fotos weiterhin mit der iPhone-Kamera oder aus „Fotos“, im Web per Hochladen (mehrere auf einmal).

## Serien an derselben Stelle (13.11.2026)
- Fotos an derselben Stelle von verschiedenen Tagen bilden eine Serie (`serie_id` = erstes Foto). Auf dem Plan ein Pin je Stelle mit Anzahl.
- Klick auf den Pin: Serienansicht – oben groß das gewählte Foto (360° oder normal), darunter alle Fotos als Vorschau mit Datum, blättern mit ‹ › oder Pfeiltasten. „Neues Foto an dieser Stelle“ hängt das nächste Foto an (Position und Raum vom ersten Foto).

## Rechte und Daten
- Sichtbar und bearbeitbar für Bauleitung/Projektleitung und Polier (RLS `app.is_internal`, Sync-Stream „intern“). ANNAHME: Bauherr und NU sehen die Fotodokumentation nicht (D13).
- Tabelle `foto_doku` (ID vom Gerät, Plan + Pin, Ort, Gewerk, Kategorie, Titel, Notiz, `ist_360`, Datei, Breite/Höhe, Aufnahmezeit, `mangel_id`, Papierkorb). Dateien im Fotospeicher, dazu ein Vorschaubild (480 px) für Listen und Pins.
- Kategorien sind Startwerte (später Konfiguration).
