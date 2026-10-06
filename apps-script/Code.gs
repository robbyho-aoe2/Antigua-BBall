/**
 * Pickup basketball signups: Google Apps Script backend.
 *
 * Paste this whole file into your Google Sheet's Apps Script editor
 * (Extensions → Apps Script), replacing anything already there.
 * See README.md for the full setup steps.
 *
 * Data lives in two tabs (created automatically):
 *   Events:  ID | Date | Time | Location | Cap | Notes | Open | Created | EndTime
 *   Signups: EventID | Name | Email | SignedUpAt | Order | Token | Lang | Notify
 *   Players: Name | Email | Notify | Updated   (one row per player; their email choice for all games)
 *
 * Players are identified by their full name (accents and capitals ignored).
 * Email is optional; when given, players get confirmation emails sent from
 * your Gmail (Google allows about 100 recipients a day on a regular account).
 *
 * The admin password lives in Script Properties under ADMIN_PASSWORD.
 */

const TZ = 'America/Guatemala';
const EVENTS_SHEET = 'Events';
const SIGNUPS_SHEET = 'Signups';
const PLAYERS_SHEET = 'Players';
const PLAYER_HEADERS = ['Name', 'Email', 'Notify', 'Updated'];
const EVENT_HEADERS = ['ID', 'Date', 'Time', 'Location', 'Cap', 'Notes', 'Open', 'Created', 'EndTime'];
const SIGNUP_HEADERS = ['EventID', 'Name', 'Email', 'SignedUpAt', 'Order', 'Token', 'Lang', 'Notify'];
const DEFAULT_CAP = 15;
const MAX_NAME = 60;
const MAX_EMAIL = 100;
const LEADERBOARD_SIZE = 10;

// Confirmation emails. Set SEND_EMAILS to false to turn them all off.
const SEND_EMAILS = true;
const SITE_NAME = 'Antigua Pickup';
const SITE_URL = 'https://robbyho-aoe2.github.io/Antigua-BBall/';

const PUBLIC_ACTIONS = {
  listEvents: listEvents,
  getEvent: getEvent,
  signup: signup,
  rename: rename,
  drop: drop,
  findSpot: findSpot,
  stats: stats,
  setNotify: setNotify,
};

const ADMIN_ACTIONS = {
  adminLogin: function () { return {}; },
  adminListEvents: adminListEvents,
  adminGetEvent: adminGetEvent,
  adminSaveEvent: adminSaveEvent,
  adminDeleteEvent: adminDeleteEvent,
  adminDuplicateEvent: adminDuplicateEvent,
  adminAddSignup: adminAddSignup,
  adminUpdateSignup: adminUpdateSignup,
  adminRemoveSignup: adminRemoveSignup,
  adminMoveSignup: adminMoveSignup,
};

/** Run this once from the editor (select "setup" → Run) to create the tabs and approve permissions. */
function setup() {
  SpreadsheetApp.getActive().setSpreadsheetTimeZone(TZ);
  ensureSheets_();
  if (!PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD')) {
    Logger.log('Remember to add ADMIN_PASSWORD in Project Settings → Script Properties.');
  }
  Logger.log('Setup complete.');
}

/**
 * Sends you a sample confirmation email. Run it once from the editor (select
 * "testEmail" → Run) to approve email sending and see what players receive.
 */
function testEmail() {
  const me = Session.getEffectiveUser().getEmail();
  const sample = { id: 'sample', date: addDays_(today_(), 2), time: '19:00', endTime: '21:00', location: 'Centro Integral Deportivo Ciudad Vieja', cap: 15, notes: '' };
  OUTBOX = [];
  queueEmail_({ name: 'Test Player', email: me, lang: '', test: true }, sample, 'signup', { position: 7, onRoster: true });
  flushEmails_();
  Logger.log('Sent a sample email to ' + me + '. Remaining daily email quota: ' + MailApp.getRemainingDailyQuota());
}

function doGet() {
  return json_({ ok: true, message: 'Pickup signup API is running.' });
}

function doPost(e) {
  const started = Date.now();
  let action = '';
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    action = String(req.action || '');
    OUTBOX = [];
    PLAYERS = null;
    EVENTS_MEMO = null;
    SIGNUPS_MEMO = null;
    VERSION = null;
    ensureSheetsOnce_();
    let result;
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, action)) {
      result = PUBLIC_ACTIONS[action](req);
    } else if (Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, action)) {
      checkAdmin_(req.password);
      result = ADMIN_ACTIONS[action](req);
    } else {
      fail_('Unknown action.');
    }
    const emails = OUTBOX.length;
    flushEmails_();
    // Shows in Apps Script → Executions, to spot slow requests.
    console.log(action + ' took ' + (Date.now() - started) + ' ms' + (emails ? ' (' + emails + ' email' + (emails > 1 ? 's' : '') + ')' : ''));
    return json_(Object.assign({ ok: true }, result));
  } catch (err) {
    OUTBOX = [];
    if (!err.isUserError) console.error(err && err.stack ? err.stack : err);
    console.log(action + ' failed after ' + (Date.now() - started) + ' ms');
    return json_({ ok: false, error: err.isUserError ? err.message : 'Server error: ' + err.message });
  }
}

