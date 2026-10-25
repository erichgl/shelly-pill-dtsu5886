# Shelly The Pill – DTSU5886 Modbus-RTU Stromzähler

Liest einen 3-phasigen **DTSU5886**-Stromzähler (z. B. L-home, 3×230/400 V, 10(100) A) über **Modbus RTU** mit einem **Shelly „The Pill“ (S3SN-0U53X)** aus und stellt die Messwerte als **Virtual Components** im Shelly-Ökosystem bereit (App, Smart Control, Szenen, Home Assistant …).

Statt des offiziellen RS485-Add-ons wird ein **eigenes TTL↔RS485-Modul** direkt an die IOs der Pill angeschlossen. Das Script nutzt den eingebauten Modbus-RTU-Client der Pill (Modus `mb_client`).

> **Version:** Script `0.13.0` (siehe `VERSION` im Quelltext, wird beim Start in der Konsole ausgegeben).

> ✅ **Status:** Getestet mit L-home DTSU5886 an der Pill (RS485-Modul mit automatischer Flusssteuerung). Registerbelegung und Energie-Faktor (`ENERGY_SCALE: 0.01` → 0,01 kWh pro Zählschritt) mit dem Display abgeglichen.

## Messwerte

Die Pill erlaubt nur 9 virtuelle Komponenten. Das Script legt an:

| Virtual Component | Wert | Register | Format |
|---|---|---|---|
| `number:200–202` | Wirkleistung L1/L2/L3 (W) | 8 / 9 / 10 | s16 |
| `number:203` | Wirkleistung gesamt (W) | 7 | s16 |
| `number:204` | Bezug (kWh) | 29–30 | u32 × `ENERGY_SCALE` |
| `number:205–207` | Spannung L1/L2/L3 (V) | 0 / 1 / 2 | u16 × 0,1 |
| `number:208` | Frequenz (Hz) | 26 | u16 × 0,01 |
| `group:200` | Gruppe „DTSU5886“ (entfällt, falls kein Platz mehr frei ist) | – | – |

Reserve (in `ENTITIES` vorhanden, aber ohne Komponente):

| Wert | Register | Format |
|---|---|---|
| Einspeisung (kWh) | 39–40 | u32 × `ENERGY_SCALE` |
| Energie netto (kWh) | 49–50 | u32 × `ENERGY_SCALE` |
| Strom L1/L2/L3 (A) | 3 / 4 / 5 | u16 × 0,01 |
| Leistungsfaktor gesamt | 19 | s16 × 0,001 |
| Blindleistung gesamt (var) | 11 | s16 |
| Scheinleistung gesamt (VA) | 15 | u16 |

**Auswahl ändern:** Die Reihenfolge in `ENTITIES` ist die Priorität – die ersten `MAX_NUMBERS` (Standard 9) werden zur Komponente. Zum Tauschen eine Zeile aus der Reserve nach oben schieben. Überzählige Komponenten früherer Versionen entfernt das Script beim Start selbst.

**Debug:** `DEBUG: 1` im Quelltext gibt die serielle Kommunikation in der Script-Konsole aus – Anfrage-Frame (TX), Antwort-Frame in Hex inkl. CRC und alle Registerwerte (RX) sowie Fehler. UART und CRC übernimmt die Firmware; die Frames werden aus Anfrage und Antwort rekonstruiert.

```
[dtsu] TX [8] 01 03 00 00 00 33 05 DF
[dtsu] RX [107] 01 03 66 …
[dtsu] RX   09 3C 09 1B 09 35 00 33 00 18 00 3B 00 00 00 83 …
[dtsu] RX   reg   0: 2364 2331 2357 51 24 59 0 131 57 0
```

Weitere Register: 12–14 Blindleistung L1–L3, 16–18 Scheinleistung L1–L3, 20–22 Leistungsfaktor L1–L3, 26–28 Frequenz je Phase. 32-Bit-Werte: High-Word zuerst. Das Script liest alles mit einer Anfrage (Register 0–50) und erkennt FC03/FC04 automatisch (`FC: 'auto'`).

## MQTT

Mit `MQTT: 1` (Standard) veröffentlicht das Script bei jeder Abfrage **alle** Werte – nicht nur die 9 virtuellen Komponenten:

| Topic | Inhalt |
|---|---|
| `dtsu5886/state` | alle 28 Messwerte als JSON |
| `dtsu5886/raw` | alle Rohregister 0–50 (`MQTT_RAW: 1`) |

