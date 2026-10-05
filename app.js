// Player page: list of upcoming games, signup, edit/drop, stats.
(function () {
  const P = window.Pickup;
  const esc = P.esc;
  const app = document.getElementById('app');
  const SITE = (window.APP_CONFIG && window.APP_CONFIG.SITE_NAME) || 'Pickup';
  const TOKENS_KEY = 'pickup.tokens'; // { eventId: [token, ...] }
  const ME_KEY = 'pickup.me';         // { name, email } to prefill the form and load stats

  const BADGES = [
    { icon: '🏀', name: 'Rookie', games: 1 },
    { icon: '⭐', name: 'Regular', games: 10 },
    { icon: '🏅', name: 'Veteran', games: 25 },
    { icon: '👑', name: 'Legend', games: 50 },
    { icon: '🔥', name: 'On Fire', hint: '3 games in a row', test: function (s) { return s.bestStreak >= 3; } },
    { icon: '💪', name: 'Iron Man', hint: '10 games in a row', test: function (s) { return s.bestStreak >= 10; } },
    { icon: '🐦', name: 'Early Bird', hint: 'First to sign up', test: function (s) { return s.earlyBirds >= 1; } },
  ];

  let renderSeq = 0;

  function field(form, name) { return form.querySelector('[name="' + name + '"]'); }

  P.applyBranding();

  /* ---------- local memory ---------- */

  function tokensFor(eventId) {
    const v = (P.store.get(TOKENS_KEY, {}) || {})[eventId];
    return Array.isArray(v) ? v : (v ? [v] : []);
  }
  function setTokens(eventId, list) {
    const all = P.store.get(TOKENS_KEY, {}) || {};
    if (list.length) all[eventId] = list; else delete all[eventId];
    P.store.set(TOKENS_KEY, all);
  }
  function addToken(eventId, token) {
    const list = tokensFor(eventId).filter(function (t) { return t !== token; });
    list.push(token);
    setTokens(eventId, list);
  }
  function removeToken(eventId, token) {
    setTokens(eventId, tokensFor(eventId).filter(function (t) { return t !== token; }));
  }
  function me() { return P.store.get(ME_KEY, {}) || {}; }
  function setMe(patch) { P.store.set(ME_KEY, Object.assign(me(), patch)); }

  /* ---------- routing ---------- */

  function eventIdFromUrl() { return new URLSearchParams(location.search).get('event'); }

  function route(silent) {
    const id = eventIdFromUrl();
    if (id) showEvent(id, silent); else showHome(silent);
  }

  function go(url) {
    history.pushState(null, '', url);
    window.scrollTo(0, 0);
    route();
  }

  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });
  window.addEventListener('popstate', function () { route(); });

  // Refresh when the player comes back to the tab (e.g. from the group chat), unless they're mid-typing.
  document.addEventListener('input', function (e) { if (e.target.form) e.target.form.dataset.dirty = '1'; });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !app.querySelector('form[data-dirty]')) route(true);
  });

  function loading() { app.innerHTML = '<div class="loading">Loading…</div>'; }

  function showError(err) {
    app.innerHTML =
      '<div class="error-box">' + esc(err.message) + '</div>' +
      '<div class="btn-row"><button class="btn" id="retry">Try again</button>' +
      (eventIdFromUrl() ? '<a class="btn" href="./" data-nav>All games</a>' : '') + '</div>';
    document.getElementById('retry').onclick = function () { route(); };
  }

  /* ---------- home ---------- */

  async function showHome(silent) {
    const seq = ++renderSeq;
    document.title = SITE;
    if (!silent) loading();
    let data;
    try {
      data = await P.api('listEvents');
    } catch (e) {
      if (seq === renderSeq) showError(e);
      return;
    }
    if (seq !== renderSeq) return;

    app.innerHTML =
      '<h2>Upcoming games</h2>' +
      (data.events.length
        ? data.events.map(eventCard).join('')
        : '<div class="card muted">No games scheduled yet. Check back soon!</div>') +
      '<h2>Your stats</h2><div class="card" id="stats-box"></div>' +
      leadersHtml(data.leaders);
    renderStatsBox();
  }

  function eventCard(ev) {
    const d = P.toDate(ev.date);
    const pct = Math.min(100, Math.round((ev.filled / ev.cap) * 100));
    const mine = tokensFor(ev.id).length > 0;
    return (
      '<a class="card event-card" data-nav href="?event=' + encodeURIComponent(ev.id) + '">' +
        '<div class="date-badge">' +
          '<span class="dow">' + d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() + '</span>' +
          '<span class="day">' + d.getDate() + '</span>' +
          '<span class="mon">' + d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() + '</span>' +
        '</div>' +
        '<div class="ec-body">' +
          '<div class="ec-title">' + esc(P.fmtTime(ev.time)) + '</div>' +
          '<div class="ec-loc">' + esc(ev.location) + '</div>' +
          '<div class="meter' + (ev.filled >= ev.cap ? ' full' : '') + '"><span style="width:' + pct + '%"></span></div>' +
          '<div class="ec-meta">' +
            '<span><span class="count">' + ev.filled + '/' + ev.cap + '</span> in</span>' +
            (ev.waitlist ? '<span class="pill wait">' + ev.waitlist + ' waitlist</span>' : '') +
            (!ev.open ? '<span class="pill closed">Closed</span>' : '') +
            (mine ? '<span class="pill me">✓ Signed up</span>' : '') +
          '</div>' +
        '</div>' +
        '<span class="chev" aria-hidden="true">›</span>' +
      '</a>'
    );
  }

  function leadersHtml(leaders) {
    if (!leaders || !leaders.length) return '';
    return (
      '<h2>🏆 Regulars</h2>' +
      '<ol class="names leaders">' +
      leaders.map(function (p, i) {
        return '<li><span class="n">' + (i + 1) + '</span><span>' + esc(p.name) + '</span>' +
          '<span class="g">' + p.games + ' game' + (p.games === 1 ? '' : 's') + '</span>' +
          '<span class="s">' + (p.streak >= 2 ? '🔥' + p.streak : '') + '</span></li>';
      }).join('') +
      '</ol><p class="hint">Games played on the roster. 🔥 = current streak.</p>'
    );
  }

  /* ---------- stats ---------- */

  function renderStatsBox() {
    const box = document.getElementById('stats-box');
    if (!box) return;
    const email = me().email;
    if (!email) {
      box.innerHTML =
        '<form id="stats-form">' +
          '<label for="st-email">See your games, streaks and badges</label>' +
          '<input id="st-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required>' +
          '<button class="btn primary block" type="submit">Show my stats</button>' +
        '</form>';
      document.getElementById('stats-form').onsubmit = function (e) {
        e.preventDefault();
        const val = field(e.target, 'email').value.trim();
        if (!val) return;
        setMe({ email: val.toLowerCase() });
        renderStatsBox();
      };
      return;
    }
    box.innerHTML = '<div class="muted small">Loading your stats…</div>';
    P.api('stats', { email: email }).then(function (r) {
      box.innerHTML =
        (r.stats.name ? '<div><b>' + esc(r.stats.name) + '</b></div>' : '') +
        statsHtml(r.stats) +
        '<button class="linkish small" id="not-me">Not you? Use a different email</button>';
      document.getElementById('not-me').onclick = function () { setMe({ email: '' }); renderStatsBox(); };
    }).catch(function (e) {
      box.innerHTML = '<div class="error-box small">' + esc(e.message) + '</div>' +
        '<button class="linkish small" id="not-me">Use a different email</button>';
      document.getElementById('not-me').onclick = function () { setMe({ email: '' }); renderStatsBox(); };
    });
  }

  function statsHtml(s) {
    const earned = BADGES.filter(function (b) { return b.test ? b.test(s) : s.games >= b.games; });
    const next = BADGES.find(function (b) { return b.games && s.games < b.games; });
    return (
      '<div class="stats-grid">' +
        '<div class="stat"><b>' + s.games + '</b><span>Games</span></div>' +
        '<div class="stat"><b>' + (s.streak ? '🔥' + s.streak : '0') + '</b><span>Streak</span></div>' +
        '<div class="stat"><b>' + s.bestStreak + '</b><span>Best</span></div>' +
        '<div class="stat"><b>' + s.earlyBirds + '</b><span>First in</span></div>' +
      '</div>' +
      '<div class="badges">' +
        BADGES.map(function (b) {
          const has = earned.indexOf(b) >= 0;
          const title = b.hint || (b.games + ' game' + (b.games === 1 ? '' : 's'));
          return '<span class="badge' + (has ? '' : ' locked') + '" title="' + esc(title) + '">' + b.icon + ' ' + b.name + '</span>';
        }).join('') +
      '</div>' +
      (next
        ? '<div class="next-goal">' + (next.games - s.games) + ' more game' + (next.games - s.games === 1 ? '' : 's') +
          ' to ' + next.icon + ' ' + next.name + '</div>'
        : '')
    );
  }

  /* ---------- event page ---------- */

  async function showEvent(id, silent) {
    const seq = ++renderSeq;
    if (!silent) loading();
    const tokens = tokensFor(id);
    let data;
    try {
      data = await P.api('getEvent', { eventId: id, tokens: tokens });
    } catch (e) {
      if (seq === renderSeq) showError(e);
      return;
    }
    if (seq !== renderSeq) return;
    // Forget signups that were dropped or removed by the admin.
    const live = data.mine.map(function (m) { return m.token; });
    if (tokens.some(function (t) { return live.indexOf(t) < 0; })) setTokens(id, live);
    renderEvent(data);
  }

  function renderEvent(data) {
    const ev = data.event;
    const mine = data.mine;
    document.title = P.fmtDate(ev.date) + ' · ' + SITE;

    const pill = ev.past ? '<span class="pill past">Finished</span>'
      : !ev.open ? '<span class="pill closed">Signups closed</span>'
      : ev.filled >= ev.cap ? '<span class="pill wait">Full · waitlist open</span>'
      : '<span class="pill">' + (ev.cap - ev.filled) + ' spot' + (ev.cap - ev.filled === 1 ? '' : 's') + ' left</span>';

    let html =
      '<a class="back" href="./" data-nav>← All games</a>' +
      '<div class="card event-head">' +
        '<h2>' + esc(P.fmtDate(ev.date, { weekday: 'long', month: 'long', day: 'numeric' })) + '</h2>' +
        '<div class="when">' + esc(P.fmtTime(ev.time)) + '</div>' +
        '<div class="where">📍 <a href="https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(ev.location) + '" target="_blank" rel="noopener">' + esc(ev.location) + '</a></div>' +
        (ev.notes ? '<div class="notes">' + esc(ev.notes) + '</div>' : '') +
        '<div class="row">' + pill + '<button class="btn sm" id="share-btn">Share link</button></div>' +
      '</div>';

    if (ev.past) html += '<div class="banner">This game already happened. Here\'s the final list.</div>';

    mine.forEach(function (m) { html += meCard(ev, m, mine.length); });

    if (!ev.past) {
      if (!ev.open) {
        if (!mine.length) html += '<div class="banner">Signups are closed for this game.</div>';
      } else if (!mine.length) {
        html += signupForm(ev, false);
      } else if (mine.length < 2) {
        html += '<details class="find"><summary>+ Sign up a family member</summary>' + signupForm(ev, true) + '</details>';
      }
      if (!mine.length) html += findSpotHtml();
    }

    if (mine.length) html += '<div class="card" id="my-stats"><div class="muted small">Loading your stats…</div></div>';

    html += listsHtml(ev, data, mine);
    app.innerHTML = html;
    wireEvent(ev, mine);
  }

  function meCard(ev, m, count) {
    const title = count > 1 ? esc(m.name) + ' – #' + m.position : 'You\'re signed up – #' + m.position;
    const sub = m.onRoster
      ? 'On the roster as <b>' + esc(m.name) + '</b> ✅'
      : '#' + m.waitlistPosition + ' on the waitlist as <b>' + esc(m.name) +
        '</b>. You\'ll move up automatically if someone drops.';
    return (
      '<div class="card me-card' + (m.onRoster ? '' : ' waitlisted') + '" data-token="' + esc(m.token) + '">' +
        '<div class="big">' + title + '</div>' +
        '<div class="small">' + sub + '</div>' +
        (ev.past ? '' :
          '<div class="btn-row">' +
            '<button class="btn" data-act="edit">Edit name</button>' +
            '<button class="btn danger" data-act="drop">Drop out</button>' +
          '</div>' +
          '<form class="hidden" data-act="rename-form">' +
            '<label>New name</label>' +
            '<input name="name" type="text" maxlength="40" autocomplete="name" value="' + esc(m.name) + '" required>' +
            '<div class="btn-row"><button class="btn primary" type="submit">Save</button>' +
            '<button class="btn" type="button" data-act="cancel">Cancel</button></div>' +
          '</form>') +
      '</div>'
    );
  }

  function signupForm(ev, family) {
    const m = me();
    const full = ev.filled >= ev.cap;
    return (
      '<form class="card" data-act="signup"' + (family ? ' data-family="1"' : '') + ' novalidate>' +
        '<label for="su-name' + (family ? '-f' : '') + '">' + (family ? 'Their name' : 'Your name') + '</label>' +
        '<input id="su-name' + (family ? '-f' : '') + '" name="name" type="text" maxlength="40" autocomplete="' + (family ? 'off' : 'name') + '" required value="' + (family ? '' : esc(m.name || '')) + '">' +
        '<label for="su-email' + (family ? '-f' : '') + '">' + (family ? 'Your email' : 'Email') + '</label>' +
        '<input id="su-email' + (family ? '-f' : '') + '" name="email" type="email" inputmode="email" autocomplete="email" maxlength="100" required value="' + esc(m.email || '') + '">' +
        '<p class="hint">Only used to edit your spot and track your stats. Never shown to other players.</p>' +
        (family ? '' :
          '<label class="check"><input type="checkbox" name="family"><span>I\'m signing up a family member (e.g. my kid) with my email</span></label>') +
        '<button class="btn primary block" type="submit">' + (full ? 'Join the waitlist' : (family ? 'Sign them up' : 'Sign me up')) + '</button>' +
        (full ? '<p class="hint">The roster is full. You\'ll move up automatically if someone drops.</p>' : '') +
      '</form>'
    );
  }

  function findSpotHtml() {
    return (
      '<details class="find"><summary>Already signed up on another phone?</summary>' +
        '<form class="card" data-act="find" novalidate>' +
          '<label for="fs-name">Name you signed up with</label>' +
          '<input id="fs-name" name="name" type="text" maxlength="40" autocomplete="name" required value="' + esc(me().name || '') + '">' +
          '<label for="fs-email">Email</label>' +
          '<input id="fs-email" name="email" type="email" inputmode="email" autocomplete="email" required value="' + esc(me().email || '') + '">' +
          '<button class="btn block" type="submit">Find my spot</button>' +
        '</form>' +
      '</details>'
    );
  }

  function listsHtml(ev, data, mine) {
    const myNames = mine.map(function (m) { return m.name.toLowerCase(); });
    const item = function (p, i) {
      const isMe = myNames.indexOf(p.name.toLowerCase()) >= 0;
      return '<li' + (isMe ? ' class="is-me"' : '') + '><span class="n">' + (i + 1) + '</span><span>' + esc(p.name) + (isMe ? ' (you)' : '') + '</span></li>';
    };
    let html =
      '<section class="list-section"><h3>Roster <span class="count">' + ev.filled + '/' + ev.cap + '</span></h3>' +
      '<ol class="names">' +
      (data.roster.length ? data.roster.map(item).join('') : '<li class="empty">No one yet. Be the first!</li>') +
      '</ol></section>';
    if (data.waitlist.length) {
      html += '<section class="list-section"><h3>Waitlist <span class="count">' + data.waitlist.length + '</span></h3>' +
        '<ol class="names wait">' + data.waitlist.map(item).join('') + '</ol></section>';
    }
    return html;
  }

  function wireEvent(ev, mine) {
    document.getElementById('share-btn').onclick = function () { share(ev); };

    app.querySelectorAll('form[data-act="signup"]').forEach(function (form) {
      const family = form.dataset.family === '1';
      const box = form.querySelector('input[name="family"]');
      if (box) {
        box.onchange = function () {
          // Signing up someone else: don't leave your own name in the box.
          if (box.checked && field(form, 'name').value.trim() === (me().name || '')) field(form, 'name').value = '';
          else if (!box.checked && !field(form, 'name').value.trim()) field(form, 'name').value = me().name || '';
          field(form, 'name').focus();
        };
      }
      form.onsubmit = function (e) {
        e.preventDefault();
        const isFamily = family || (box && box.checked);
        const name = field(form, 'name').value.trim();
        const email = field(form, 'email').value.trim();
        if (!name) return P.toast('Enter a name.', true);
        if (!email) return P.toast('Enter your email.', true);
        P.busy(form.querySelector('button[type=submit]'), async function () {
          try {
            const r = await P.api('signup', { eventId: ev.id, name: name, email: email, family: !!isFamily });
            addToken(ev.id, r.token);
            setMe(isFamily ? { email: email.toLowerCase() } : { name: name, email: email.toLowerCase() });
            P.toast(r.onRoster
              ? (isFamily ? name + ' is in' : 'You\'re in') + '! #' + r.position + ' on the roster.'
              : 'Roster\'s full. Waitlist #' + (r.position - ev.cap) + '.');
            showEvent(ev.id, true);
          } catch (err) {
            P.toast(err.message, true);
          }
        });
      };
    });

    const find = app.querySelector('form[data-act="find"]');
    if (find) {
      find.onsubmit = function (e) {
        e.preventDefault();
        P.busy(find.querySelector('button[type=submit]'), async function () {
          try {
            const r = await P.api('findSpot', { eventId: ev.id, name: field(find, 'name').value, email: field(find, 'email').value });
            addToken(ev.id, r.token);
            setMe({ name: field(find, 'name').value.trim(), email: field(find, 'email').value.trim().toLowerCase() });
            P.toast('Found you!');
            showEvent(ev.id, true);
          } catch (err) {
            P.toast(err.message, true);
          }
        });
      };
    }

    app.querySelectorAll('.me-card').forEach(function (card) {
      const token = card.dataset.token;
      const m = mine.find(function (x) { return x.token === token; });
      const form = card.querySelector('form[data-act="rename-form"]');
      const buttons = card.querySelector('.btn-row');
      if (!form) return;
      card.querySelector('[data-act="edit"]').onclick = function () {
        buttons.classList.add('hidden');
        form.classList.remove('hidden');
        field(form, 'name').focus();
      };
      card.querySelector('[data-act="cancel"]').onclick = function () {
        form.classList.add('hidden');
        buttons.classList.remove('hidden');
        delete form.dataset.dirty;
      };
      form.onsubmit = function (e) {
        e.preventDefault();
        const name = field(form, 'name').value.trim();
        if (!name) return P.toast('Enter a name.', true);
        P.busy(form.querySelector('button[type=submit]'), async function () {
          try {
            await P.api('rename', { eventId: ev.id, token: token, name: name });
            if ((me().name || '').toLowerCase() === m.name.toLowerCase()) setMe({ name: name });
            P.toast('Name updated.');
            showEvent(ev.id, true);
          } catch (err) {
            P.toast(err.message, true);
          }
        });
      };
      card.querySelector('[data-act="drop"]').onclick = function (e) {
        if (!confirm('Drop ' + m.name + ' from this game?' + (m.onRoster ? ' The next person on the waitlist will take the spot.' : ''))) return;
        P.busy(e.currentTarget, async function () {
          try {
            await P.api('drop', { eventId: ev.id, token: token });
            removeToken(ev.id, token);
            P.toast(m.name + ' dropped. Thanks for freeing up the spot!');
            showEvent(ev.id, true);
          } catch (err) {
            P.toast(err.message, true);
          }
        });
      };
    });

    const statsBox = document.getElementById('my-stats');
    if (statsBox) {
      const req = me().email ? { email: me().email } : { token: mine[0].token };
      P.api('stats', req).then(function (r) {
        statsBox.innerHTML = '<div><b>Your stats</b></div>' + statsHtml(r.stats);
      }).catch(function () { statsBox.remove(); });
    }
  }

  async function share(ev) {
    const url = location.origin + location.pathname + '?event=' + encodeURIComponent(ev.id);
    const text = 'Hoops ' + P.fmtDate(ev.date) + ' ' + P.fmtTime(ev.time) + ' @ ' + ev.location + '. Sign up:';
    if (navigator.share) {
      try { await navigator.share({ title: SITE, text: text, url: url }); } catch (e) { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
      P.toast('Link copied. Paste it in the group chat!');
    } catch (e) {
      prompt('Copy this link:', url);
    }
  }

  route();
})();