/* ------------------------------------------------------------------ */
/* Speed: skip repeat work and reuse recent answers                    */
/* ------------------------------------------------------------------ */

const SCHEMA_VERSION = '5'; // bump when tabs or columns change

let EVENTS_MEMO = null;  // this request's copy of the Events tab
let SIGNUPS_MEMO = null; // this request's copy of the Signups tab
let VERSION = null;

function cache_() { return CacheService.getScriptCache(); }

/** Checks the tabs and headers once every few hours instead of on every request. */
function ensureSheetsOnce_() {
  if (cache_().get('schema') === SCHEMA_VERSION) return;
  ensureSheets_();
  cache_().put('schema', SCHEMA_VERSION, 21600);
}

/** Changes on every write, so cached answers from before a change are never used. */
function dataVersion_() {
  if (VERSION) return VERSION;
  VERSION = cache_().get('v');
  if (!VERSION) {
    VERSION = String(Date.now());
    cache_().put('v', VERSION, 21600);
  }
  return VERSION;
}

function bumpVersion_() {
  VERSION = String(Date.now()) + Math.random().toString(36).slice(2, 6);
  cache_().put('v', VERSION, 21600);
}

/** Forget this request's copies after writing to the sheet. */
function invalidate_() {
  EVENTS_MEMO = null;
  SIGNUPS_MEMO = null;
}

/**
 * Reuses a recent answer if nothing has changed since. Edits made directly in the
 * Sheet show up once the short TTL runs out (about a minute).
 */
function cached_(key, ttlSeconds, compute) {
  const fullKey = key + ':' + dataVersion_();
  const hit = cache_().get(fullKey);
  if (hit) return JSON.parse(hit);
  const value = compute();
  try {
    const str = JSON.stringify(value);
    if (str.length < 90000) cache_().put(fullKey, str, ttlSeconds);
  } catch (err) { /* caching is best-effort */ }
  return value;
}

function statsMap_() {
  return cached_('stats', 120, function () { return computeStats_(readEvents_(), readSignups_()); });
}

/* ------------------------------------------------------------------ */
/* Public actions                                                      */
/* ------------------------------------------------------------------ */

function listEvents() {
  return cached_('list:' + today_(), 60, function () {
    const today = today_();
    const groups = groupByEvent_(readSignups_());
    const upcoming = readEvents_()
      .filter(function (ev) { return ev.date >= today; })
      .sort(byWhen_)
      .map(function (ev) { return publicEvent_(ev, groups[ev.id] || [], today); });
    return { events: upcoming, leaders: leaderboard_(statsMap_()) };
  });
}

function getEvent(req) {
  const today = today_();
  const id = String(req.eventId || '').trim();
  const base = cached_('ev:' + id, 60, function () {
    const e = findEvent_(id);
    return {
      ev: e,
      list: (groupByEvent_(readSignups_())[e.id] || []).map(function (s) {
        return { name: s.name, email: s.email, notify: s.notify, token: s.token };
      }),
    };
  });
  const ev = base.ev;
  const list = base.list;
  const names = list.map(function (s) { return { name: s.name }; });
  // The device sends the tokens it remembers (usually one; two if a parent also signed up their kid).
  const tokens = [].concat(req.tokens || []).map(String).filter(Boolean);
  const mine = [];
  list.forEach(function (s, idx) {
    if (!s.token || tokens.indexOf(s.token) < 0) return;
    const pref = emailPref_(s);
    mine.push({
      token: s.token,
      name: s.name,
      hasEmail: !!pref.email,
      notify: pref.notify,
      position: idx + 1,
      onRoster: idx < ev.cap,
      waitlistPosition: idx < ev.cap ? 0 : idx - ev.cap + 1,
    });
  });
  return {
    event: publicEvent_(ev, list, today),
    roster: names.slice(0, ev.cap),
    waitlist: names.slice(ev.cap),
    mine: mine,
  };
}

function signup(req) {
  const name = requireFullName_(cleanName_(req.name));
  const email = cleanEmail_(req.email, false);
  const lang = cleanLang_(req.lang);
  // notify is only sent the first time a player chooses; otherwise their saved choice stands.
  const notify = typeof req.notify === 'boolean' ? req.notify : undefined;
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    if (ev.date < today_()) fail_('This game already happened.');
    if (!ev.open) fail_('Signups are closed for this game.');
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    assertNameFree_(list, name, null);
    savePlayer_(name, email, notify);
    const token = Utilities.getUuid();
    appendSignup_(ev.id, name, email, nextOrder_(list), token, lang, '');
    const position = list.length + 1;
    const onRoster = position <= ev.cap;
    queueEmail_({ name: name, email: email, lang: lang }, ev, 'signup', { position: position, onRoster: onRoster });
    const pref = emailPref_({ name: name, email: email });
    return { token: token, position: position, onRoster: onRoster, hasEmail: !!pref.email, notify: pref.notify };
  });
}

