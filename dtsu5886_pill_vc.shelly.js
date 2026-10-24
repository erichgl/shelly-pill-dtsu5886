/**
 * DTSU5886 (3-phasig, Modbus RTU) -> Shelly Virtual Components
 * Gerät: Shelly "The Pill" (S3SN-0U53X), Firmware >= 2.0.1
 *        eigenes TTL<->RS485-Modul direkt an IO1 (TX) / IO2 (RX)
 *
 * Nutzt den eingebauten Modbus-RTU-Client der Pill (Pill-Modus "mb_client",
 * RPC MbRtuClient.ReadHoldingRegisters) – kein eigenes Frame/CRC-Handling nötig.
 *
 * REGISTERMAP: vorbelegt mit der Chint-DTSU666-kompatiblen Belegung
 * (Funktionscode 0x03, Float32, Big Endian), die viele DTSU5886-Varianten
 * verwenden. DTSU5886 wird von mehreren Herstellern gebaut -> vor Gebrauch
 * mit dem Handbuch deines Zählers abgleichen (siehe Test-URL in der Anleitung).
 */

// ============================================================================
// KONFIGURATION
// ============================================================================
var CONFIG = {
  SLAVE_ID: 1,          // Modbus-Adresse am Zähler (Menü "Addr")
  BAUD: 9600,           // Zähler-Menü "bAud"
  FORMAT: '8N1',        // Datenbits/Parität/Stopp, z.B. '8E1'
  SERIAL_ID: 0,         // Serial- / MbRtuClient-Instanz der Pill
  POLL_INTERVAL: 5000,  // ms
  FIRST_ID: 200,        // virtuelle Komponenten ab number:200 / group:200
  GROUP_NAME: 'DTSU5886',
  DEBUG: false,
};

// Blöcke werden jeweils mit EINER Anfrage gelesen (max. 123 Register).
// Entitäten: off = Registeroffset im Block, scale = Faktor auf den Rohwert.
var BLOCKS = [
  {
    addr: 0x2006, qty: 20, // Ua .. Pc
    items: [
      { name: 'Spannung L1',  off: 0,  scale: 0.1,   dec: 1, unit: 'V', min: 0, max: 300 },
      { name: 'Spannung L2',  off: 2,  scale: 0.1,   dec: 1, unit: 'V', min: 0, max: 300 },
      { name: 'Spannung L3',  off: 4,  scale: 0.1,   dec: 1, unit: 'V', min: 0, max: 300 },
      { name: 'Strom L1',     off: 6,  scale: 0.001, dec: 2, unit: 'A', min: -100, max: 100 },
      { name: 'Strom L2',     off: 8,  scale: 0.001, dec: 2, unit: 'A', min: -100, max: 100 },
      { name: 'Strom L3',     off: 10, scale: 0.001, dec: 2, unit: 'A', min: -100, max: 100 },
      { name: 'Leistung ges.',off: 12, scale: 0.1,   dec: 0, unit: 'W', min: -70000, max: 70000 },
      { name: 'Leistung L1',  off: 14, scale: 0.1,   dec: 0, unit: 'W', min: -25000, max: 25000 },
      { name: 'Leistung L2',  off: 16, scale: 0.1,   dec: 0, unit: 'W', min: -25000, max: 25000 },
      { name: 'Leistung L3',  off: 18, scale: 0.1,   dec: 0, unit: 'W', min: -25000, max: 25000 },
    ],
  },
  {
    addr: 0x2044, qty: 2,
    items: [
      { name: 'Frequenz', off: 0, scale: 0.01, dec: 2, unit: 'Hz', min: 45, max: 55 },
    ],
  },
  {
    addr: 0x101E, qty: 12,
    items: [
      { name: 'Bezug',       off: 0,  scale: 1, dec: 2, unit: 'kWh', min: 0, max: 99999999 },
      { name: 'Einspeisung', off: 10, scale: 1, dec: 2, unit: 'kWh', min: 0, max: 99999999 },
    ],
  },
];

// ============================================================================
// HILFSFUNKTIONEN
// ============================================================================
function log(m) { print('[dtsu] ' + m); }
function dbg(m) { if (CONFIG.DEBUG) log(m); }

// Float32 aus zwei 16-Bit-Registern (High-Word zuerst)
function regsToFloat(hi, lo) {
  var b0 = (hi >> 8) & 0xFF, b1 = hi & 0xFF, b2 = (lo >> 8) & 0xFF, b3 = lo & 0xFF;
  var sign = (b0 & 0x80) ? -1 : 1;
  var exp = ((b0 & 0x7F) << 1) | (b1 >> 7);
  var mant = (b1 & 0x7F) * 65536 + b2 * 256 + b3;
  if (exp === 0 && mant === 0) return 0;
  if (exp === 255) return null;
  if (exp === 0) return sign * mant * Math.pow(2, -149);
  return sign * (1 + mant / 8388608) * Math.pow(2, exp - 127);
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
    var method = Virtual.getHandle(s.type + ':' + s.id) ? null : 'Virtual.Add';
    var cb = function (r, ec, em) {
      if (ec !== 0) log(s.type + ':' + s.id + ' Fehler: ' + em);
      Timer.set(100, false, function () { next(k + 1); });
    };
    if (method) {
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

function poll() {
  if (busy) return;
  busy = true;
  var okBlocks = 0;
  function readBlock(bi) {
    if (bi >= BLOCKS.length) {
      busy = false;
      if (okBlocks === 0) {
        fails++;
        if (fails === 1 || fails % 12 === 0) log('Keine Antwort (' + fails + 'x): TX/RX, A/B, Baudrate, Slave-ID prüfen');
      } else {
        fails = 0;
      }
      return;
    }
    var blk = BLOCKS[bi];
    Shelly.call('MbRtuClient.ReadHoldingRegisters', {
      id: CONFIG.SERIAL_ID, sid: CONFIG.SLAVE_ID, addr: blk.addr, qty: blk.qty,
    }, function (res, ec, em) {
      if (ec !== 0 || !res || !res.values) {
        dbg('Block 0x' + blk.addr.toString(16) + ': ' + em);
      } else {
        okBlocks++;
        var v = res.values;
        for (var i = 0; i < blk.items.length; i++) {
          var e = blk.items[i];
          var raw = regsToFloat(v[e.off], v[e.off + 1]);
          if (raw === null || !e.h) continue;
          var val = round(raw * e.scale, e.dec);
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