```json
{"p_l1":57,"p_l2":0,"p_l3":72,"p":131,"e_imp":10772.29,"u_l1":236.4,"u_l2":233.1,"u_l3":235.7,
 "f":49.99,"e_exp":0.29,"e_net":10772,"i_l1":0.51,"i_l2":0.24,"i_l3":0.59,"pf":0.529,"q":199,"s":319,
 "q_l1":64,"q_l2":56,"q_l3":78,"s_l1":122,"s_l2":57,"s_l3":139,"pf_l1":0.661,"pf_l2":0.049,"pf_l3":0.678,
 "f_2":49.99,"f_3":49.99}
```

| Feld | Wert | Einheit |
|---|---|---|
| `p`, `p_l1`–`p_l3` | Wirkleistung gesamt / je Phase | W |
| `q`, `q_l1`–`q_l3` | Blindleistung gesamt / je Phase | var |
| `s`, `s_l1`–`s_l3` | Scheinleistung gesamt / je Phase | VA |
| `pf`, `pf_l1`–`pf_l3` | Leistungsfaktor gesamt / je Phase | – |
| `u_l1`–`u_l3` | Spannung | V |
| `i_l1`–`i_l3` | Strom | A |
| `f`, `f_2`, `f_3` | Frequenz | Hz |
| `e_imp`, `e_exp`, `e_net` | Energie Bezug / Einspeisung / netto | kWh |

Einstellungen im Script: `MQTT` (0/1), `MQTT_TOPIC` (Basis-Topic), `MQTT_RAW` (0/1), `MQTT_RETAIN` (0/1).
Ist MQTT in der Pill ausgeschaltet, läuft das Script ohne MQTT weiter und meldet einmalig „MQTT in der Pill deaktiviert“.

### Broker-Einrichtung durch das Script

Die MQTT-Verbindung der Pill muss nicht von Hand eingerichtet werden – das Script erledigt das selbst:

```js
  MQTT_SETUP: 1,                    // Broker-Einstellungen der Pill setzen
  MQTT_SERVER: '192.168.1.10:1883', // Broker host:port
  MQTT_USER: 'ha',                  // '' = ohne Anmeldung
  MQTT_PASS: 'geheim',
  MQTT_CLIENT_ID: '',               // '' = Geräte-ID
  MQTT_PREFIX: '',                  // '' = Geräte-ID
  MQTT_SSL: '',                     // '' = ohne TLS, '*' = TLS ohne Prüfung, 'ca.pem' = TLS mit CA
  MQTT_AUTO_REBOOT: 1,              // nach Änderung automatisch neu starten
```

- Beim Start vergleicht das Script die Soll-Werte mit der aktuellen Konfiguration der Pill (das Passwort über eine Prüfsumme im KVS). Nur bei einer Abweichung wird `Mqtt.SetConfig` aufgerufen.
- Die Pill übernimmt MQTT-Einstellungen erst nach einem **Neustart**. Mit `MQTT_AUTO_REBOOT: 1` startet das Script sie einmal neu – dafür muss beim Script **„Run on startup“** aktiv sein. Danach sind die Werte gleich und es gibt keinen weiteren Neustart.
- `MQTT_SERVER: ''` (Standard) = Broker-Einstellungen der Pill bleiben unangetastet.

> ⚠️ Das Passwort steht im Klartext im Script und ist für jeden mit Zugriff auf die Weboberfläche der Pill lesbar. Ein Script mit echtem Passwort nicht ins Git-Repository einchecken.

## HTTP (JSON direkt von der Pill)

Mit `HTTP: 1` (Standard) stellt das Script alle Werte direkt auf der Pill bereit – ohne Broker oder zusätzlichen Rechner. Die genaue Adresse steht beim Start in der Konsole (`HTTP: http://192.168.1.50/script/1/dtsu`).

| Aufruf | Antwort |
|---|---|
| `http://<pill-ip>/script/<id>/dtsu` | alle 28 Werte als JSON |
| `http://<pill-ip>/script/<id>/dtsu?raw=1` | zusätzlich die Rohregister 0–50 |
| `http://<pill-ip>/script/<id>/dtsu?v=p` | nur ein Wert als Text, z. B. `131` (Feldnamen wie bei MQTT) |

```json
{"device":"DTSU5886","version":"0.13.0","slave":8,"ts":1761426000,"age":2,"ok":true,
 "values":{"p_l1":57,"p_l2":0,"p_l3":72,"p":131,"e_imp":10772.29,"u_l1":236.4, …}}
```

- `ts` = Zeitpunkt der letzten erfolgreichen Messung (Unix-Zeit), `age` = Alter in Sekunden, `ok` = letzte Abfrage erfolgreich.
- Vor der ersten Messung antwortet der Endpunkt mit HTTP 503, bei unbekanntem Feldnamen mit 404.
- Ist in der Pill eine Anmeldung (Passwort) aktiv, gilt sie auch für diesen Endpunkt.
- Einstellungen: `HTTP` (0/1), `HTTP_ENDPOINT` (Name des Endpunkts, Standard `dtsu`).