function rename(req) {
  const name = requireFullName_(cleanName_(req.name));
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    if (ev.date < today_()) fail_('This game already happened.');
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    const s = findByToken_(list, req.token);
    assertNameFree_(list, name, s.token);
    sheet_(SIGNUPS_SHEET).getRange(s.row, 2).setValue(name);
    return { name: name };
  });
}

function drop(req) {
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    if (ev.date < today_()) fail_('This game already happened.');
    return withRosterWatch_(ev.id, function (list) {
      const s = findByToken_(list, req.token);
      sheet_(SIGNUPS_SHEET).deleteRow(s.row);
      queueEmail_(s, ev, 'dropped');
      return {};
    });
  });
}

/** Turns a player's confirmation emails on or off, for all games. */
function setNotify(req) {
  const notify = req.notify !== false;
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    const s = findByToken_(list, req.token);
    savePlayer_(s.name, s.email, notify);
    return { notify: notify };
  });
}

/** Lets a player get their edit token back on a new device using full name + email. */
function findSpot(req) {
  const key = nameKey_(cleanName_(req.name));
  const email = cleanEmail_(req.email, true);
  const ev = findEvent_(req.eventId);
  const list = groupByEvent_(readSignups_())[ev.id] || [];
  const s = list.find(function (x) { return nameKey_(x.name) === key; });
  const known = s ? emailPref_(s).email : '';
  if (s && !known) fail_('That signup has no email, so it can\'t be found from another phone. Ask the organizer for help.');
  if (!s || known !== email) fail_('No signup found with that name and email for this game.');
  return { token: s.token };
}

function stats(req) {
  let key = req.name ? nameKey_(cleanName_(req.name)) : '';
  if (!key && req.token) {
    const s = readSignups_().find(function (x) { return x.token === String(req.token); });
    if (s) key = nameKey_(s.name);
  }
  if (!key) fail_('Enter your full name to see your stats.');
  const p = statsMap_()[key] || emptyStats_();
  return { stats: { name: p.name, games: p.games, streak: p.streak, bestStreak: p.bestStreak, earlyBirds: p.earlyBirds, buzzerBeaters: p.buzzerBeaters } };
}

/* ------------------------------------------------------------------ */
/* Admin actions                                                       */
/* ------------------------------------------------------------------ */

function adminListEvents() {
  const today = today_();
  const groups = groupByEvent_(readSignups_());
  const events = readEvents_()
    .sort(function (a, b) { return byWhen_(b, a); })
    .map(function (ev) { return publicEvent_(ev, groups[ev.id] || [], today); });
  return { events: events };
}

function adminGetEvent(req) {
  return withLock_({ readOnly: true }, function () {
    const ev = findEvent_(req.eventId);
    fillMissingTokens_();
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    return {
      event: publicEvent_(ev, list, today_()),
      signups: list.map(function (s) {
        return {
          token: s.token,
          name: s.name,
          email: s.email,
          at: s.at ? Utilities.formatDate(new Date(s.at), TZ, 'MMM d, h:mm a') : '',
        };
      }),
    };
  });
}

function adminSaveEvent(req) {
  const e = req.event || {};
  const date = normDate_(e.date);
  if (!date) fail_('Pick a date.');
  const time = normTime_(e.time);
  if (!/^\d{2}:\d{2}$/.test(time)) fail_('Pick a time.');
  const endTime = e.endTime ? normTime_(e.endTime) : '';
  if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) fail_('End time doesn\'t look right.');
  const location = cleanText_(e.location, 80);
  if (!location) fail_('Enter a location.');
  const cap = Math.floor(Number(e.cap));
  if (!(cap >= 1 && cap <= 200)) fail_('Roster size must be between 1 and 200.');
  const notes = cleanText_(e.notes, 500);
  const open = e.open !== false;

  return withLock_(function () {
    const sh = sheet_(EVENTS_SHEET);
    if (e.id) {
      const ev = findEvent_(e.id);
      // A new roster size can move people on or off the roster; tell them.
      return withRosterWatch_(ev.id, function () {
        sh.getRange(ev.row, 2, 1, 6).setValues([[date, time, safeCell_(location), cap, safeCell_(notes), open]]);
        sh.getRange(ev.row, 9).setValue(endTime);
        return { id: ev.id };
      });
    }
    const id = newId_();
    sh.appendRow([id, date, time, safeCell_(location), cap, safeCell_(notes), open, new Date(), endTime]);
    return { id: id };
  });
}

