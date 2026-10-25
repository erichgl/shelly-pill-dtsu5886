# Shelly The Pill – DTSU5886 Modbus-RTU Stromzähler

Liest einen 3-phasigen **DTSU5886**-Stromzähler (z. B. L-home, 3×230/400 V, 10(100) A) über **Modbus RTU** mit einem **Shelly „The Pill“ (S3SN-0U53X)** aus und stellt die Messwerte als **Virtual Components** im Shelly-Ökosystem bereit (App, Smart Control, Szenen, Home Assistant …).

Statt des offiziellen RS485-Add-ons wird ein **eigenes TTL↔RS485-Modul** direkt an die IOs der Pill angeschlossen. Das Script nutzt den eingebauten Modbus-RTU-Client der Pill (Modus `mb_client`).

> ⚠️ **Status:** Registerbelegung am L-home DTSU5886 per PC-Modbus-Tool ausgelesen und plausibilisiert. Test auf der Pill steht noch aus; der Energie-Faktor (0,01 oder 0,001 kWh) ist noch mit dem Display abzugleichen (`ENERGY_SCALE`).

## Messwerte

| Virtual Component | Wert | Register | Format |
|---|---|---|---|
| `group:200` | Gruppe „DTSU5886“ | – | – |
| `number:200–202` | Spannung L1/L2/L3 (V) | 0 / 1 / 2 | u16 × 0,1 |
| `number:203–205` | Strom L1/L2/L3 (A) | 3 / 4 / 5 | u16 × 0,01 |
| `number:206` | Wirkleistung gesamt (W) | 7 | s16 |
| `number:207–209` | Wirkleistung L1/L2/L3 (W) | 8 / 9 / 10 | s16 |
| `number:210` | Blindleistung gesamt (var) | 11 | s16 |
| `number:211` | Scheinleistung gesamt (VA) | 15 | u16 |
| `number:212` | Leistungsfaktor gesamt | 19 | s16 × 0,001 |
| `number:213` | Frequenz (Hz) | 26 | u16 × 0,01 |
| `number:214` | Bezug (kWh) | 29–30 | u32 × `ENERGY_SCALE` |
| `number:215` | Einspeisung (kWh) | 39–40 | u32 × `ENERGY_SCALE` |
| `number:216` | Energie netto (kWh) | 49–50 | u32 × `ENERGY_SCALE` |

Weitere Register: 12–14 Blindleistung L1–L3, 16–18 Scheinleistung L1–L3, 20–22 Leistungsfaktor L1–L3, 26–28 Frequenz je Phase. 32-Bit-Werte: High-Word zuerst. Das Script liest alles mit einer Anfrage (Register 0–50) und erkennt FC03/FC04 automatisch (`FC: 'auto'`).

## Hardware

- Shelly The Pill (S3SN-0U53X), Firmware **≥ 2.0.1**
- TTL↔RS485-Modul mit **automatischer Richtungsumschaltung** (ohne DE/RE-Pin)
- DTSU5886 mit RS485-Klemmen A/B
- optional: Shelly 5-Terminal-Add-on (sonst direkt am Micro-USB-Stecker der Pill)

### 1. Verkabelung

```
DTSU5886  A  ────────────  A        RS485-Modul
DTSU5886  B  ────────────  B
                           RXD/DI  ─────────────  IO1 (TX)   Pill
                           TXD/RO  ──[Teiler]───  IO2 (RX)   Pill
                           VCC     ─────────────  5V         Pill
                           GND     ─────────────  GND        Pill
```

#### Anschluss über den Micro-USB-Port der Pill (ohne 5-Terminal-Add-on)

Die drei IOs der Pill liegen auf dem Micro-USB-Port. Das USB-C-Port oben bleibt für die Stromversorgung der Pill.

```
            Micro-USB (Pill)
   ┌─────────────────────────────┐
   │  1     2     3     4     5  │
   │ VBUS   D−    D+    ID   GND │
   └──┬─────┬─────┬─────┬─────┬──┘
      │     │     │     │     │
      │     │     │     └─ (frei)
      │     │     │           │
     5V    IO1   IO2         GND
      │    (TX)  (RX)         │
      │     │     │           │
      │     │     └──[Teiler]─┼─────  TXD/RO   RS485-Modul
      │     └─────────────────┼─────  RXD/DI
      └───────────────────────┼─────  VCC
                              └─────  GND
                                      A  ───────  A  DTSU5886
                                      B  ───────  B
```

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

In der Script-Konsole erscheint `Läuft: 17 Werte alle 5 s`, danach die Gruppe „DTSU5886“ in der Shelly-App.

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
| Werte 0 oder unsinnig | Registerbelegung weicht ab – `DEBUG: true` setzen und Konsolenausgabe prüfen |
| Bezug/Einspeisung vertauscht, Leistung negativ | Phasen falsch herum durch den Zähler geführt (IN/OUT) |
| `Pill.SetConfig Fehler` | Firmware < 2.0.1 |

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
