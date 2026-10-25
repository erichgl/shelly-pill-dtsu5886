/**
 * DTSU5886 (3-phasig, Modbus RTU) -> Shelly Virtual Components + MQTT + Home Assistant
 * Version: 0.12.0 (2026-10-25)
 * (c) 2026 erich.grassl@glw8.at
 * Gerät: Shelly "The Pill" (S3SN-0U53X), Firmware >= 2.0.1
 *        eigenes TTL<->RS485-Modul direkt an IO1 (TX) / IO2 (RX)
 *
 * Nutzt den eingebauten Modbus-RTU-Client der Pill (Pill-Modus "mb_client").
 *
 * REGISTERMAP (ermittelt und getestet am L-home DTSU5886, Register 0..50, 16-Bit-Ganzzahlen):
 *   0-2   Spannung L1-L3        x0.1  V
 *   3-5   Strom L1-L3           x0.01 A
 *   7     Wirkleistung gesamt   W     (8-10: L1-L3)
 *   11    Blindleistung gesamt  var   (12-14: L1-L3)
 *   15    Scheinleistung gesamt VA    (16-18: L1-L3)
 *   19    Leistungsfaktor ges.  x0.001 (20-22: L1-L3)
 *   26    Frequenz              x0.01 Hz (27-28: weitere Phasen)
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
 * MQTT
 *   MQTT: 1 veröffentlicht bei jeder Abfrage ALLE Werte (nicht nur die
 *   virtuellen Komponenten) als JSON:
 *     <MQTT_TOPIC>/state  {"p_l1":57,"p":131,"e_imp":10772.29,"u_l1":236.4,...}
 *     <MQTT_TOPIC>/raw    {"addr":0,"values":[2364,2331,...]}   (MQTT_RAW: 1)
 *   Die Verbindung zum Broker richtet das Script selbst ein (MQTT_SETUP: 1,
 *   siehe MQTT-BROKER unten) – oder manuell in der Pill (Settings -> MQTT).
 *   Geänderte Broker-Einstellungen übernimmt die Pill erst nach einem Neustart;
 *   das Script startet sie dafür einmal neu ("Run on startup" muss aktiv sein).
 *
 * HOME ASSISTANT DISCOVERY
 *   HA_DISCOVERY: 1 meldet alle Werte als Sensoren bei Home Assistant an
 *   (homeassistant/sensor/<geraet>/<key>/config, retained) – mit Einheit,
 *   device_class und state_class (Energie-Dashboard-tauglich). Wird beim Start,
 *   bei jeder MQTT-Verbindung und bei Neustart von Home Assistant gesendet.
 *
 * DEBUG
 *   DEBUG: 1 gibt die serielle Kommunikation in der Script-Konsole aus:
 *     TX  Modbus-Anfrage als Frame (Hex, inkl. CRC)
 *     RX  Antwort als Frame (Hex) und Registerwerte (dezimal)
 *   Hinweis: UART und CRC übernimmt die Firmware (MbRtuClient). Die Frames
 *   werden aus Anfrage und Antwort rekonstruiert und entsprechen dem, was
 *   über die Leitung geht.
 */