function adminDeleteEvent(req) {
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    const rows = readSignups_()
      .filter(function (s) { return s.eventId === ev.id; })
      .map(function (s) { return s.row; })
      .sort(function (a, b) { return b - a; });
    const ss = sheet_(SIGNUPS_SHEET);
    rows.forEach(function (r) { ss.deleteRow(r); });
    sheet_(EVENTS_SHEET).deleteRow(ev.row);
    return {};
  });
}

/** Copies an event (or the latest one if no ID is given) to 7 days later. */
function adminDuplicateEvent(req) {
  return withLock_(function () {
    let src;
    if (req.eventId) {
      src = findEvent_(req.eventId);
    } else {
      const events = readEvents_().sort(byWhen_);
      if (!events.length) fail_('There is no game to copy yet. Create one first.');
      src = events[events.length - 1];
    }
    const id = newId_();
    const date = addDays_(src.date, 7);
    sheet_(EVENTS_SHEET).appendRow([id, date, src.time, safeCell_(src.location), src.cap, safeCell_(src.notes), true, new Date(), src.endTime]);
    return { id: id, date: date };
  });
}

function adminAddSignup(req) {
  const name = cleanName_(req.name);
  const email = cleanEmail_(req.email, false);
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    assertNameFree_(list, name, null);
    savePlayer_(name, email, undefined);
    appendSignup_(ev.id, name, email, nextOrder_(list), Utilities.getUuid(), '', '');
    const position = list.length + 1;
    queueEmail_({ name: name, email: email, lang: '' }, ev, 'signup', { position: position, onRoster: position <= ev.cap });
    return {};
  });
}

function adminUpdateSignup(req) {
  const name = cleanName_(req.name);
  const email = cleanEmail_(req.email, false);
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    const s = findByToken_(list, req.token);
    assertNameFree_(list, name, s.token);
    sheet_(SIGNUPS_SHEET).getRange(s.row, 2, 1, 2).setValues([[name, email]]);
    if (email) savePlayer_(name, email, undefined);
    return {};
  });
}

function adminRemoveSignup(req) {
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    return withRosterWatch_(ev.id, function (list) {
      const s = findByToken_(list, req.token);
      sheet_(SIGNUPS_SHEET).deleteRow(s.row);
      queueEmail_(s, ev, 'removed');
      return {};
    });
  });
}

function adminMoveSignup(req) {
  const dir = Number(req.dir) < 0 ? -1 : 1;
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    return withRosterWatch_(ev.id, function (before) {
      const list = before.slice();
      const i = list.findIndex(function (s) { return s.token === String(req.token || ''); });
      if (i < 0) fail_('That player is no longer on the list. Refresh and try again.');
      const j = i + dir;
      if (j < 0 || j >= list.length) return {};
      const tmp = list[i]; list[i] = list[j]; list[j] = tmp;
      // Renumber the whole event 1..n so the Order column stays clean and readable.
      const sh = sheet_(SIGNUPS_SHEET);
      list.forEach(function (s, k) {
        if (s.order !== k + 1) sh.getRange(s.row, 5).setValue(k + 1);
      });
      return {};
    });
  });
}

/* ------------------------------------------------------------------ */
/* Stats / gamification                                                */
/* ------------------------------------------------------------------ */

function emptyStats_() {
  return { name: '', games: 0, streak: 0, bestStreak: 0, earlyBirds: 0, buzzerBeaters: 0 };
}

/**
 * Per-player stats over past games, keyed by full name (see nameKey_).
 * - games: past games where they made the roster
 * - streak: consecutive past games on the roster (being waitlisted doesn't break it, skipping a game does)
 * - earlyBirds: times they were first to sign up
 * - buzzerBeaters: times they got the last roster spot (e.g. #15 of 15)
 */
function computeStats_(events, signups) {
  const today = today_();
  const groups = groupByEvent_(signups);
  const past = events.filter(function (ev) { return ev.date < today; }).sort(byWhen_);
  const players = {};
  const get = function (key) { return players[key] || (players[key] = emptyStats_()); };

  const statuses = past.map(function (ev) {
    const list = groups[ev.id] || [];
    const status = {};
    list.forEach(function (s, i) {
      const key = nameKey_(s.name);
      status[key] = i < ev.cap ? 'roster' : 'wait';
      get(key).name = s.name; // latest game wins, so the newest spelling shows
    });
    if (list.length) get(nameKey_(list[0].name)).earlyBirds++;
    if (list.length >= ev.cap) get(nameKey_(list[ev.cap - 1].name)).buzzerBeaters++;
    return status;
  });

  Object.keys(players).forEach(function (key) {
    const p = players[key];
    let cur = 0;
    statuses.forEach(function (status) {
      const st = status[key];
      if (st === 'roster') {
        p.games++;
        cur++;
        if (cur > p.bestStreak) p.bestStreak = cur;
      } else if (!st) {
        cur = 0;
      }
    });
    p.streak = cur;
  });
  return players;
}

