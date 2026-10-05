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
  async function api(action, data) {
    if (!CFG.API_URL || CFG.API_URL.indexOf('PASTE_') === 0) {
      throw new Error('This site is not connected yet: paste your Apps Script URL into config.js.');
    }
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action: action }, data || {})),
      });
    } catch (e) {
      throw new Error(translateError('Could not reach the server. Check your connection and try again.'));
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw new Error(translateError('Unexpected response from the server. Try again in a moment.'));
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
    api: api, esc: esc, fmtDate: fmtDate, fmtTime: fmtTime, toDate: toDate, store: store, cache: cache,
    toast: toast, busy: busy, applyBranding: applyBranding,
    t: t, tn: tn, locale: locale, useLang: useLang, lang: function () { return lang; },
  };
})();
