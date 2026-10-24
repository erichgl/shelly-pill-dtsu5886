# Shelly The Pill – DTSU5886 Modbus-RTU Stromzähler

Liest einen 3-phasigen **DTSU5886**-Stromzähler (z. B. L-home, 3×230/400 V, 10(100) A) über **Modbus RTU** mit einem **Shelly „The Pill“ (S3SN-0U53X)** aus und stellt die Messwerte als **Virtual Components** im Shelly-Ökosystem bereit (App, Smart Control, Szenen, Home Assistant …).

Statt des offiziellen RS485-Add-ons wird ein **eigenes TTL↔RS485-Modul** direkt an die IOs der Pill angeschlossen. Das Script nutzt den eingebauten Modbus-RTU-Client der Pill (Modus `mb_client`).

> ⚠️ **Status:** Die Registerbelegung entspricht der verbreiteten Chint-DTSU666-kompatiblen Map. Am L-home DTSU5886 wird sie noch verifiziert – siehe [Belegung testen](#5-belegung-testen).

## Messwerte

| Virtual Component | Wert | Register |
|---|---|---|
| `group:200` | Gruppe „DTSU5886“ | – |
| `number:200–202` | Spannung L1/L2/L3 (V) | 0x2006 / 0x2008 / 0x200A |
| `number:203–205` | Strom L1/L2/L3 (A) | 0x200C / 0x200E / 0x2010 |
| `number:206` | Wirkleistung gesamt (W) | 0x2012 |
| `number:207–209` | Wirkleistung L1/L2/L3 (W) | 0x2014 / 0x2016 / 0x2018 |
| `number:210` | Frequenz (Hz) | 0x2044 |
| `number:211` | Bezug (kWh) | 0x101E |
| `number:212` | Einspeisung (kWh) | 0x1028 |

Alle Register: Funktionscode 0x03 (Holding), Float32 Big Endian.

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

| Pill-Terminal | Micro-USB-Pin | Funktion |
|---|---|---|
| IO1 | Pin 2 (D−) | UART TX |
| IO2 | Pin 3 (D+) | UART RX |
| IO3 | Pin 4 (ID) | reserviert – frei lassen |
| 5V | Pin 1 (VBUS) | Versorgung Modul |
| GND | Pin 5 | Masse |

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

In der Script-Konsole erscheint `Läuft: 13 Werte alle 5 s`, danach die Gruppe „DTSU5886“ in der Shelly-App.

### 5. Belegung testen

Ohne Script (Pill muss im Modus `mb_client` sein):

```
http://<pill-ip>/rpc/MbRtuClient.ReadHoldingRegisters?id=0&sid=1&addr=8198&qty=2
```

Die zwei Werte als Float32 interpretiert sollten etwa `2300` ergeben (= 230,0 V × 10). Kommt nichts Sinnvolles zurück, alternativ `addr=0` sowie `MbRtuClient.ReadInputRegisters` testen.

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