## Home Assistant

Mit `HA_DISCOVERY: 1` (Standard) meldet das Script alle 28 Werte per **MQTT Discovery** bei Home Assistant an. Es erscheint ein Gerät **„DTSU5886“** mit allen Sensoren – ohne YAML-Konfiguration.

- Einheit, `device_class` und `state_class` werden mitgeschickt: Leistung (W), Energie (kWh, `total_increasing`), Spannung, Strom, Frequenz, Blind-/Scheinleistung, Leistungsfaktor.
- **Bezug** und **Einspeisung** lassen sich direkt im **Energie-Dashboard** als Netzbezug bzw. Netzeinspeisung auswählen.
- Verfügbarkeit über das `online`-Topic der Pill: ist die Pill offline, werden die Sensoren als „nicht verfügbar“ angezeigt.
- Die Discovery wird beim Start, bei jeder MQTT-(Wieder-)Verbindung und bei jedem Neustart von Home Assistant (`homeassistant/status` = `online`) erneut gesendet.

Voraussetzungen: MQTT-Integration in Home Assistant aktiv, Pill mit demselben Broker verbunden (Settings → MQTT).

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `HA_DISCOVERY` | `1` | Discovery ein/aus |
| `HA_PREFIX` | `homeassistant` | Discovery-Prefix (wie in Home Assistant eingestellt) |
| `HA_DEVICE_NAME` | `DTSU5886` | Gerätename in Home Assistant |

Discovery-Topics: `homeassistant/sensor/<pill-id>_dtsu/<feld>/config` (retained). Zum Entfernen der Sensoren aus Home Assistant das Gerät dort löschen bzw. leere retained-Nachrichten auf diese Topics senden.

## Hardware

- Shelly The Pill (S3SN-0U53X), Firmware **≥ 2.0.1**
- TTL↔RS485-Modul mit **automatischer Flusssteuerung / Richtungsumschaltung** (ohne DE/RE-Pin) – **zwingend erforderlich**

> ⚠️ Module mit manueller Richtungsumschaltung (z. B. einfache MAX485-Module mit DE/RE-Pins) funktionieren an der Pill **nicht**: Die Anfrage geht raus, aber die Antwort des Zählers kommt nie an, weil das Modul nicht auf Empfang zurückschaltet. Die Pill hat keinen freien Pin, der DE/RE steuert. Erkennbar am Modul-Aufdruck „auto direction“ bzw. „automatic flow control“ oder daran, dass es nur die Pins VCC, GND, TXD, RXD hat.
- DTSU5886 mit RS485-Klemmen A/B
- optional: Shelly 5-Terminal-Add-on (sonst direkt am Micro-USB-Stecker der Pill)

### 1. Verkabelung

Signalweg: **Zähler → RS485-Modul → Micro-USB → Pill**

```
 DTSU5886         RS485-Modul             Micro-USB                   The Pill
 (Zähler)         (TTL ↔ RS485)           (Kabel / Breakout)
                                          Pin  Signal  Ader
 ┌───────┐        ┌──────────┐            ┌──────────────────┐        ┌──────────┐
 │     A ├────────┤ A        │            │                  │        │          │
 │     B ├────────┤ B        │            │                  │        │          │
 └───────┘        │      VCC ├────────────┤ 1   VBUS  rot    ├────────┤ 5V       │
                  │   RXD/DI ├────────────┤ 2   D−    weiß   ├────────┤ IO1 (TX) │
                  │   TXD/RO ├─[Teiler]───┤ 3   D+    grün   ├────────┤ IO2 (RX) │
                  │          │     (frei) ┤ 4   ID    –      ├────────┤ IO3      │
                  │      GND ├────────────┤ 5   GND   schwarz├────────┤ GND      │
                  └──────────┘            └──────────────────┘        └──────────┘
```

- **Zähler → Modul:** A an A, B an B (verdrilltes Adernpaar). Kommt keine Antwort, A/B tauschen.
- **Modul → USB:** TX und RX kreuzen – RXD/DI des Moduls an IO1 (TX der Pill), TXD/RO an IO2 (RX der Pill). Den Spannungsteiler (z. B. 1 kΩ in Serie, 2 kΩ nach GND) nur bei einem Modul mit 5-V-Logik.
- **USB → Pill:** Die IOs der Pill liegen auf dem Micro-USB-Port. Der USB-C-Port oben bleibt für die Stromversorgung der Pill; das Modul wird über Pin 1 (5 V) mitversorgt.