function leaderboard_(players) {
  return Object.keys(players)
    .map(function (k) { return players[k]; })
    .filter(function (p) { return p.games > 0; })
    .sort(function (a, b) { return b.games - a.games || b.streak - a.streak || a.name.localeCompare(b.name); })
    .slice(0, LEADERBOARD_SIZE)
    .map(function (p) { return { name: p.name, games: p.games, streak: p.streak }; });
}

/* ------------------------------------------------------------------ */
/* Sheet access                                                        */
/* ------------------------------------------------------------------ */

function sheet_(name) {
  let sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) { // a tab was deleted or renamed: recreate it
    ensureSheets_();
    sh = SpreadsheetApp.getActive().getSheetByName(name);
  }
  return sh;
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActive();
  const events = ensureSheet_(ss, EVENTS_SHEET, EVENT_HEADERS, ['B:C', 'I:I']);
  // Sheets made before the EndTime column existed: add its header once.
  if (events.getRange(1, 9).getValue() === '') {
    events.getRange(1, 9).setValue('EndTime').setFontWeight('bold');
    events.getRange('I:I').setNumberFormat('@');
  }
  const signups = ensureSheet_(ss, SIGNUPS_SHEET, SIGNUP_HEADERS, []);
  // Sheets made before the Lang column existed: add its header once.
  if (signups.getRange(1, 7).getValue() === '') signups.getRange(1, 7).setValue('Lang').setFontWeight('bold');
  if (signups.getRange(1, 8).getValue() === '') signups.getRange(1, 8).setValue('Notify').setFontWeight('bold');
  ensureSheet_(ss, PLAYERS_SHEET, PLAYER_HEADERS, []);
}

/* ------------------------------------------------------------------ */
/* Players (email + email choice, saved once per player)               */
/* ------------------------------------------------------------------ */

let PLAYERS = null; // per-request cache: nameKey → { row, name, email, notify }

function players_() {
  if (PLAYERS) return PLAYERS;
  PLAYERS = {};
  const sh = sheet_(PLAYERS_SHEET);
  const n = sh.getLastRow() - 1;
  if (n < 1) return PLAYERS;
  sh.getRange(2, 1, n, PLAYER_HEADERS.length).getValues().forEach(function (r, i) {
    const name = String(r[0]).trim();
    if (!name) return;
    const raw = String(r[2]).trim();
    PLAYERS[nameKey_(name)] = {
      row: i + 2,
      name: name,
      email: String(r[1]).trim().toLowerCase(),
      notify: !(r[2] === false || /^(false|no|0)$/i.test(raw)), // blank = yes
    };
  });
  return PLAYERS;
}

/**
 * Creates or updates a player's saved email/choice. Pass notify as undefined to keep
 * what they chose before (new players default to getting emails).
 */
function savePlayer_(name, email, notify) {
  const p = players_()[nameKey_(name)];
  const sh = sheet_(PLAYERS_SHEET);
  if (!p) {
    if (!email && notify === undefined) return;
    sh.appendRow([name, email || '', notify !== false, new Date()]);
  } else {
    sh.getRange(p.row, 1, 1, 4).setValues([[name, email || p.email, notify === undefined ? p.notify : notify, new Date()]]);
  }
  PLAYERS = null;
}

/** Where (and whether) to email a signup: the player's saved choice, else the signup row. */
function emailPref_(s) {
  const p = players_()[nameKey_(s.name)];
  return {
    email: s.email || (p ? p.email : ''),
    notify: p ? p.notify : s.notify !== false,
  };
}

function ensureSheet_(ss, name, headers, textColumns) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // Keep Date/Time as plain text so Sheets doesn't reformat them.
  textColumns.forEach(function (a1) { sh.getRange(a1).setNumberFormat('@'); });
  return sh;
}

function readEvents_() {
  if (EVENTS_MEMO) return EVENTS_MEMO;
  EVENTS_MEMO = readEventsFresh_();
  return EVENTS_MEMO;
}

function readEventsFresh_() {
  const sh = sheet_(EVENTS_SHEET);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const range = sh.getRange(2, 1, n, EVENT_HEADERS.length);
  const vals = range.getValues();
  const disp = range.getDisplayValues();
  return vals.map(function (r, i) {
    const openRaw = String(r[6]).trim().toLowerCase();
    return {
      row: i + 2,
      id: String(r[0]).trim(),
      date: normDate_(r[1]),
      time: normTime_(disp[i][2]),
      endTime: normTime_(disp[i][8]),
      location: String(r[3]).trim(),
      cap: Number(r[4]) >= 1 ? Math.floor(Number(r[4])) : DEFAULT_CAP,
      notes: String(r[5] || '').trim(),
      // Blank counts as open so hand-added rows work; FALSE/no/0 closes it.
      open: !(r[6] === false || openRaw === 'false' || openRaw === 'no' || openRaw === '0'),
    };
  }).filter(function (ev) { return ev.id && ev.date; });
}