var VERSION = '0.12.0';

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
  ENERGY_SCALE: 0.01,   // kWh pro Zählschritt (am L-home DTSU5886 mit Display geprüft)
  MAX_NUMBERS: 9,       // Anzahl number-Komponenten (Limit der Pill)
  FIRST_ID: 200,        // IDs: number:200…, group:200
  GROUP_NAME: 'DTSU5886',
  MQTT: 1,              // 1 = alle Werte per MQTT veröffentlichen, 0 = aus
  MQTT_TOPIC: 'dtsu5886', // Basis-Topic
  MQTT_RAW: 1,          // 1 = zusätzlich alle Rohregister unter <topic>/raw
  MQTT_RETAIN: 1,       // 1 = Nachrichten mit retain-Flag senden
  HA_DISCOVERY: 1,      // 1 = Home-Assistant-Discovery senden, 0 = aus
  HA_PREFIX: 'homeassistant', // Discovery-Prefix in Home Assistant
  HA_DEVICE_NAME: 'DTSU5886', // Gerätename in Home Assistant

  // --- MQTT-BROKER (Einrichtung der Pill durch das Script) ---
  MQTT_SETUP: 1,        // 1 = Broker-Einstellungen der Pill setzen, 0 = nicht anfassen
  MQTT_SERVER: '',      // 'host:port', z.B. '192.168.1.10:1883' – leer = nicht einrichten
  MQTT_USER: '',        // Benutzer ('' = ohne Anmeldung)
  MQTT_PASS: '',        // Passwort
  MQTT_CLIENT_ID: '',   // '' = Geräte-ID der Pill
  MQTT_PREFIX: '',      // Topic-Prefix der Pill ('' = Geräte-ID), u.a. für <prefix>/online
  MQTT_SSL: '',         // '' = ohne TLS, '*' = TLS ohne Prüfung, 'ca.pem' = TLS mit CA
  MQTT_AUTO_REBOOT: 1,  // 1 = nach Änderung automatisch neu starten
};

// Register 0..50 werden mit EINER Anfrage gelesen.
var READ_ADDR = 0;
var READ_QTY = 51;

