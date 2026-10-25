/**
 * DTSU5886 (3-phasig, Modbus RTU) -> Shelly Virtual Components
 * Gerät: Shelly "The Pill" (S3SN-0U53X), Firmware >= 2.0.1
 *        eigenes TTL<->RS485-Modul direkt an IO1 (TX) / IO2 (RX)
 *
 * Nutzt den eingebauten Modbus-RTU-Client der Pill (Pill-Modus "mb_client").
 *
 * REGISTERMAP (ermittelt am L-home DTSU5886, Register 0..62, 16-Bit-Ganzzahlen):
 *   0-2   Spannung L1-L3        x0.1  V
 *   3-5   Strom L1-L3           x0.01 A
 *   7     Wirkleistung gesamt   W     (8-10: L1-L3)
 *   11    Blindleistung gesamt  var   (12-14: L1-L3)
 *   15    Scheinleistung gesamt VA    (16-18: L1-L3)
 *   19    Leistungsfaktor ges.  x0.001
 *   26    Frequenz              x0.01 Hz
 *   29-30 Energie Bezug         32 Bit, x0.01 kWh (31-32 identisch)
 *   39-40 Energie Einspeisung   32 Bit, x0.01 kWh (41-42 identisch)
 *   49-50 Energie netto         32 Bit, x0.01 kWh (Bezug - Einspeisung)
 */

// ============================================================================
// KONFIGURATION
// ============================================================================
var CONFIG = {
  SLAVE_ID: 1,          // Modbus-Adresse am Zähler
  BAUD: 9600,           // Baudrate am Zähler
  FORMAT: '8N1',        // Datenbits/Parität/Stopp, z.B. '8E1'
  SERIAL_ID: 0,         // Serial- / MbRtuClient-Instanz der Pill
  FC: 'auto',           // 'holding' (FC03), 'input' (FC04) oder 'auto'
  POLL_INTERVAL: 5000,  // ms
  ENERGY_SCALE: 0.01,   // kWh pro Zählschritt – mit Display vergleichen, ggf. 0.001
  FIRST_ID: 200,        // virtuelle Komponenten ab number:200 / group:200
  GROUP_NAME: 'DTSU5886',
  DEBUG: false,
};