function readSignups_() {
  if (SIGNUPS_MEMO) return SIGNUPS_MEMO;
  SIGNUPS_MEMO = readSignupsFresh_();
  return SIGNUPS_MEMO;
}

function readSignupsFresh_() {
  const sh = sheet_(SIGNUPS_SHEET);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, SIGNUP_HEADERS.length).getValues().map(function (r, i) {
    return {
      row: i + 2,
      eventId: String(r[0]).trim(),
      name: String(r[1]).trim(),
      email: String(r[2]).trim().toLowerCase(),
      at: r[3] instanceof Date ? r[3].getTime() : (Date.parse(r[3]) || 0),
      order: Number(r[4]) || 0,
      token: String(r[5]).trim(),
      lang: String(r[6] || '').trim(),
      // Blank (older rows) means yes; FALSE/no/0 turns emails off.
      notify: !(r[7] === false || /^(false|no|0)$/i.test(String(r[7]).trim())),
    };
  }).filter(function (s) { return s.eventId && s.name; });
}

/** Rows typed into the sheet by hand have no token; give them one so admin tools can target them. */
function fillMissingTokens_() {
  const sh = sheet_(SIGNUPS_SHEET);
  let wrote = false;
  readSignups_().forEach(function (s) {
    if (!s.token) { sh.getRange(s.row, 6).setValue(Utilities.getUuid()); wrote = true; }
  });
  if (wrote) { invalidate_(); bumpVersion_(); }
}

function appendSignup_(eventId, name, email, order, token, lang, notify) {
  sheet_(SIGNUPS_SHEET).appendRow([eventId, name, email, new Date(), order, token, lang || '', notify !== false]);
}

function groupByEvent_(signups) {
  const groups = {};
  signups.forEach(function (s) { (groups[s.eventId] = groups[s.eventId] || []).push(s); });
  Object.keys(groups).forEach(function (k) {
    groups[k].sort(function (a, b) {
      // Rows without an Order (typed in by hand) go to the end, by signup time.
      const oa = a.order > 0 ? a.order : 1e12;
      const ob = b.order > 0 ? b.order : 1e12;
      return oa - ob || a.at - b.at || a.row - b.row;
    });
  });
  return groups;
}

function findEvent_(id) {
  id = String(id || '').trim();
  const ev = id && readEvents_().find(function (e) { return e.id === id; });
  if (!ev) fail_('Game not found. It may have been deleted.');
  return ev;
}

function findByToken_(list, token) {
  token = String(token || '');
  const s = token && list.find(function (x) { return x.token === token; });
  if (!s) fail_('Your signup was not found. It may have been removed. Refresh and try again.');
  return s;
}

function assertNameFree_(list, name, exceptToken) {
  const key = nameKey_(name);
  const clash = list.find(function (s) { return nameKey_(s.name) === key && s.token !== exceptToken; });
  if (clash) fail_('"' + clash.name + '" is already signed up for this game.');
}

