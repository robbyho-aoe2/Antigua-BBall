// Shared helpers for index.html and admin.html.
(function () {
  const CFG = window.APP_CONFIG || {};

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
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw new Error('Unexpected response from the server. Try again in a moment.');
    }
    if (!body.ok) throw new Error(body.error || 'Something went wrong.');
    return body;
  }

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

  function fmtDate(ymd, opts) {
    return toDate(ymd).toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function fmtTime(hm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hm || '');
    if (!m) return hm || '';
    const h = Number(m[1]);
    return ((h % 12) || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

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
    if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
    try { return await fn(); }
    finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
  }

  function applyBranding() {
    const name = CFG.SITE_NAME || 'Pickup';
    document.querySelectorAll('[data-site-name]').forEach(function (el) { el.textContent = name; });
    document.querySelectorAll('[data-tagline]').forEach(function (el) { el.textContent = CFG.TAGLINE || ''; });
    if (!document.title || document.title === 'Pickup') document.title = name;
    else document.title = document.title.replace('Pickup', name);
  }

  window.Pickup = { api: api, esc: esc, fmtDate: fmtDate, fmtTime: fmtTime, toDate: toDate, store: store, toast: toast, busy: busy, applyBranding: applyBranding };
})();
