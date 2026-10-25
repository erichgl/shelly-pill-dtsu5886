# Shelly The Pill – DTSU5886 Modbus-RTU Stromzähler

Liest einen 3-phasigen **DTSU5886**-Stromzähler (z. B. L-home, 3×230/400 V, 10(100) A) über **Modbus RTU** mit einem **Shelly „The Pill“ (S3SN-0U53X)** aus und stellt die Messwerte als **Virtual Components** im Shelly-Ökosystem bereit (App, Smart Control, Szenen, Home Assistant …).

Statt des offiziellen RS485-Add-ons wird ein **eigenes TTL↔RS485-Modul** direkt an die IOs der Pill angeschlossen. Das Script nutzt den eingebauten Modbus-RTU-Client der Pill (Modus `mb_client`).

> ⚠️ **Status:** Registerbelegung am L-home DTSU5886 per PC-Modbus-Tool ausgelesen und plausibilisiert. Test auf der Pill steht noch aus; der Energie-Faktor (0,01 oder 0,001 kWh) ist noch mit dem Display abzugleichen (`ENERGY_SCALE`).

## Messwerte

Die Pill erlaubt nur wenige virtuelle Komponenten (9). Das Script legt deshalb an:

| Virtual Component | Wert | Register | Format |
|---|---|---|---|
| `boolean:200` | **Debug-Schalter** – an = alle 17 Messwerte in der Script-Konsole | – | – |
| `number:200` | Wirkleistung gesamt (W) | 7 | s16 |
| `number:201` | Bezug (kWh) | 29–30 | u32 × `ENERGY_SCALE` |
| `number:202–204` | Wirkleistung L1/L2/L3 (W) | 8 / 9 / 10 | s16 |
| `number:205–207` | Strom L1/L2/L3 (A) | 3 / 4 / 5 | u16 × 0,01 |
| `group:200` | Gruppe „DTSU5886“ (entfällt, falls kein Platz mehr frei ist) | – | – |

Weitere Werte werden mitgelesen, aber nur im Debug-Modus ausgegeben:

| Wert | Register | Format |
|---|---|---|
| Einspeisung (kWh) | 39–40 | u32 × `ENERGY_SCALE` |
| Spannung L1/L2/L3 (V) | 0 / 1 / 2 | u16 × 0,1 |
| Frequenz (Hz) | 26 | u16 × 0,01 |
| Energie netto (kWh) | 49–50 | u32 × `ENERGY_SCALE` |
| Leistungsfaktor gesamt | 19 | s16 × 0,001 |
| Blindleistung gesamt (var) | 11 | s16 |
| Scheinleistung gesamt (VA) | 15 | u16 |

**Auswahl ändern:** Die Reihenfolge in `ENTITIES` ist die Priorität – die ersten `MAX_NUMBERS` (Standard 8) werden zur Komponente. Wer z. B. eine PV-Anlage hat, schiebt `Einspeisung` nach oben. Überzählige `number`-Komponenten früherer Versionen entfernt das Script beim Start selbst.

Weitere Register: 12–14 Blindleistung L1–L3, 16–18 Scheinleistung L1–L3, 20–22 Leistungsfaktor L1–L3, 26–28 Frequenz je Phase. 32-Bit-Werte: High-Word zuerst. Das Script liest alles mit einer Anfrage (Register 0–50) und erkennt FC03/FC04 automatisch (`FC: 'auto'`).

## Hardware

- Shelly The Pill (S3SN-0U53X), Firmware **≥ 2.0.1**
- TTL↔RS485-Modul mit **automatischer Richtungsumschaltung** (ohne DE/RE-Pin)
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

- Adresse (`Addr`) – Standard meist `1`
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

In der Script-Konsole erscheint `Läuft: 17 Werte, 8 als Komponente, alle 5 s`, danach die Gruppe „DTSU5886“ in der Shelly-App.

### 5. Belegung testen

Ohne Script (Pill muss im Modus `mb_client` sein):

```
http://<pill-ip>/rpc/MbRtuClient.ReadHoldingRegisters?id=0&sid=1&addr=0&qty=3
```

Erwartet: drei Werte um `2300` (= 230,0 V × 10) – die Spannungen L1–L3. Kommt ein Fehler zurück, dasselbe mit `MbRtuClient.ReadInputRegisters` testen.

## Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| „Keine Antwort“ | TX/RX am Modul tauschen, dann A/B tauschen; Baudrate, Format und Adresse prüfen |
| Werte 0 oder unsinnig | Registerbelegung weicht ab – Debug-Schalter einschalten und Konsolenausgabe prüfen |
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

[GNU AGPL-3.0](LICENSE)
