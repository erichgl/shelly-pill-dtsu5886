/**
 * DTSU5886 (3-phasig, Modbus RTU) -> Shelly Virtual Components
 * Version: 0.9.0 (2026-10-25)
 * Gerät: Shelly "The Pill" (S3SN-0U53X), Firmware >= 2.0.1
 *        eigenes TTL<->RS485-Modul direkt an IO1 (TX) / IO2 (RX)
 *
 * Nutzt den eingebauten Modbus-RTU-Client der Pill (Pill-Modus "mb_client").
 *
 * REGISTERMAP (ermittelt am L-home DTSU5886, Register 0..50, 16-Bit-Ganzzahlen):
 *   0-2   Spannung L1-L3        x0.1  V
 *   3-5   Strom L1-L3           x0.01 A
 *   7     Wirkleistung gesamt   W     (8-10: L1-L3)
 *   11    Blindleistung gesamt  var   (12-14: L1-L3)
 *   15    Scheinleistung gesamt VA    (16-18: L1-L3)
 *   19    Leistungsfaktor ges.  x0.001
 *   26    Frequenz              x0.01 Hz
 *   29-30 Energie Bezug         32 Bit, x ENERGY_SCALE kWh
 *   39-40 Energie Einspeisung   32 Bit, x ENERGY_SCALE kWh
 *   49-50 Energie netto         32 Bit, x ENERGY_SCALE kWh
 *
 * VIRTUELLE KOMPONENTEN
 *   Die Pill erlaubt nur 9 virtuelle Komponenten. Angelegt werden:
 *     number:200…208  die ersten MAX_NUMBERS Einträge aus ENTITIES
 *     group:200       Gruppe (entfällt, falls kein Platz mehr frei ist)
 *   Reihenfolge in ENTITIES = Priorität. Zum Tauschen einfach Zeilen verschieben.
 *
 * DEBUG
 *   DEBUG: 1 gibt die serielle Kommunikation in der Script-Konsole aus:
 *     TX  Modbus-Anfrage als Frame (Hex, inkl. CRC)
 *     RX  Antwort als Frame (Hex) und Registerwerte (dezimal)
 *   Hinweis: UART und CRC übernimmt die Firmware (MbRtuClient). Die Frames
 *   werden aus Anfrage und Antwort rekonstruiert und entsprechen dem, was
 *   über die Leitung geht.
 */

var VERSION = '0.9.0';

// ============================================================================
// KONFIGURATION
// ============================================================================
var CONFIG = {
  DEBUG: 0,             // 1 = serielle Kommunikation (TX/RX) in der Konsole, 0 = aus
  SLAVE_ID: 8,          // Modbus-Adresse am Zähler
  BAUD: 9600,           // Baudrate am Zähler
  FORMAT: '8N1',        // Datenbits/Parität/Stopp, z.B. '8E1'
  SERIAL_ID: 0,         // Serial- / MbRtuClient-Instanz der Pill
  FC: 'auto',           // 'holding' (FC03), 'input' (FC04) oder 'auto'
  POLL_INTERVAL: 7000,  // ms
  ENERGY_SCALE: 0.01,   // kWh pro Zählschritt – mit Display vergleichen, ggf. 0.001
  MAX_NUMBERS: 9,       // Anzahl number-Komponenten (Limit der Pill)
  FIRST_ID: 200,        // IDs: number:200…, group:200
  GROUP_NAME: 'DTSU5886',
};

// Register 0..50 werden mit EINER Anfrage gelesen.
var READ_ADDR = 0;
var READ_QTY = 51;

