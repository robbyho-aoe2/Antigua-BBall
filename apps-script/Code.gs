/**
 * Pickup basketball signups: Google Apps Script backend.
 *
 * Paste this whole file into your Google Sheet's Apps Script editor
 * (Extensions → Apps Script), replacing anything already there.
 * See README.md for the full setup steps.
 *
 * Data lives in two tabs (created automatically):
 *   Events:  ID | Date | Time | Location | Cap | Notes | Open | Created | EndTime
 *   Signups: EventID | Name | Email | SignedUpAt | Order | Token
 *
 * The admin password lives in Script Properties under ADMIN_PASSWORD.
 */

const TZ = 'America/Guatemala';
const EVENTS_SHEET = 'Events';
const SIGNUPS_SHEET = 'Signups';
const EVENT_HEADERS = ['ID', 'Date', 'Time', 'Location', 'Cap', 'Notes', 'Open', 'Created', 'EndTime'];
const SIGNUP_HEADERS = ['EventID', 'Name', 'Email', 'SignedUpAt', 'Order', 'Token'];
const DEFAULT_CAP = 15;
const MAX_NAME = 40;
const MAX_EMAIL = 100;
const MAX_PER_EMAIL = 2; // the player plus one family member (e.g. a parent signing up their kid)
const LEADERBOARD_SIZE = 10;

const PUBLIC_ACTIONS = {
  listEvents: listEvents,
  getEvent: getEvent,
  signup: signup,
  rename: rename,
  drop: drop,
  findSpot: findSpot,
  stats: stats,
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

function doGet() {
  return json_({ ok: true, message: 'Pickup signup API is running.' });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(req.action || '');
    ensureSheets_();
    let result;
    if (Object.prototype.hasOwnProperty.call(PUBLIC_ACTIONS, action)) {
      result = PUBLIC_ACTIONS[action](req);
    } else if (Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, action)) {
      checkAdmin_(req.password);
      result = ADMIN_ACTIONS[action](req);
    } else {
      fail_('Unknown action.');
    }
    return json_(Object.assign({ ok: true }, result));
  } catch (err) {
    if (!err.isUserError) console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: err.isUserError ? err.message : 'Server error: ' + err.message });
  }
}

/* ------------------------------------------------------------------ */
/* Public actions                                                      */
/* ------------------------------------------------------------------ */

function listEvents() {
  const today = today_();
  const events = readEvents_();
  const signups = readSignups_();
  const groups = groupByEvent_(signups);
  const upcoming = events
    .filter(function (ev) { return ev.date >= today; })
    .sort(byWhen_)
    .map(function (ev) { return publicEvent_(ev, groups[ev.id] || [], today); });
  return { events: upcoming, leaders: leaderboard_(computeStats_(events, signups)) };
}

function getEvent(req) {
  const today = today_();
  const ev = findEvent_(req.eventId);
  const list = groupByEvent_(readSignups_())[ev.id] || [];
  const names = list.map(function (s) { return { name: s.name }; });
  // The device sends the tokens it remembers (usually one; two if a parent also signed up their kid).
  const tokens = [].concat(req.tokens || []).map(String).filter(Boolean);
  const mine = [];
  list.forEach(function (s, idx) {
    if (!s.token || tokens.indexOf(s.token) < 0) return;
    mine.push({
      token: s.token,
      name: s.name,
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
  const name = cleanName_(req.name);
  const email = cleanEmail_(req.email, true);
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    if (ev.date < today_()) fail_('This game already happened.');
    if (!ev.open) fail_('Signups are closed for this game.');
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    assertNameFree_(list, name, null);
    const sameEmail = list.filter(function (s) { return s.email === email; });
    if (sameEmail.length && !req.family) {
      fail_('This email is already signed up as "' + sameEmail[0].name +
        '". Signing up your kid or a family member? Tick the family member box.');
    }
    if (sameEmail.length >= MAX_PER_EMAIL) {
      fail_('Only ' + MAX_PER_EMAIL + ' people can sign up with the same email.');
    }
    const token = Utilities.getUuid();
    appendSignup_(ev.id, name, email, nextOrder_(list), token);
    const position = list.length + 1;
    return { token: token, position: position, onRoster: position <= ev.cap };
  });
}

function rename(req) {
  const name = cleanName_(req.name);
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
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    const s = findByToken_(list, req.token);
    sheet_(SIGNUPS_SHEET).deleteRow(s.row);
    return {};
  });
}

/** Lets a player get their edit token back on a new device using name + email. */
function findSpot(req) {
  const name = cleanName_(req.name).toLowerCase();
  const email = cleanEmail_(req.email, true);
  const ev = findEvent_(req.eventId);
  const list = groupByEvent_(readSignups_())[ev.id] || [];
  const s = list.find(function (x) { return x.email === email && x.name.toLowerCase() === name; });
  if (!s) fail_('No signup found with that name and email for this game.');
  return { token: s.token };
}