// Reihenfolge = Priorität. Die ersten MAX_NUMBERS werden zur virtuellen Komponente,
// per MQTT werden ALLE Einträge veröffentlicht (Feldname = key).
// type: 'u16', 's16', 'u32' (High-Word zuerst); scale 'E' = ENERGY_SCALE
var ENTITIES = [
  { key: 'p_l1',   name: 'Leistung L1',     off: 8,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { key: 'p_l2',   name: 'Leistung L2',     off: 9,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { key: 'p_l3',   name: 'Leistung L3',     off: 10, type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { key: 'p',      name: 'Leistung gesamt', off: 7,  type: 's16', scale: 1,     dec: 0, unit: 'W',   min: -32768, max: 32767 },
  { key: 'e_imp',  name: 'Bezug',           off: 29, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
  { key: 'u_l1',   name: 'Spannung L1',     off: 0,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
  { key: 'u_l2',   name: 'Spannung L2',     off: 1,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
  { key: 'u_l3',   name: 'Spannung L3',     off: 2,  type: 'u16', scale: 0.1,   dec: 1, unit: 'V',   min: 0,      max: 300 },
  { key: 'f',      name: 'Frequenz',        off: 26, type: 'u16', scale: 0.01,  dec: 2, unit: 'Hz',  min: 45,     max: 55 },
  // --- Reserve: zum Tauschen nach oben schieben ---
  { key: 'e_exp',  name: 'Einspeisung',     off: 39, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
  { key: 'e_net',  name: 'Energie netto',   off: 49, type: 'u32', scale: 'E',   dec: 2, unit: 'kWh', min: 0,      max: 99999999 },
  { key: 'i_l1',   name: 'Strom L1',        off: 3,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
  { key: 'i_l2',   name: 'Strom L2',        off: 4,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
  { key: 'i_l3',   name: 'Strom L3',        off: 5,  type: 'u16', scale: 0.01,  dec: 2, unit: 'A',   min: 0,      max: 120 },
  { key: 'pf',     name: 'Leistungsfaktor', off: 19, type: 's16', scale: 0.001, dec: 3, unit: '',    min: -1,     max: 1 },
  { key: 'q',      name: 'Blindleistung',   off: 11, type: 's16', scale: 1,     dec: 0, unit: 'var', min: -32768, max: 32767 },
  { key: 's',      name: 'Scheinleistung',  off: 15, type: 'u16', scale: 1,     dec: 0, unit: 'VA',  min: 0,      max: 65535 },
  { key: 'q_l1',   name: 'Blindleistung L1', off: 12, type: 's16', scale: 1,     dec: 0, unit: 'var', min: -32768, max: 32767 },
  { key: 'q_l2',   name: 'Blindleistung L2', off: 13, type: 's16', scale: 1,     dec: 0, unit: 'var', min: -32768, max: 32767 },
  { key: 'q_l3',   name: 'Blindleistung L3', off: 14, type: 's16', scale: 1,     dec: 0, unit: 'var', min: -32768, max: 32767 },
  { key: 's_l1',   name: 'Scheinleistung L1', off: 16, type: 'u16', scale: 1,     dec: 0, unit: 'VA',  min: 0,      max: 65535 },
  { key: 's_l2',   name: 'Scheinleistung L2', off: 17, type: 'u16', scale: 1,     dec: 0, unit: 'VA',  min: 0,      max: 65535 },
  { key: 's_l3',   name: 'Scheinleistung L3', off: 18, type: 'u16', scale: 1,     dec: 0, unit: 'VA',  min: 0,      max: 65535 },
  { key: 'pf_l1',  name: 'Leistungsfaktor L1', off: 20, type: 's16', scale: 0.001, dec: 3, unit: '',    min: -1,     max: 1 },
  { key: 'pf_l2',  name: 'Leistungsfaktor L2', off: 21, type: 's16', scale: 0.001, dec: 3, unit: '',    min: -1,     max: 1 },
  { key: 'pf_l3',  name: 'Leistungsfaktor L3', off: 22, type: 's16', scale: 0.001, dec: 3, unit: '',    min: -1,     max: 1 },
  { key: 'f_2',    name: 'Frequenz 2',      off: 27, type: 'u16', scale: 0.01,  dec: 2, unit: 'Hz',  min: 45,     max: 55 },
  { key: 'f_3',    name: 'Frequenz 3',      off: 28, type: 'u16', scale: 0.01,  dec: 2, unit: 'Hz',  min: 45,     max: 55 },
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
    ENTITIES[i].vc = 'number:' + (CONFIG.FIRST_ID + i);
    USED.push(ENTITIES[i]);
    steps.push({ type: 'number', id: CONFIG.FIRST_ID + i, cfg: numberCfg(ENTITIES[i]) });
  }
  steps.push({ type: 'group', id: CONFIG.FIRST_ID, cfg: { name: CONFIG.GROUP_NAME } });

  var members = [];

  function next(k) {
    if (k >= steps.length) {
      for (i = 0; i < USED.length; i++) USED[i].h = Virtual.getHandle(USED[i].vc);
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
// MQTT
// ============================================================================
var mqttWarned = false;

// MQTT nur nutzen, wenn es in der Pill aktiviert ist (sonst werfen die MQTT-Funktionen Fehler)
function mqttEnabled() {
  if (!CONFIG.MQTT || typeof MQTT === 'undefined') return false;
  var c = Shelly.getComponentConfig('mqtt');
  return c && c.enable ? true : false;
}

function mqttReady() {
  if (!mqttEnabled()) return false;
  try { return MQTT.isConnected() ? true : false; } catch (err) { return false; }
}

function mqttPublish(state, v) {
  if (!CONFIG.MQTT) return;
  if (!mqttReady()) {
    if (!mqttWarned) log(mqttEnabled() ? 'MQTT nicht verbunden – Broker prüfen'
                                       : 'MQTT in der Pill deaktiviert – Settings -> MQTT einschalten');
    mqttWarned = true;
    return;
  }
  if (mqttWarned) log('MQTT verbunden');
  mqttWarned = false;
  var retain = CONFIG.MQTT_RETAIN ? true : false;
  var js = JSON.stringify(state);
  try {
    MQTT.publish(CONFIG.MQTT_TOPIC + '/state', js, 0, retain);
    if (CONFIG.DEBUG) log('MQTT ' + CONFIG.MQTT_TOPIC + '/state ' + js);
    if (CONFIG.MQTT_RAW) {
      MQTT.publish(CONFIG.MQTT_TOPIC + '/raw', JSON.stringify({ addr: READ_ADDR, values: v }), 0, retain);
    }
  } catch (err) {
    log('MQTT Fehler: ' + err);
  }
}

// ============================================================================
// HOME ASSISTANT DISCOVERY
// ============================================================================
var HA_CLASS = { 'W': 'power', 'kWh': 'energy', 'V': 'voltage', 'A': 'current', 'Hz': 'frequency',
                 'var': 'reactive_power', 'VA': 'apparent_power', '': 'power_factor' };
var haBusy = false;

function haDevId() {
  var info = Shelly.getDeviceInfo();
  return (info && info.id ? info.id : 'pill') + '_dtsu';
}

function haConfig(e, devId, avail) {
  var c = {
    name: e.name,
    unique_id: devId + '_' + e.key,
    state_topic: CONFIG.MQTT_TOPIC + '/state',
    value_template: '{{ value_json.' + e.key + ' }}',
    device_class: HA_CLASS[e.unit],
    state_class: e.unit === 'kWh' ? (e.key === 'e_net' ? 'total' : 'total_increasing') : 'measurement',
    suggested_display_precision: e.dec,
    device: {
      identifiers: [devId],
      name: CONFIG.HA_DEVICE_NAME,
      manufacturer: 'L-home',
      model: 'DTSU5886 (Modbus RTU) via Shelly The Pill',
      sw_version: VERSION,
    },
  };
  if (e.unit !== '') c.unit_of_measurement = e.unit;
  if (avail) {
    c.availability_topic = avail;
    c.payload_available = 'true';
    c.payload_not_available = 'false';
  }
  return c;
}

function haPublish() {
  if (!CONFIG.MQTT || !CONFIG.HA_DISCOVERY || haBusy) return;
  if (!mqttReady()) return;
  haBusy = true;
  var devId = haDevId();
  var mq = Shelly.getComponentConfig('mqtt');
  var avail = mq && mq.topic_prefix ? mq.topic_prefix + '/online' : null;
  function next(i) {
    if (i >= ENTITIES.length) {
      haBusy = false;
      log('Home Assistant Discovery gesendet: ' + ENTITIES.length + ' Sensoren (' + devId + ')');
      return;
    }
    var e = ENTITIES[i];
    var topic = CONFIG.HA_PREFIX + '/sensor/' + devId + '/' + e.key + '/config';
    try {
      MQTT.publish(topic, JSON.stringify(haConfig(e, devId, avail)), 0, true);
    } catch (err) {
      haBusy = false;
      log('HA Discovery abgebrochen: ' + err);
      return;
    }
    if (CONFIG.DEBUG) log('HA ' + topic);
    Timer.set(150, false, function () { next(i + 1); });
  }
  next(0);
}

function haSetup() {
  if (!CONFIG.HA_DISCOVERY) return;
  if (!mqttEnabled()) {
    return;
  }
  try {
    // bei jeder (Wieder-)Verbindung zum Broker
    MQTT.setConnectHandler(function () { Timer.set(2000, false, haPublish); });
    // bei Neustart von Home Assistant
    MQTT.subscribe(CONFIG.HA_PREFIX + '/status', function (topic, msg) {
      if (msg === 'online') Timer.set(3000, false, haPublish);
    });
  } catch (err) {
    log('MQTT-Handler nicht gesetzt: ' + err);
  }
  Timer.set(1500, false, haPublish);
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

    var state = {};
    for (i = 0; i < ENTITIES.length; i++) {
      var e = ENTITIES[i];
      var raw = decode(v, e.off, e.type);
      if (raw === null) continue;
      var val = round(raw * (e.scale === 'E' ? CONFIG.ENERGY_SCALE : e.scale), e.dec);
      state[e.key] = val;
      if (e.h) e.h.setValue(Math.min(Math.max(val, e.min), e.max));
    }
    mqttPublish(state, v);
  });
}

// ============================================================================
// MQTT-BROKER EINRICHTEN
// ============================================================================
function orNull(x) { return x ? x : null; }

// einfache Prüfsumme der Soll-Konfiguration (Passwort nicht im Klartext speichern)
function fingerprint(c) {
  var t = c.server + '|' + c.user + '|' + CONFIG.MQTT_PASS + '|' + c.client_id + '|' + c.topic_prefix + '|' + c.ssl_ca;
  var h = 7, i;
  for (i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 1000000007;
  return 'v1-' + h;
}

function mqttSetup(done) {
  if (!CONFIG.MQTT || !CONFIG.MQTT_SETUP) { done(); return; }
  if (!CONFIG.MQTT_SERVER) {
    log('MQTT_SERVER leer – Broker-Einstellungen der Pill bleiben unverändert');
    done();
    return;
  }
  var want = {
    enable: true,
    server: CONFIG.MQTT_SERVER,
    user: orNull(CONFIG.MQTT_USER),
    client_id: orNull(CONFIG.MQTT_CLIENT_ID),
    topic_prefix: orNull(CONFIG.MQTT_PREFIX),
    ssl_ca: orNull(CONFIG.MQTT_SSL),
  };
  var fp = fingerprint(want);
  var cur = Shelly.getComponentConfig('mqtt') || {};

  Shelly.call('KVS.Get', { key: 'dtsu_mqtt_fp' }, function (r, ec) {
    var stored = (ec === 0 && r) ? r.value : null;
    var same = cur.enable === true && cur.server === want.server && cur.user === want.user &&
               cur.ssl_ca === want.ssl_ca && stored === fp &&
               (want.client_id === null || cur.client_id === want.client_id) &&
               (want.topic_prefix === null || cur.topic_prefix === want.topic_prefix);
    if (same) {
      if (CONFIG.DEBUG) log('MQTT-Einstellungen aktuell (' + want.server + ')');
      done();
      return;
    }
    var cfg = {};
    for (var k in want) cfg[k] = want[k];
    cfg.pass = orNull(CONFIG.MQTT_PASS);
    log('Setze MQTT: ' + want.server + (want.user ? ', Benutzer ' + want.user : '') +
        (want.ssl_ca ? ', TLS' : ''));
    Shelly.call('Mqtt.SetConfig', { config: cfg }, function (res, ec2, em2) {
      if (ec2 !== 0) {
        log('Mqtt.SetConfig Fehler: ' + em2);
        done();
        return;
      }
      Shelly.call('KVS.Set', { key: 'dtsu_mqtt_fp', value: fp }, function () {
        if (res && res.restart_required) {
          if (CONFIG.MQTT_AUTO_REBOOT) {
            log('MQTT gesetzt – Neustart in 3 s (Script muss "Run on startup" haben)');
            Timer.set(3000, false, function () { Shelly.call('Shelly.Reboot', {}); });
            return;   // nicht weitermachen, Pill startet neu
          }
          log('MQTT gesetzt – bitte Pill neu starten, damit die Einstellungen aktiv werden');
        } else {
          log('MQTT gesetzt');
        }
        done();
      });
    });
  });
}

// ============================================================================
// START
// ============================================================================
log('DTSU5886 Pill-Script v' + VERSION);
mqttSetup(function () {
  setupSerial(function () {
    setupComponents(function () {
      log('Läuft: ' + USED.length + ' Werte als Komponente' +
          (mqttEnabled() ? ', ' + ENTITIES.length + ' per MQTT (' + CONFIG.MQTT_TOPIC + ')' : ', MQTT aus') +
          ', alle ' + CONFIG.POLL_INTERVAL / 1000 + ' s');
      haSetup();
      Timer.set(500, false, poll);
      Timer.set(CONFIG.POLL_INTERVAL, true, poll);
    });
  });
});