// Reihenfolge = Priorität. Die ersten MAX_NUMBERS werden zur virtuellen Komponente.
// type: 'u16', 's16', 'u32' (High-Word zuerst); scale 'E' = ENERGY_SCALE
var ENTITIES = [
  { name: 'Leistung L1',     off: 8,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { name: 'Leistung L2',     off: 9,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { name: 'Leistung L3',     off: 10, type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { name: 'Leistung gesamt', off: 7,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { name: 'Bezug',           off: 29, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
  { name: 'Spannung L1',     off: 0,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
  { name: 'Spannung L2',     off: 1,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
  { name: 'Spannung L3',     off: 2,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
  { name: 'Frequenz',        off: 26, type: 'u16', scale: 0.01,  dec: 2, unit: 'Hz',  min: 45,     max: 55 },
  // --- Reserve: zum Tauschen nach oben schieben ---
  { name: 'Einspeisung',     off: 39, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
  { name: 'Energie netto',   off: 49, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
  { name: 'Strom L1',        off: 3,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
  { name: 'Strom L2',        off: 4,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
  { name: 'Strom L3',        off: 5,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
  { name: 'Leistungsfaktor', off: 19, type: 's16', scale: 0.001, dec: 3, unit: '',    min: -1,     max: 1 },
  { name: 'Blindleistung',   off: 11, type: 's16', scale: 1,     dec: 0, unit: 'var', min: -32768, max: 32767 },
  { name: 'Scheinleistung',  off: 15, type: 'u16', scale: 1,     dec: 0, unit: 'VA',  min: 0,      max: 65535 },
];

// ============================================================================
// HILFSFUNKTIONEN
// ============================================================================
var USED = [];  // die als Komponente genutzten ENTITIES

function log(m) { print('[dtsu] ' + m); }

function decode(v, off, type) {
  var x;
  if (off + (type === 'u32' ? 1 : 0) >= v.length) return null;
  if (type === 'u16') return v[off];
  if (type === 's16') { x = v[off]; return x >= 0x8000 ? x - 0x10000 : x; }
  if (type === 'u32') return v[off] * 65536 + v[off + 1];
  return null;
}

function round(v, dec) {
  var f = Math.pow(10, dec || 0);
  return Math.round(v * f) / f;
}

// --- Debug: Modbus-Frames rekonstruieren ---
function crc16(b) {
  var crc = 0xFFFF, i, j;
  for (i = 0; i < b.length; i++) {
    crc ^= b[i];
    for (j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
  }
  return crc & 0xFFFF;
}

function withCrc(b) {
  var c = crc16(b);
  b.push(c & 0xFF);
  b.push((c >> 8) & 0xFF);
  return b;
}

var HEXCH = '0123456789ABCDEF';
function hex2(n) { n = n & 0xFF; return HEXCH.charAt(n >> 4) + HEXCH.charAt(n & 15); }

function hexLine(b, from, to) {
  var s = [], i;
  for (i = from; i < to && i < b.length; i++) s.push(hex2(b[i]));
  return s.join(' ');
}

function fcOf(m) { return m === 'ReadInputRegisters' ? 0x04 : 0x03; }

function dbgTx(m) {
  var f = withCrc([CONFIG.SLAVE_ID & 0xFF, fcOf(m), (READ_ADDR >> 8) & 0xFF, READ_ADDR & 0xFF,
                   (READ_QTY >> 8) & 0xFF, READ_QTY & 0xFF]);
  log('TX ' + m + ' sid=' + CONFIG.SLAVE_ID + ' addr=' + READ_ADDR + ' qty=' + READ_QTY);
  log('TX [' + f.length + '] ' + hexLine(f, 0, f.length));
}

function dbgRx(m, v) {
  var f = [CONFIG.SLAVE_ID & 0xFF, fcOf(m), (v.length * 2) & 0xFF], i;
  for (i = 0; i < v.length; i++) { f.push((v[i] >> 8) & 0xFF); f.push(v[i] & 0xFF); }
  withCrc(f);
  log('RX [' + f.length + '] ' + hexLine(f, 0, 3) + ' …');
  for (i = 3; i < f.length - 2; i += 24) log('RX   ' + hexLine(f, i, Math.min(i + 24, f.length - 2)));
  log('RX   CRC ' + hexLine(f, f.length - 2, f.length));
  for (i = 0; i < v.length; i += 10) {
    var r = [], k;
    for (k = i; k < i + 10 && k < v.length; k++) r.push(v[k]);
    var a = '' + (READ_ADDR + i);
    while (a.length < 3) a = ' ' + a;
    log('RX   reg ' + a + ': ' + r.join(' '));
  }
}

// ============================================================================
// SCHNITTSTELLE EINRICHTEN
// ============================================================================
function setupSerial(done) {
  Shelly.call('Pill.GetConfig', {}, function (cfg, ec, em) {
    if (ec !== 0) { log('Pill.GetConfig Fehler: ' + em); return; }
    if (cfg.mode !== 'mb_client') {
      log('Stelle Pill-Modus auf mb_client um ...');
      Shelly.call('Pill.SetConfig', { config: { mode: 'mb_client' } }, function (r, ec2, em2) {
        if (ec2 !== 0) { log('Pill.SetConfig Fehler: ' + em2 + ' (Firmware >= 2.0.1?)'); return; }
        log('Modus gesetzt' + (r && r.restart_required ? ' – Neustart nötig, danach Script erneut starten' : '') + '.');
        if (!(r && r.restart_required)) Timer.set(1500, false, function () { setupSerial(done); });
      });
      return;
    }
    var scfg = { mode: 'mb_client', serial: { baud: CONFIG.BAUD, format: CONFIG.FORMAT } };
    if (CONFIG.DEBUG) log('Serial.SetConfig ' + JSON.stringify(scfg));
    Shelly.call('Serial.SetConfig', { id: CONFIG.SERIAL_ID, config: scfg }, function (r, ec3, em3) {
      if (ec3 !== 0) { log('Serial.SetConfig Fehler: ' + em3); return; }
      log('Serial: ' + CONFIG.BAUD + ' ' + CONFIG.FORMAT + ', Slave ' + CONFIG.SLAVE_ID +
          (CONFIG.DEBUG ? ', DEBUG an' : ''));
      done();
    });
  });
}

// ============================================================================
// VIRTUELLE KOMPONENTEN
// ============================================================================
function numberCfg(e) {
  return {
    name: e.name, default_value: Math.min(Math.max(0, e.min), e.max), min: e.min, max: e.max, persisted: false,
    meta: { ui: { view: 'label', unit: e.unit, step: Math.pow(10, -e.dec) } },
  };
}

function setupComponents(done) {
  var i, nNum = Math.min(CONFIG.MAX_NUMBERS, ENTITIES.length);
  var steps = [];

  // 1. Altlasten früherer Versionen entfernen (geben Plätze frei)
  if (Virtual.getHandle('boolean:' + CONFIG.FIRST_ID)) steps.push({ del: 'boolean:' + CONFIG.FIRST_ID });
  for (i = nNum; i < 30; i++) {
    if (Virtual.getHandle('number:' + (CONFIG.FIRST_ID + i))) steps.push({ del: 'number:' + (CONFIG.FIRST_ID + i) });
  }
  // 2. Messwerte, zuletzt die Gruppe (verzichtbar, falls sie zum Limit zählt)
  for (i = 0; i < nNum; i++) {
    ENTITIES[i].key = 'number:' + (CONFIG.FIRST_ID + i);
    USED.push(ENTITIES[i]);
    steps.push({ type: 'number', id: CONFIG.FIRST_ID + i, cfg: numberCfg(ENTITIES[i]) });
  }
  steps.push({ type: 'group', id: CONFIG.FIRST_ID, cfg: { name: CONFIG.GROUP_NAME } });

  var members = [];

  function next(k) {
    if (k >= steps.length) {
      for (i = 0; i < USED.length; i++) USED[i].h = Virtual.getHandle(USED[i].key);
      if (!Virtual.getHandle('group:' + CONFIG.FIRST_ID)) { done(); return; }
      Shelly.call('Group.Set', { id: CONFIG.FIRST_ID, value: members }, function () { done(); });
      return;
    }
    var s = steps[k];
    var go = function () { Timer.set(100, false, function () { next(k + 1); }); };

    if (s.del) {
      Shelly.call('Virtual.Delete', { key: s.del }, function (r, ec, em) {
        log(ec === 0 ? 'Entfernt: ' + s.del : 'Entfernen ' + s.del + ' fehlgeschlagen: ' + em);
        go();
      });
      return;
    }

    var key = s.type + ':' + s.id;
    var cb = function (r, ec, em) {
      if (ec !== 0) {
        log(key + ' nicht angelegt (Fehler ' + ec + '): ' + em);
      } else if (s.type === 'number') {
        members.push(key);
      }
      go();
    };
    if (Virtual.getHandle(key)) {
      Shelly.call(s.type === 'group' ? 'Group.SetConfig' : 'Number.SetConfig', { id: s.id, config: s.cfg }, cb);
    } else {
      Shelly.call('Virtual.Add', { type: s.type, id: s.id, config: s.cfg }, cb);
    }
  }
  next(0);
}

// ============================================================================
// ABFRAGE
// ============================================================================
var busy = false, fails = 0;
var method = CONFIG.FC === 'input' ? 'ReadInputRegisters' : 'ReadHoldingRegisters';

function poll() {
  if (busy) return;
  busy = true;
  var m = method;
  if (CONFIG.DEBUG) dbgTx(m);

  Shelly.call('MbRtuClient.' + m, {
    id: CONFIG.SERIAL_ID, sid: CONFIG.SLAVE_ID, addr: READ_ADDR, qty: READ_QTY,
  }, function (res, ec, em) {
    busy = false;
    if (ec !== 0 || !res || !res.values) {
      fails++;
      if (CONFIG.DEBUG) log('RX Fehler ' + ec + ': ' + em);
      if (CONFIG.FC === 'auto') {
        method = method === 'ReadHoldingRegisters' ? 'ReadInputRegisters' : 'ReadHoldingRegisters';
      }
      if (fails === 1 || fails % 12 === 0) log('Keine Antwort (' + fails + 'x): TX/RX, A/B, Baudrate, Slave-ID prüfen');
      return;
    }
    if (fails > 0) log('Verbindung ok (' + m + ')');
    fails = 0;

    var v = res.values, i;
    if (CONFIG.DEBUG) dbgRx(m, v);

    for (i = 0; i < USED.length; i++) {
      var e = USED[i];
      var raw = decode(v, e.off, e.type);
      if (raw === null || !e.h) continue;
      var val = round(raw * (e.scale === 'E' ? CONFIG.ENERGY_SCALE : e.scale), e.dec);
      if (val < e.min) val = e.min;
      if (val > e.max) val = e.max;
      e.h.setValue(val);
    }
  });
}

// ============================================================================
// START
// ============================================================================
log('DTSU5886 Pill-Script v' + VERSION);
setupSerial(function () {
  setupComponents(function () {
    log('Läuft: ' + USED.length + ' Werte als Komponente, alle ' + CONFIG.POLL_INTERVAL / 1000 + ' s');
    Timer.set(500, false, poll);
    Timer.set(CONFIG.POLL_INTERVAL, true, poll);
  });
});
