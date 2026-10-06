// Shared helpers for index.html and admin.html.
(function () {
  const CFG = window.APP_CONFIG || {};
  const STRINGS = window.PICKUP_STRINGS || { en: {} };
  const ERRORS_ES = window.PICKUP_ERRORS_ES || [];
  const LANG_KEY = 'pickup.lang';

  // localStorage can throw in private mode; never let that break the page.
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };

  // Last server responses, so pages can paint instantly and refresh in the background.
  const cache = {
    get(key) { return store.get('pickup.cache.' + key, null); },
    set(key, value) { store.set('pickup.cache.' + key, value); },
  };

  /* ---------- language ---------- */

  // A saved choice wins; otherwise use the phone's preferred language.
  function detectLang() {
    const saved = store.get(LANG_KEY, null);
    if (saved === 'en' || saved === 'es') return saved;
    const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    return String(prefs[0] || '').toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
  }

  let lang = detectLang();
  document.documentElement.lang = lang;

  // Admin page calls this to stay in English without changing the saved choice.
  function useLang(l) {
    lang = l;
    document.documentElement.lang = l;
  }

  function setLang(l) {
    store.set(LANG_KEY, l);
    location.reload();
  }

  function locale() { return lang === 'es' ? 'es-GT' : 'en-US'; }

  function t(key, vars) {
    let s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    }
    return s;
  }

  // Plural-aware: uses key_one / key_other and fills {n}.
  function tn(key, n, vars) {
    return t(key + (n === 1 ? '_one' : '_other'), Object.assign({ n: n }, vars || {}));
  }

  function translateError(msg) {
    if (lang !== 'es') return msg;
    for (let i = 0; i < ERRORS_ES.length; i++) {
      if (ERRORS_ES[i][0].test(msg)) return msg.replace(ERRORS_ES[i][0], ERRORS_ES[i][1]);
    }
    return msg;
  }

  /* ---------- server ---------- */

  // Apps Script can't answer CORS preflight requests, so the body is sent as
  // text/plain (fetch's default for a string body), which skips the preflight.
  // Loading data is safe to repeat, so these retry once on a timeout or dropped connection.
  // Sign-ups and other changes never retry automatically (no accidental double sign-ups).
  const READ_ONLY = ['listEvents', 'getEvent', 'stats', 'adminLogin', 'adminListEvents', 'adminGetEvent'];

  async function api(action, data) {
    try {
      return await apiOnce(action, data);
    } catch (e) {
      if (!e.retryable || READ_ONLY.indexOf(action) < 0) throw e;
      return apiOnce(action, data);
    }
  }

  async function apiOnce(action, data) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE_') === 0) {
      throw new Error('This site is not connected yet: paste your Apps Script URL into config.js.');
    }
    let res;
    // Never spin forever: give up after 45 seconds.
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl && setTimeout(function () { ctrl.abort(); }, 45000);
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action: action }, data || {})),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      const err = new Error(translateError(e && e.name === 'AbortError'
        ? 'The server took too long to answer. Please try again.'
        : 'Could not reach the server. Check your connection and try again.'));
      err.retryable = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    let body;
    const raw = await res.text().catch(function () { return ''; });
    try {
      body = JSON.parse(raw);
    } catch (e) {
      // Apps Script sends an HTML page when the script itself fails; surface its message.
      const text = raw.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
      const detail = text ? ' (' + text.slice(0, 160) + ')' : (res.status ? ' (HTTP ' + res.status + ')' : '');
      throw new Error(translateError('Unexpected response from the server. Try again in a moment.') + detail);
    }
    if (!body.ok) throw new Error(translateError(body.error || 'Something went wrong.'));
    return body;
  }

  /* ---------- formatting ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Dates are "YYYY-MM-DD" strings; build them in local time so they never shift a day.
  function toDate(ymd) {
    const p = String(ymd).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function fmtDate(ymd, opts) {
    return capitalize(toDate(ymd).toLocaleDateString(locale(), opts || { weekday: 'short', month: 'short', day: 'numeric' }));
  }

  function fmtTime(hm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hm || '');
    if (!m) return hm || '';
    const h = Number(m[1]);
    const ampm = lang === 'es' ? (h < 12 ? 'a.m.' : 'p.m.') : (h < 12 ? 'AM' : 'PM');
    return ((h % 12) || 12) + ':' + m[2] + ' ' + ampm;
  }

  /* ---------- locations ---------- */

  function locations() { return Array.isArray(CFG.LOCATIONS) ? CFG.LOCATIONS : []; }

  // Matches a game's location text to a gym from config.js (case-insensitive).
  function findLocation(name) {
    const key = String(name || '').trim().toLowerCase();
    return locations().find(function (l) { return String(l.name).trim().toLowerCase() === key; }) || null;
  }

  function mapsUrl(name) {
    const loc = findLocation(name);
    if (loc && loc.mapUrl) return loc.mapUrl;
    const query = loc && loc.address ? loc.name + ', ' + loc.address : name;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
  }

  // "7:00 PM" or "7:00 – 9:00 PM" when the game has an end time.
  function fmtTimeRange(start, end) {
    if (!end) return fmtTime(start);
    const a = fmtTime(start);
    const b = fmtTime(end);
    const suffix = function (s) { return s.slice(s.indexOf(' ')); };
    return (a.indexOf(' ') > 0 && suffix(a) === suffix(b) ? a.slice(0, a.indexOf(' ')) : a) + ' – ' + b;
  }

  /* ---------- installable app ---------- */

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  // Android/desktop Chrome: hold the install prompt so the page can offer its own button.
  let installPrompt = null;
  const installListeners = [];
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    installListeners.forEach(function (fn) { fn(); });
  });
  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    installListeners.forEach(function (fn) { fn(); });
  });

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  const install = {
    // 'prompt' (one-tap button), 'ios' (Share → Add to Home Screen), or '' (nothing to offer).
    mode: function () {
      if (isStandalone()) return '';
      if (installPrompt) return 'prompt';
      if (isIOS()) return 'ios';
      return '';
    },
    run: function () {
      if (!installPrompt) return Promise.resolve();
      const p = installPrompt;
      installPrompt = null;
      p.prompt();
      return p.userChoice.catch(function () {});
    },
    onChange: function (fn) { installListeners.push(fn); },
  };

  /* ---------- UI bits ---------- */

  let toastTimer;
  function toast(msg, isError) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, isError ? 5000 : 3000);
  }

  // Disable a button while an async action runs.
  async function busy(btn, fn) {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = t('working'); }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }

  function applyBranding() {
    const name = CFG.SITE_NAME || 'Pickup';
    const tagline = (lang === 'es' && CFG.TAGLINE_ES) || CFG.TAGLINE || '';
    document.querySelectorAll('[data-site-name]').forEach(function (el) { el.textContent = name; });
    document.querySelectorAll('[data-tagline]').forEach(function (el) { el.textContent = tagline; });
    document.title = document.title.replace('Pickup', name);
    document.querySelectorAll('[data-lang-toggle]').forEach(function (btn) {
      btn.textContent = t('langToggle');
      btn.onclick = function () { setLang(lang === 'es' ? 'en' : 'es'); };
    });
  }

  window.Pickup = {
    api: api, esc: esc, fmtDate: fmtDate, fmtTime: fmtTime, fmtTimeRange: fmtTimeRange, toDate: toDate, store: store, cache: cache, install: install,
    toast: toast, busy: busy, applyBranding: applyBranding,
    t: t, tn: tn, locale: locale, locations: locations, findLocation: findLocation, mapsUrl: mapsUrl, useLang: useLang, lang: function () { return lang; },
  };
})();