/** Same person = same full name, ignoring capitals, accents and extra spaces ("José  Pérez" = "jose perez"). */
function nameKey_(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Runs a change and emails anyone it moves on or off the roster
 * (e.g. someone drops and the first waitlisted player gets their spot).
 */
function withRosterWatch_(eventId, change) {
  const evBefore = findEvent_(eventId);
  const before = groupByEvent_(readSignups_())[eventId] || [];
  const result = change(before, evBefore);
  invalidate_();
  const ev = findEvent_(eventId);
  if (SEND_EMAILS && ev.date >= today_()) {
    const wasOn = {};
    before.forEach(function (s, i) { if (s.token) wasOn[s.token] = i < evBefore.cap; });
    (groupByEvent_(readSignups_())[eventId] || []).forEach(function (s, i) {
      if (!s.token || !(s.token in wasOn)) return;
      const on = i < ev.cap;
      if (on && !wasOn[s.token]) queueEmail_(s, ev, 'promoted', { position: i + 1 });
      if (!on && wasOn[s.token]) queueEmail_(s, ev, 'demoted', { position: i - ev.cap + 1 });
    });
  }
  return result;
}

function nextOrder_(list) {
  return list.reduce(function (m, s) { return Math.max(m, s.order || 0); }, 0) + 1;
}

function publicEvent_(ev, list, today) {
  return {
    id: ev.id,
    date: ev.date,
    time: ev.time,
    endTime: ev.endTime,
    location: ev.location,
    cap: ev.cap,
    notes: ev.notes,
    open: ev.open,
    past: ev.date < today,
    total: list.length,
    filled: Math.min(list.length, ev.cap),
    waitlist: Math.max(0, list.length - ev.cap),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function checkAdmin_(password) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) fail_('Admin password not set. Add ADMIN_PASSWORD in Apps Script → Project Settings → Script Properties.');
  if (String(password || '') !== real) {
    Utilities.sleep(1000); // slow down guessing
    fail_('Wrong password.');
  }
}

function withLock_(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('Lots of people signing up right now. Please try again.');
  try {
    invalidate_(); // read fresh data once we hold the lock
    const result = fn();
    if (!opts.readOnly) {
      SpreadsheetApp.flush();
      invalidate_();
      bumpVersion_();
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

function cleanName_(v) {
  const name = String(v || '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim();
  if (!name) fail_('Enter your name.');
  if (name.length > MAX_NAME) fail_('Name is too long (max ' + MAX_NAME + ' characters).');
  // "pedro gomez" → "Pedro Gomez"; names typed with any capitals are kept as typed.
  if (name === name.toLowerCase()) {
    return name.split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  return name;
}

function requireFullName_(name) {
  if (name.split(' ').length < 2) fail_('Please enter your full name (first and last).');
  return name;
}

function cleanLang_(v) {
  return v === 'es' || v === 'en' ? v : '';
}

function cleanEmail_(v, required) {
  const email = String(v || '').trim().toLowerCase();
  if (!email) {
    if (required) fail_('Enter your email.');
    return '';
  }
  if (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail_('That email doesn\'t look right.');
  return email;
}

function cleanText_(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/** Stops text like "=IMPORTXML(...)" from being treated as a formula. */
function safeCell_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY typed into the sheet
  if (m) return m[3] + '-' + pad2_(m[1]) + '-' + pad2_(m[2]);
  return '';
}

/** Accepts "19:00", "7:00 PM", "7pm", "19:00:00" and returns "HH:mm"; anything else is kept as typed. */
function normTime_(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i);
  if (!m) return s;
  let h = Number(m[1]);
  const min = m[2] || '00';
  if (m[3]) {
    const pm = m[3].toLowerCase() === 'p';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (h > 23 || Number(min) > 59) return s;
  return pad2_(h) + ':' + min;
}

function addDays_(ymd, n) {
  const p = ymd.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)), 'UTC', 'yyyy-MM-dd');
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function byWhen_(a, b) {
  return (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time);
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function pad2_(n) {
  return ('0' + n).slice(-2);
}

/* ------------------------------------------------------------------ */
/* Confirmation emails                                                 */
/* ------------------------------------------------------------------ */

let OUTBOX = [];

// Emails are collected while the sheet is locked and sent after, so a slow
// send never holds up other players.
function queueEmail_(s, ev, kind, extra) {
  if (!SEND_EMAILS || ev.date < today_()) return;
  const pref = s.test ? { email: s.email, notify: true } : emailPref_(s);
  if (!pref.email || !pref.notify) return;
  OUTBOX.push({ to: pref.email, name: s.name, lang: s.lang, ev: ev, kind: kind, extra: extra || {} });
}

function flushEmails_() {
  const box = OUTBOX;
  OUTBOX = [];
  if (!box.length) return;
  let quota = MailApp.getRemainingDailyQuota();
  box.forEach(function (m) {
    try {
      if (quota-- < 1) return console.warn('Daily email quota used up; skipped ' + m.kind);
      const c = composeEmail_(m);
      MailApp.sendEmail({ to: m.to, subject: c.subject, htmlBody: c.html, body: c.text, name: SITE_NAME });
    } catch (err) {
      console.error('Email to ' + m.to + ' failed: ' + err); // never block a signup over email
    }
  });
}

const EMAIL_TEXT = {
  en: {
    hi: 'Hi {name},',
    signupRosterSubj: '✅ You\'re in: {date}',
    signupRoster: 'You\'re <b>#{pos}</b> on the roster for this game.',
    signupWaitSubj: '⏳ Waitlist #{pos}: {date}',
    signupWait: 'The roster is full, so you\'re <b>#{pos} on the waitlist</b>. We\'ll email you if a spot opens up.',
    waitRule: 'People on the waitlist must wait until there are fewer than {cap} players in order to play. No exceptions.',
    promotedSubj: '🎉 A spot opened up, you\'re in: {date}',
    promoted: 'Good news! Someone dropped out and you\'re now <b>#{pos} on the roster</b>.',
    demotedSubj: '⏳ Moved to the waitlist: {date}',
    demoted: 'The roster changed and you\'re now <b>#{pos} on the waitlist</b>. We\'ll email you if a spot opens up.',
    droppedSubj: '👋 You dropped out: {date}',
    dropped: 'You\'re no longer signed up for this game. Thanks for freeing up the spot!',
    removedSubj: 'Removed from the list: {date}',
    removed: 'The organizer removed you from this game. If that\'s a mistake, just reply to this email.',
    cantMake: 'Can\'t make it? Please drop out so the next person can play.',
    view: 'View the game',
    map: 'Map',
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
  es: {
    hi: 'Hola {name}:',
    signupRosterSubj: '✅ Estás dentro: {date}',
    signupRoster: 'Eres el <b>#{pos}</b> en la lista de este partido.',
    signupWaitSubj: '⏳ Lista de espera #{pos}: {date}',
    signupWait: 'La lista está llena, así que eres el <b>#{pos} en la lista de espera</b>. Te escribiremos si se abre un lugar.',
    waitRule: 'Las personas en la lista de espera deben esperar a que haya menos de {cap} jugadores para poder jugar. Sin excepciones.',
    promotedSubj: '🎉 Se abrió un lugar, estás dentro: {date}',
    promoted: '¡Buenas noticias! Alguien se dio de baja y ahora eres el <b>#{pos} en la lista</b>.',
    demotedSubj: '⏳ Pasaste a la lista de espera: {date}',
    demoted: 'La lista cambió y ahora eres el <b>#{pos} en la lista de espera</b>. Te escribiremos si se abre un lugar.',
    droppedSubj: '👋 Te diste de baja: {date}',
    dropped: 'Ya no estás inscrito en este partido. ¡Gracias por liberar el lugar!',
    removedSubj: 'Te quitaron de la lista: {date}',
    removed: 'El organizador te quitó de este partido. Si es un error, responde a este correo.',
    cantMake: '¿No puedes ir? Por favor date de baja para que juegue la siguiente persona.',
    view: 'Ver el partido',
    map: 'Mapa',
    days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  },
};

function composeEmail_(m) {
  const langs = m.lang === 'en' || m.lang === 'es' ? [m.lang] : ['en', 'es']; // unknown language: send both
  const ev = m.ev;
  const link = SITE_URL + '?event=' + encodeURIComponent(ev.id);
  const mapLink = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.location);
  const key = m.kind === 'signup' ? (m.extra.onRoster ? 'signupRoster' : 'signupWait') : m.kind;
  const pos = m.kind === 'signup' && !m.extra.onRoster ? m.extra.position - ev.cap : m.extra.position;

  const subjects = [];
  const htmlParts = [];
  const textParts = [];
  langs.forEach(function (lang) {
    const T = EMAIL_TEXT[lang];
    const fill = function (str) {
      return str.replace(/\{(\w+)\}/g, function (_, k) {
        return { name: esc_(m.name), date: emailDate_(ev.date, lang), pos: pos, cap: ev.cap }[k];
      });
    };
    const when = emailDate_(ev.date, lang) + ' · ' + emailTime_(ev.time, ev.endTime, lang);
    const waitlisted = key === 'signupWait' || key === 'demoted';
    const stillPlaying = key === 'signupRoster' || key === 'promoted';
    subjects.push(fill(T[key + 'Subj']));
    htmlParts.push(
      '<p>' + fill(T.hi) + '</p>' +
      '<p>' + fill(T[key]) + '</p>' +
      '<p style="margin:16px 0;padding:12px 14px;background:#e3eedb;border-radius:10px">' +
        '<b>' + esc_(when) + '</b><br>📍 ' + esc_(ev.location) +
        ' · <a href="' + mapLink + '">' + T.map + '</a>' +
        (ev.notes ? '<br>' + esc_(ev.notes) : '') +
      '</p>' +
      (waitlisted ? '<p style="color:#6e4a00">⚠️ ' + fill(T.waitRule) + '</p>' : '') +
      (stillPlaying ? '<p>' + T.cantMake + '</p>' : '') +
      '<p><a href="' + link + '" style="display:inline-block;padding:10px 18px;background:#24502f;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold">' + T.view + '</a></p>'
    );
    textParts.push(htmlToText_(htmlParts[htmlParts.length - 1]) + '\n' + link);
  });

  return {
    subject: subjects.join(' / '),
    html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#2a2620;max-width:520px">' +
      htmlParts.join('<hr style="border:0;border-top:1px solid #eadfca;margin:24px 0">') +
      '<p style="color:#6f665a;font-size:12px">' + SITE_NAME + '</p></div>',
    text: textParts.join('\n\n----\n\n'),
  };
}

function emailDate_(ymd, lang) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const T = EMAIL_TEXT[lang];
  const day = T.days[d.getUTCDay()];
  const month = T.months[p[1] - 1];
  return lang === 'es' ? day.charAt(0).toUpperCase() + day.slice(1) + ' ' + p[2] + ' de ' + month : day + ', ' + month + ' ' + p[2];
}

function emailTime_(start, end, lang) {
  const one = function (hm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hm || '');
    if (!m) return hm || '';
    const h = Number(m[1]);
    return ((h % 12) || 12) + ':' + m[2] + ' ' + (lang === 'es' ? (h < 12 ? 'a.m.' : 'p.m.') : (h < 12 ? 'AM' : 'PM'));
  };
  return end ? one(start) + ' – ' + one(end) : one(start);
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlToText_(html) {
  return html.replace(/<br>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function fail_(msg) {
  const e = new Error(msg);
  e.isUserError = true;
  throw e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