// type: 'u16', 's16', 'u32' (High-Word zuerst)
var BLOCKS = [
  {
    addr: 0, qty: 51,
    items: [
      { name: 'Spannung L1',     off: 0,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
      { name: 'Spannung L2',     off: 1,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
      { name: 'Spannung L3',     off: 2,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
      { name: 'Strom L1',        off: 3,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
      { name: 'Strom L2',        off: 4,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
      { name: 'Strom L3',        off: 5,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
      { name: 'Leistung gesamt', off: 7,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
      { name: 'Leistung L1',     off: 8,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
      { name: 'Leistung L2',     off: 9,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
      { name: 'Leistung L3',     off: 10, type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
      { name: 'Blindleistung',   off: 11, type: 's16', scale: 1,     dec: 0, unit: 'var', min: -32768, max: 32767 },
      { name: 'Scheinleistung',  off: 15, type: 'u16', scale: 1,     dec: 0, unit: 'VA',  min: 0,      max: 65535 },
      { name: 'Leistungsfaktor', off: 19, type: 's16', scale: 0.001, dec: 3, unit: '',    min: -1,     max: 1 },
      { name: 'Frequenz',        off: 26, type: 'u16', scale: 0.01,  dec: 2, unit: 'Hz',  min: 45,     max: 55 },
      { name: 'Bezug',           off: 29, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
      { name: 'Einspeisung',     off: 39, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
      { name: 'Energie netto',   off: 49, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: -99999999, max: 99999999 },
    ],
  },
];

// ============================================================================
// HILFSFUNKTIONEN
// ============================================================================
function log(m) { print('[dtsu] ' + m); }
function dbg(m) { if (CONFIG.DEBUG) log(m); }

function decode(v, off, type) {
  var x;
  if (type === 'u16') return v[off];
  if (type === 's16') { x = v[off]; return x >= 0x8000 ? x - 0x10000 : x; }
  if (type === 'u32') return v[off] * 65536 + v[off + 1];
  return null;
}

function round(v, dec) {
  var f = Math.pow(10, dec || 0);
  return Math.round(v * f) / f;
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
    Shelly.call('Serial.SetConfig', {
      id: CONFIG.SERIAL_ID,
      config: { mode: 'mb_client', serial: { baud: CONFIG.BAUD, format: CONFIG.FORMAT } },
    }, function (r, ec3, em3) {
      if (ec3 !== 0) { log('Serial.SetConfig Fehler: ' + em3); return; }
      log('Serial: ' + CONFIG.BAUD + ' ' + CONFIG.FORMAT + ', Slave ' + CONFIG.SLAVE_ID);
      done();
    });
  });
}

// ============================================================================
// VIRTUELLE KOMPONENTEN
// ============================================================================
var ALL = [];

function setupComponents(done) {
  var b, i, n = 0;
  for (b = 0; b < BLOCKS.length; b++) {
    for (i = 0; i < BLOCKS[b].items.length; i++) {
      var e = BLOCKS[b].items[i];
      e.id = CONFIG.FIRST_ID + n;
      e.key = 'number:' + e.id;
      ALL.push(e);
      n++;
    }
  }
  var specs = [{ type: 'group', id: CONFIG.FIRST_ID, cfg: { name: CONFIG.GROUP_NAME } }];
  for (i = 0; i < ALL.length; i++) {
    specs.push({
      type: 'number', id: ALL[i].id, cfg: {
        name: ALL[i].name, default_value: 0, min: ALL[i].min, max: ALL[i].max, persisted: false,
        meta: { ui: { view: 'label', unit: ALL[i].unit, step: Math.pow(10, -ALL[i].dec) } },
      },
    });
  }
  function next(k) {
    if (k >= specs.length) {
      var members = [];
      for (i = 0; i < ALL.length; i++) {
        ALL[i].h = Virtual.getHandle(ALL[i].key);
        members.push(ALL[i].key);
      }
      Shelly.call('Group.Set', { id: CONFIG.FIRST_ID, value: members }, function () { done(); });
      return;
    }
    var s = specs[k];
    var cb = function (r, ec, em) {
      if (ec !== 0) log(s.type + ':' + s.id + ' Fehler: ' + em);
      Timer.set(100, false, function () { next(k + 1); });
    };
    if (!Virtual.getHandle(s.type + ':' + s.id)) {
      Shelly.call('Virtual.Add', { type: s.type, id: s.id, config: s.cfg }, cb);
    } else {
      Shelly.call(s.type === 'group' ? 'Group.SetConfig' : 'Number.SetConfig', { id: s.id, config: s.cfg }, cb);
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
  var okBlocks = 0;
  function readBlock(bi) {
    if (bi >= BLOCKS.length) {
      busy = false;
      if (okBlocks === 0) {
        fails++;
        if (CONFIG.FC === 'auto') {
          method = method === 'ReadHoldingRegisters' ? 'ReadInputRegisters' : 'ReadHoldingRegisters';
          dbg('Wechsle auf ' + method);
        }
        if (fails === 1 || fails % 12 === 0) log('Keine Antwort (' + fails + 'x): TX/RX, A/B, Baudrate, Slave-ID prüfen');
      } else {
        if (fails > 0) log('Verbindung ok (' + method + ')');
        fails = 0;
      }
      return;
    }
    var blk = BLOCKS[bi];
    Shelly.call('MbRtuClient.' + method, {
      id: CONFIG.SERIAL_ID, sid: CONFIG.SLAVE_ID, addr: blk.addr, qty: blk.qty,
    }, function (res, ec, em) {
      if (ec !== 0 || !res || !res.values) {
        dbg('Block ' + blk.addr + ': ' + em);
      } else {
        okBlocks++;
        var v = res.values;
        for (var i = 0; i < blk.items.length; i++) {
          var e = blk.items[i];
          var raw = decode(v, e.off, e.type);
          if (raw === null || !e.h) continue;
          var scale = e.scale === 'E' ? CONFIG.ENERGY_SCALE : e.scale;
          var val = round(raw * scale, e.dec);
          if (val < e.min) val = e.min;
          if (val > e.max) val = e.max;
          e.h.setValue(val);
          dbg(e.name + ' = ' + val + ' ' + e.unit);
        }
      }
      Timer.set(50, false, function () { readBlock(bi + 1); });
    });
  }
  readBlock(0);
}

// ============================================================================
// START
// ============================================================================
setupSerial(function () {
  setupComponents(function () {
    log('Läuft: ' + ALL.length + ' Werte alle ' + CONFIG.POLL_INTERVAL / 1000 + ' s');
    Timer.set(500, false, poll);
    Timer.set(CONFIG.POLL_INTERVAL, true, poll);
  });
});