| Micro-USB-Pin | Signal | Pill-Funktion | Aderfarbe USB-Kabel* | → RS485-Modul |
|---|---|---|---|---|
| 1 | VBUS | 5 V Ausgang | rot | VCC |
| 2 | D− | IO1 = UART **TX** | weiß | RXD / DI |
| 3 | D+ | IO2 = UART **RX** | grün | TXD / RO (ggf. über Spannungsteiler) |
| 4 | ID | IO3 – reserviert | (meist nicht im Kabel) | frei lassen |
| 5 | GND | Masse | schwarz | GND |

\* Standard-Farben bei USB-Kabeln. Vor dem Anschließen mit dem Multimeter durchmessen – nicht jeder Hersteller hält sich daran, und reine Ladekabel haben keine D−/D+-Adern.

Möglichkeiten für den Anschluss:
- **Micro-USB-Breakout-Platine** mit Lötpads oder Schraubklemmen (sauberste Lösung)
- **abgeschnittenes Micro-USB-Datenkabel** – Adern nach Tabelle oben zuordnen
- **Shelly 5-Terminal-Add-on** – stellt IO1, IO2, IO3, 5V und GND auf Schraubklemmen bereit

**Wichtig:**
- Die Pill (ESP32-C3) arbeitet mit **3,3 V** und ist nicht 5-V-tolerant. Bei einem 5-V-Modul den TX-Ausgang des Moduls über einen Spannungsteiler (z. B. 1 kΩ in Serie, 2 kΩ nach GND) an IO2 führen.
- Bei kurzen Leitungen im Verteiler ist kein 120-Ω-Abschluss nötig.
- Netzseitiger Anschluss des Zählers nur durch eine Elektrofachkraft.

### 2. Zähler einstellen

Im Menü des Zählers prüfen bzw. einstellen:

- Adresse (`Addr`) – hier `8` (Standard meist `1`)
- Baudrate (`bAud`) – meist `9600`
- Parität / Format – meist `8N1`
- Protokoll – **Modbus** (nicht DL/T645)

## Installation

### 3. Script einspielen

1. Pill auf Firmware ≥ 2.0.1 aktualisieren.
2. In `dtsu5886_pill_vc.shelly.js` unter `CONFIG` die Werte `SLAVE_ID`, `BAUD`, `FORMAT` an den Zähler anpassen.
3. Web-UI der Pill → **Scripts → Create script** → Inhalt einfügen → speichern → starten.
4. **Run on startup** aktivieren.

Das Script stellt die Pill beim ersten Start selbst auf den Modus `mb_client` um. Meldet die Konsole „Neustart nötig“, die Pill neu starten und das Script erneut starten.

### 4. Kontrolle

In der Script-Konsole erscheint `Läuft: 9 Werte als Komponente, 28 per MQTT (dtsu5886), alle 7 s`, danach die Gruppe „DTSU5886“ in der Shelly-App.

### 5. Belegung testen

Ohne Script (Pill muss im Modus `mb_client` sein):

```
http://<pill-ip>/rpc/MbRtuClient.ReadHoldingRegisters?id=0&sid=8&addr=0&qty=3
```

Erwartet: drei Werte um `2300` (= 230,0 V × 10) – die Spannungen L1–L3. Kommt ein Fehler zurück, dasselbe mit `MbRtuClient.ReadInputRegisters` testen.

## Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| „Keine Antwort“ | Modul mit automatischer Flusssteuerung verwenden (häufigste Ursache: Senden geht, Empfangen nicht); TX/RX am Modul tauschen, dann A/B tauschen; Baudrate, Format und Adresse prüfen |
| Werte 0 oder unsinnig | Registerbelegung weicht ab – `DEBUG: 1` setzen und Registerwerte in der Konsole prüfen |
| Bezug/Einspeisung vertauscht, Leistung negativ | Phasen falsch herum durch den Zähler geführt (IN/OUT) |
| `Pill.SetConfig Fehler` | Firmware < 2.0.1 |
| `… nicht angelegt – Limit erreicht?` | Zu viele virtuelle Komponenten – `MAX_NUMBERS` verringern oder fremde Komponenten löschen |

## Anpassung an andere Zähler

Die Register werden in Blöcken (`BLOCKS`) gelesen – eine Modbus-Anfrage pro Block (max. 123 Register). Pro Messwert:

```js
{ name: 'Spannung L1', off: 0, scale: 0.1, dec: 1, unit: 'V', min: 0, max: 300 }
```

- `off` – Registeroffset im Block
- `scale` – Faktor auf den Rohwert
- `dec` – Nachkommastellen
- `min`/`max` – Wertebereich der Virtual Component

## Referenzen

- [Shelly API: Pill](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Pill)
- [Shelly API: MbRtuClient](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/MbRtuClient)
- [Shelly API: Serial](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Serial)
- [Shelly Script-Beispiele](https://github.com/ALLTERCO/shelly-script-examples)

## Lizenz

(c) 2026 erich.grassl@glw8.at – [GNU AGPL-3.0](LICENSE)