function stats(req) {
  let email = req.email ? cleanEmail_(req.email, true) : '';
  const signups = readSignups_();
  if (!email && req.token) {
    const s = signups.find(function (x) { return x.token === String(req.token); });
    if (s) email = s.email;
  }
  if (!email) fail_('Enter your email to see your stats.');
  const all = computeStats_(readEvents_(), signups);
  const p = all[email] || emptyStats_();
  return { stats: { name: p.name, games: p.games, streak: p.streak, bestStreak: p.bestStreak, earlyBirds: p.earlyBirds } };
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
  return withLock_(function () {
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
      sh.getRange(ev.row, 2, 1, 6).setValues([[date, time, safeCell_(location), cap, safeCell_(notes), open]]);
      sh.getRange(ev.row, 9).setValue(endTime);
      return { id: ev.id };
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
    appendSignup_(ev.id, name, email, nextOrder_(list), Utilities.getUuid());
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
    return {};
  });
}

function adminRemoveSignup(req) {
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    const list = groupByEvent_(readSignups_())[ev.id] || [];
    const s = findByToken_(list, req.token);
    sheet_(SIGNUPS_SHEET).deleteRow(s.row);
    return {};
  });
}

function adminMoveSignup(req) {
  const dir = Number(req.dir) < 0 ? -1 : 1;
  return withLock_(function () {
    const ev = findEvent_(req.eventId);
    const list = groupByEvent_(readSignups_())[ev.id] || [];
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
}

/* ------------------------------------------------------------------ */
/* Stats / gamification                                                */
/* ------------------------------------------------------------------ */

function emptyStats_() {
  return { name: '', games: 0, streak: 0, bestStreak: 0, earlyBirds: 0 };
}

/**
 * Per-email stats over past games.
 * - games: past games where they made the roster
 * - streak: consecutive past games on the roster (being waitlisted doesn't break it, skipping a game does)
 * - earlyBirds: times they were first to sign up
 */
function computeStats_(events, signups) {
  const today = today_();
  const groups = groupByEvent_(signups);
  const past = events.filter(function (ev) { return ev.date < today; }).sort(byWhen_);
  const players = {};
  const get = function (email) { return players[email] || (players[email] = emptyStats_()); };

  const statuses = past.map(function (ev) {
    const list = groups[ev.id] || [];
    const status = {};
    list.forEach(function (s, i) {
      if (!s.email) return;
      const onRoster = i < ev.cap;
      if (!status[s.email]) {
        status[s.email] = onRoster ? 'roster' : 'wait';
        get(s.email).name = s.name; // latest game wins, so renames carry forward
      } else if (onRoster) {
        status[s.email] = 'roster';
      }
    });
    if (list.length && list[0].email) get(list[0].email).earlyBirds++;
    return status;
  });

  Object.keys(players).forEach(function (email) {
    const p = players[email];
    let cur = 0;
    statuses.forEach(function (status) {
      const st = status[email];
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
  return SpreadsheetApp.getActive().getSheetByName(name);
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActive();
  const events = ensureSheet_(ss, EVENTS_SHEET, EVENT_HEADERS, ['B:C', 'I:I']);
  // Sheets made before the EndTime column existed: add its header once.
  if (events.getRange(1, 9).getValue() === '') {
    events.getRange(1, 9).setValue('EndTime').setFontWeight('bold');
    events.getRange('I:I').setNumberFormat('@');
  }
  ensureSheet_(ss, SIGNUPS_SHEET, SIGNUP_HEADERS, []);
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
    };
  }).filter(function (s) { return s.eventId && s.name; });
}

/** Rows typed into the sheet by hand have no token; give them one so admin tools can target them. */
function fillMissingTokens_() {
  const sh = sheet_(SIGNUPS_SHEET);
  readSignups_().forEach(function (s) {
    if (!s.token) sh.getRange(s.row, 6).setValue(Utilities.getUuid());
  });
}

function appendSignup_(eventId, name, email, order, token) {
  sheet_(SIGNUPS_SHEET).appendRow([eventId, name, email, new Date(), order, token]);
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
  const lower = name.toLowerCase();
  const clash = list.find(function (s) { return s.name.toLowerCase() === lower && s.token !== exceptToken; });
  if (clash) fail_('"' + name + '" is already on the list. Add a last initial to tell you apart.');
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

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('Lots of people signing up right now. Please try again.');
  try {
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function cleanName_(v) {
  const name = String(v || '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@]+/, '').trim();
  if (!name) fail_('Enter your name.');
  if (name.length > MAX_NAME) fail_('Name is too long (max ' + MAX_NAME + ' characters).');
  return name;
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

function fail_(msg) {
  const e = new Error(msg);
  e.isUserError = true;
  throw e;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
