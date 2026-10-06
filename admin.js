// Admin page. The password is checked by Apps Script on every request; it's only kept
// in this tab's sessionStorage so you don't retype it on every click.
(function () {
  const P = window.Pickup;
  const esc = P.esc;
  const app = document.getElementById('app');
  const PW_KEY = 'pickup.adminpw';

  P.useLang('en'); // admin page is English-only
  P.applyBranding();

  let password = '';
  try { password = sessionStorage.getItem(PW_KEY) || ''; } catch (e) { /* ignore */ }

  function setPassword(v) {
    password = v;
    try {
      if (v) sessionStorage.setItem(PW_KEY, v); else sessionStorage.removeItem(PW_KEY);
    } catch (e) { /* ignore */ }
  }

  function field(form, name) { return form.querySelector('[name="' + name + '"]'); }

  async function adminApi(action, data) {
    try {
      return await P.api(action, Object.assign({ password: password }, data || {}));
    } catch (e) {
      if (/Wrong password/.test(e.message)) {
        setPassword('');
        showLogin(e.message);
      }
      throw e;
    }
  }

  function playerLink(id) {
    return new URL('./', location.href).href + '?event=' + encodeURIComponent(id);
  }

  /* ---------- routing (hash based: #, #new, #event=ID) ---------- */

  function route() {
    if (!password) return showLogin();
    const h = location.hash;
    if (h === '#new') return showEditor(null);
    const m = /^#event=(.+)$/.exec(h);
    if (m) return showEditor(decodeURIComponent(m[1]));
    showList();
  }
  window.addEventListener('hashchange', route);

  function loading() { app.innerHTML = '<div class="loading">Loading…</div>'; }

  function showError(err) {
    app.innerHTML = '<div class="error-box">' + esc(err.message) + '</div>' +
      '<div class="btn-row"><button class="btn" id="retry">Try again</button><a class="btn" href="#">All games</a></div>';
    document.getElementById('retry').onclick = route;
  }

  /* ---------- login ---------- */

  function showLogin(msg) {
    app.innerHTML =
      '<form class="card" id="login-form">' +
        '<label for="pw">Admin password</label>' +
        '<input id="pw" name="pw" type="password" autocomplete="current-password" required>' +
        (msg ? '<p class="hint" style="color:var(--terracotta)">' + esc(msg) + '</p>' : '') +
        '<button class="btn primary block" type="submit">Log in</button>' +
      '</form>';
    const form = document.getElementById('login-form');
    field(form, 'pw').focus();
    form.onsubmit = function (e) {
      e.preventDefault();
      const value = field(form, 'pw').value;
      P.busy(form.querySelector('button'), async function () {
        try {
          await P.api('adminLogin', { password: value });
          setPassword(value);
          route();
        } catch (err) {
          P.toast(err.message, true);
        }
      });
    };
  }

  /* ---------- event list ---------- */

  async function showList() {
    loading();
    let data;
    try { data = await adminApi('adminListEvents'); } catch (e) { if (password) showError(e); return; }

    app.innerHTML =
      '<div class="toolbar">' +
        '<a class="btn primary" href="#new">+ New game</a>' +
        '<button class="btn accent" id="dup-last">Copy last game +7 days</button>' +
      '</div>' +
      (data.events.length ? data.events.map(eventRow).join('') : '<div class="card muted">No games yet. Create your first one.</div>') +
      '<button class="linkish small" id="logout">Log out</button>';

    document.getElementById('dup-last').onclick = function (e) {
      P.busy(e.currentTarget, async function () {
        try {
          const r = await adminApi('adminDuplicateEvent', {});
          P.toast('Created game for ' + P.fmtDate(r.date));
          location.hash = '#event=' + encodeURIComponent(r.id);
        } catch (err) { P.toast(err.message, true); }
      });
    };
    document.getElementById('logout').onclick = function () { setPassword(''); showLogin(); };
  }

  function eventRow(ev) {
    const d = P.toDate(ev.date);
    const status = ev.past ? '<span class="pill past">Past</span>'
      : ev.open ? '<span class="pill">Open</span>' : '<span class="pill closed">Closed</span>';
    return (
      '<a class="card event-card" href="#event=' + encodeURIComponent(ev.id) + '"' + (ev.past ? ' style="opacity:.7"' : '') + '>' +
        '<div class="date-badge">' +
          '<span class="dow">' + d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() + '</span>' +
          '<span class="day">' + d.getDate() + '</span>' +
          '<span class="mon">' + d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() + '</span>' +
        '</div>' +
        '<div class="ec-body">' +
          '<div class="ec-title">' + esc(P.fmtTimeRange(ev.time, ev.endTime)) + '</div>' +
          '<div class="ec-loc">' + esc(ev.location) + '</div>' +
          '<div class="ec-meta"><span class="count">' + ev.filled + '/' + ev.cap + '</span>' +
            (ev.waitlist ? '<span class="pill wait">' + ev.waitlist + ' waitlist</span>' : '') + status + '</div>' +
        '</div>' +
        '<span class="chev" aria-hidden="true">›</span>' +
      '</a>'
    );
  }

  /* ---------- event editor ---------- */

  async function showEditor(id) {
    loading();
    let ev;
    let signups = [];
    try {
      if (id) {
        const r = await adminApi('adminGetEvent', { eventId: id });
        ev = r.event;
        signups = r.signups;
      } else {
        // New game: prefill from the most recent one.
        const r = await adminApi('adminListEvents');
        const last = r.events[0];
        const firstGym = P.locations()[0];
        ev = { date: '', time: last ? last.time : '19:00', endTime: last ? last.endTime || '' : '', location: last ? last.location : (firstGym ? firstGym.name : ''), cap: last ? last.cap : 15, notes: '', open: true };
      }
    } catch (e) {
      if (password) showError(e);
      return;
    }

    app.innerHTML =
      '<a class="back" href="#">← All games</a>' +
      '<h2>' + (id ? 'Edit game' : 'New game') + '</h2>' +
      '<form class="card" id="ev-form" novalidate>' +
        '<div class="form-grid">' +
          '<div><label for="f-date">Date</label><input id="f-date" type="date" name="date" required value="' + esc(ev.date) + '"></div>' +
          '<div><label for="f-time">Start time</label><input id="f-time" type="time" name="time" required value="' + esc(ev.time) + '"></div>' +
          '<div><label for="f-end">End time (optional)</label><input id="f-end" type="time" name="endTime" value="' + esc(ev.endTime || '') + '"></div>' +
          '<div><label for="f-cap">Roster size</label><input id="f-cap" type="number" name="cap" min="1" max="200" inputmode="numeric" value="' + esc(ev.cap) + '"></div>' +
          '<div class="full">' + locationField(ev.location) + '</div>' +
          '<div class="full"><label class="check"><input type="checkbox" name="open"' + (ev.open ? ' checked' : '') + '><span>Signups open</span></label></div>' +
          '<div class="full"><label for="f-notes">Notes (optional)</label><textarea id="f-notes" name="notes" maxlength="500" placeholder="e.g. Bring a white and a dark shirt">' + esc(ev.notes) + '</textarea></div>' +
        '</div>' +
        '<button class="btn primary block" type="submit">' + (id ? 'Save changes' : 'Create game') + '</button>' +
      '</form>' +
      (id
        ? '<div class="btn-row">' +
            '<button class="btn" id="copy-link">Copy player link</button>' +
            '<button class="btn" id="dup-this">Copy to +7 days</button>' +
            '<button class="btn danger" id="delete">Delete game</button>' +
          '</div>' +
          '<div id="players"></div>'
        : '');

    const form = document.getElementById('ev-form');
    const choice = field(form, 'loc-choice');
    choice.onchange = function () {
      const other = choice.value === OTHER;
      field(form, 'location').classList.toggle('hidden', !other);
      if (other) field(form, 'location').focus();
    };
    form.onsubmit = function (e) {
      e.preventDefault();
      const payload = {
        id: id || '',
        date: field(form, 'date').value,
        time: field(form, 'time').value,
        endTime: field(form, 'endTime').value,
        location: field(form, 'loc-choice').value === OTHER ? field(form, 'location').value : field(form, 'loc-choice').value,
        cap: field(form, 'cap').value || 15,
        notes: field(form, 'notes').value,
        open: field(form, 'open').checked,
      };
      P.busy(form.querySelector('button[type=submit]'), async function () {
        try {
          const r = await adminApi('adminSaveEvent', { event: payload });
          if (id) {
            P.toast('Saved.');
            refreshPlayers(id);
          } else {
            P.toast('Game created.');
            location.hash = '#event=' + encodeURIComponent(r.id);
          }
        } catch (err) { P.toast(err.message, true); }
      });
    };

    if (!id) return;

    document.getElementById('copy-link').onclick = async function () {
      const url = playerLink(id);
      try {
        await navigator.clipboard.writeText(url);
        P.toast('Player link copied.');
      } catch (e) {
        prompt('Copy this link:', url);
      }
    };
    document.getElementById('dup-this').onclick = function (e) {
      P.busy(e.currentTarget, async function () {
        try {
          const r = await adminApi('adminDuplicateEvent', { eventId: id });
          P.toast('Created game for ' + P.fmtDate(r.date));
          location.hash = '#event=' + encodeURIComponent(r.id);
        } catch (err) { P.toast(err.message, true); }
      });
    };
    document.getElementById('delete').onclick = function (e) {
      if (!confirm('Delete this game and its ' + signups.length + ' signup(s)? This can\'t be undone.')) return;
      P.busy(e.currentTarget, async function () {
        try {
          await adminApi('adminDeleteEvent', { eventId: id });
          P.toast('Game deleted.');
          location.hash = '';
        } catch (err) { P.toast(err.message, true); }
      });
    };

    renderPlayers(id, ev, signups);
  }

  const OTHER = '__other__';

  // Dropdown of gyms from config.js, plus "Other…" for a one-off place.
  function locationField(current) {
    const gyms = P.locations();
    const known = gyms.some(function (g) { return g.name === current; });
    const isOther = !!current && !known;
    return (
      '<label for="f-loc">Location</label>' +
      '<select id="f-loc" name="loc-choice">' +
        gyms.map(function (g) {
          return '<option value="' + esc(g.name) + '"' + (g.name === current ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }).join('') +
        '<option value="' + OTHER + '"' + (isOther || !gyms.length ? ' selected' : '') + '>Other…</option>' +
      '</select>' +
      '<input type="text" name="location" maxlength="80" placeholder="Type the location" aria-label="Other location"' +
        ' class="' + (isOther || !gyms.length ? '' : 'hidden') + '" value="' + esc(isOther ? current : '') + '" style="margin-top:8px">' +
      '<p class="hint">Add or change gyms in config.js (LOCATIONS).</p>'
    );
  }

  async function refreshPlayers(id) {
    try {
      const r = await adminApi('adminGetEvent', { eventId: id });
      renderPlayers(id, r.event, r.signups);
    } catch (e) {
      P.toast(e.message, true);
    }
  }

  function renderPlayers(id, ev, signups) {
    const box = document.getElementById('players');
    if (!box) return;
    const rows = signups.map(function (s, i) {
      const onRoster = i < ev.cap;
      return (
        (i === ev.cap ? '<li class="divider">Waitlist</li>' : '') +
        '<li class="adm-row" data-token="' + esc(s.token) + '">' +
          '<span class="n">' + (onRoster ? i + 1 : 'W' + (i - ev.cap + 1)) + '</span>' +
          '<div class="who"><b>' + esc(s.name) + '</b><small>' + (s.email ? esc(s.email) : '<i>no email</i>') + '</small>' +
            (s.at ? '<small>' + esc(s.at) + '</small>' : '') + '</div>' +
          '<div class="acts">' +
            '<button class="icon-btn" data-act="up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button class="icon-btn" data-act="down" aria-label="Move down"' + (i === signups.length - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button class="icon-btn" data-act="edit" aria-label="Edit">✎</button>' +
            '<button class="icon-btn del" data-act="remove" aria-label="Remove">✕</button>' +
          '</div>' +
        '</li>'
      );
    }).join('');

    box.innerHTML =
      '<h2>Players <span class="muted small">' + ev.filled + '/' + ev.cap +
        (ev.waitlist ? ' · ' + ev.waitlist + ' waitlisted' : '') + '</span></h2>' +
      '<form class="card" id="add-form" novalidate>' +
        '<div class="form-grid">' +
          '<div><label for="a-name">Name</label><input id="a-name" name="name" type="text" maxlength="60" required></div>' +
          '<div><label for="a-email">Email (optional)</label><input id="a-email" name="email" type="email" inputmode="email" maxlength="100"></div>' +
        '</div>' +
        '<p class="hint">Players with an email get confirmation emails (signed up, moved off/onto the waitlist, removed).</p>' +
        '<button class="btn block" type="submit">Add player to the end</button>' +
      '</form>' +
      '<ol class="names">' + (rows || '<li class="empty">No signups yet.</li>') + '</ol>';

    const add = document.getElementById('add-form');
    add.onsubmit = function (e) {
      e.preventDefault();
      const name = field(add, 'name').value.trim();
      if (!name) return P.toast('Enter a name.', true);
      P.busy(add.querySelector('button'), async function () {
        try {
          await adminApi('adminAddSignup', { eventId: id, name: name, email: field(add, 'email').value });
          P.toast(name + ' added.');
          refreshPlayers(id);
        } catch (err) { P.toast(err.message, true); }
      });
    };

    box.querySelectorAll('.adm-row').forEach(function (row) {
      const token = row.dataset.token;
      const s = signups.find(function (x) { return x.token === token; });
      row.querySelector('.acts').onclick = function (e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'edit') return editRow(row, id, s);
        if (act === 'remove' && !confirm('Remove ' + s.name + '?')) return;
        P.busy(btn, async function () {
          try {
            if (act === 'up' || act === 'down') {
              await adminApi('adminMoveSignup', { eventId: id, token: token, dir: act === 'up' ? -1 : 1 });
            } else if (act === 'remove') {
              await adminApi('adminRemoveSignup', { eventId: id, token: token });
              P.toast(s.name + ' removed.');
            }
            refreshPlayers(id);
          } catch (err) { P.toast(err.message, true); }
        });
      };
    });
  }

  function editRow(row, id, s) {
    row.innerHTML =
      '<form class="edit-row" novalidate>' +
        '<input name="name" type="text" maxlength="60" value="' + esc(s.name) + '" aria-label="Name">' +
        '<input name="email" type="email" maxlength="100" value="' + esc(s.email) + '" placeholder="Email (optional)" aria-label="Email">' +
        '<div class="btn-row" style="margin-top:0"><button class="btn sm primary" type="submit">Save</button>' +
        '<button class="btn sm" type="button" data-act="cancel">Cancel</button></div>' +
      '</form>';
    const form = row.querySelector('form');
    field(form, 'name').focus();
    form.querySelector('[data-act="cancel"]').onclick = function () { refreshPlayers(id); };
    form.onsubmit = function (e) {
      e.preventDefault();
      P.busy(form.querySelector('button[type=submit]'), async function () {
        try {
          await adminApi('adminUpdateSignup', { eventId: id, token: s.token, name: field(form, 'name').value, email: field(form, 'email').value });
          P.toast('Saved.');
          refreshPlayers(id);
        } catch (err) { P.toast(err.message, true); }
      });
    };
  }

  route();
})();
