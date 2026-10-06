// Player page: list of upcoming games, signup, edit/drop, stats.
(function () {
  const P = window.Pickup;
  const esc = P.esc;
  const t = P.t;
  const tn = P.tn;
  const app = document.getElementById('app');
  const SITE = (window.APP_CONFIG && window.APP_CONFIG.SITE_NAME) || 'Pickup';
  const TOKENS_KEY = 'pickup.tokens'; // { eventId: [token, ...] }
  const ME_KEY = 'pickup.me';         // { name, email } to prefill the form and load stats

  // Levels by games played; a player shows only their current level.
  const LEVELS = [
    { icon: '🏀', name: t('badgeRookie'), games: 1 },    // 1–5
    { icon: '⭐', name: t('badgeRegular'), games: 6 },   // 6–15
    { icon: '🏅', name: t('badgeVeteran'), games: 16 },  // 16–49
    { icon: '👑', name: t('badgeLegend'), games: 50 },   // 50+
  ];
  // Extra badges; only shown once earned.
  const BADGES = [
    { icon: '🔥', name: t('badgeOnFire'), hint: t('hintInARow', { n: 3 }), test: function (s) { return s.streak >= 3; } },
    { icon: '💪', name: t('badgeIronMan'), hint: t('hintLast10'), test: function (s) { return (s.last10 || 0) >= 8; } },
    { icon: '🐦', name: t('badgeEarlyBird'), hint: t('hintEarly'), test: function (s) { return (s.early || 0) > (s.late || 0); } },
    { icon: '🚨', name: t('badgeBuzzer'), hint: t('hintLate'), test: function (s) { return (s.late || 0) > (s.early || 0); } },
  ];

  let renderSeq = 0;
  let statsReq = null; // { email, promise }: one stats request per page view, shared by everything that needs it

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

  function loading() {
    app.innerHTML = '<div class="skeleton sk-title"></div>' +
      '<div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>' +
      '<span class="visually-hidden">' + t('loading') + '</span>';
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function getStats(email) {
    if (!statsReq || statsReq.email !== email) {
      statsReq = { email: email, promise: P.api('stats', { email: email }) };
      statsReq.promise.then(function (r) { P.cache.set('stats.' + email, r.stats); }).catch(function () {});
    }
    return statsReq.promise;
  }

  function showError(err) {
    app.innerHTML =
      '<div class="error-box">' + esc(err.message) + '</div>' +
      '<div class="btn-row"><button class="btn" id="retry">' + t('tryAgain') + '</button>' +
      (eventIdFromUrl() ? '<a class="btn" href="./" data-nav>' + t('allGames') + '</a>' : '') + '</div>';
    document.getElementById('retry').onclick = function () { route(); };
  }

  /* ---------- home ---------- */

  async function showHome(silent) {
    const seq = ++renderSeq;
    document.title = SITE;
    statsReq = null;
    // Paint the last-seen list right away; the fresh one replaces it when it arrives.
    const cached = silent ? null : P.cache.get('home');
    if (cached) renderHome(cached); else if (!silent) loading();
    if (me().email) getStats(me().email); // fetch in parallel with the list
    let data;
    try {
      data = await P.api('listEvents');
    } catch (e) {
      if (seq === renderSeq && !cached) showError(e);
      return;
    }
    if (seq !== renderSeq) return;
    P.cache.set('home', data);
    if (cached && same(cached, data)) return;
    if (cached && app.querySelector('form[data-dirty]')) return; // don't wipe what they're typing
    renderHome(data);
  }

  function renderHome(data) {
    app.innerHTML =
      '<h2>' + t('upcoming') + '</h2>' +
      (data.events.length
        ? data.events.map(eventCard).join('')
        : '<div class="card muted">' + t('noGames') + '</div>') +
      '<div id="install-slot"></div>' +
      '<h2>' + t('yourProfile') + '</h2><div class="card" id="stats-box"></div>' +
      pastHtml(data.past) +
      leadersHtml(data.leaders);
    renderStatsBox();
    renderInstall();
  }

  function pastHtml(past) {
    if (!past || !past.length) return '';
    return '<h2>' + t('pastGames') + '</h2>' + past.map(eventCard).join('');
  }

  // The server changes the choice for whoever owns a signup, so use any signup this phone remembers.
  async function setNotifyAnywhere(want) {
    const all = P.store.get(TOKENS_KEY, {}) || {};
    const pairs = [];
    Object.keys(all).forEach(function (eventId) {
      [].concat(all[eventId] || []).forEach(function (token) { pairs.push([eventId, token]); });
    });
    if (!pairs.length) throw new Error(t('notifyNeedsSignup'));
    let lastErr;
    for (let i = pairs.length - 1; i >= 0; i--) { // newest signups last, so try them first
      try {
        await P.api('setNotify', { eventId: pairs[i][0], token: pairs[i][1], notify: want });
        setMe({ notify: want });
        return;
      } catch (err) {
        lastErr = err; // that game may have been deleted; try another
      }
    }
    throw lastErr;
  }

  /* ---------- install card ---------- */

  const INSTALL_KEY = 'pickup.installDismissed';
  P.install.onChange(renderInstall);

  function renderInstall() {
    const slot = document.getElementById('install-slot');
    if (!slot) return;
    const mode = P.install.mode();
    if (!mode || P.store.get(INSTALL_KEY, false)) { slot.innerHTML = ''; return; }
    slot.innerHTML =
      '<div class="card install-card">' +
        '<img src="icons/icon-192.png" alt="" width="48" height="48">' +
        '<div class="install-body"><b>' + t('installTitle') + '</b>' +
          '<div class="small">' + (mode === 'ios' ? t('installIos') : esc(t('installText'))) + '</div>' +
          '<div class="btn-row">' +
            (mode === 'prompt' ? '<button class="btn primary sm" id="install-go">' + esc(t('installBtn')) + '</button>' : '') +
            '<button class="btn sm" id="install-later">' + esc(t('installLater')) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    const go = document.getElementById('install-go');
    if (go) go.onclick = function () { P.install.run().then(renderInstall); };
    document.getElementById('install-later').onclick = function () {
      P.store.set(INSTALL_KEY, true);
      renderInstall();
    };
  }

  function eventCard(ev) {
    const d = P.toDate(ev.date);
    const pct = Math.min(100, Math.round((ev.filled / ev.cap) * 100));
    const mine = tokensFor(ev.id).length > 0;
    return (
      '<a class="card event-card' + (ev.past ? ' past-card' : '') + '" data-nav href="?event=' + encodeURIComponent(ev.id) + '">' +
        '<div class="date-badge">' +
          '<span class="dow">' + d.toLocaleDateString(P.locale(), { weekday: 'short' }).replace('.', '').toUpperCase() + '</span>' +
          '<span class="day">' + d.getDate() + '</span>' +
          '<span class="mon">' + d.toLocaleDateString(P.locale(), { month: 'short' }).replace('.', '').toUpperCase() + '</span>' +
        '</div>' +
        '<div class="ec-body">' +
          '<div class="ec-title">' + esc(P.fmtTimeRange(ev.time, ev.endTime)) + '</div>' +
          '<div class="ec-loc">' + esc(ev.location) + '</div>' +
          (ev.past ? '' : '<div class="meter' + (ev.filled >= ev.cap ? ' full' : '') + '"><span style="width:' + pct + '%"></span></div>') +
          '<div class="ec-meta">' +
            (ev.past
              ? '<span><span class="count">' + ev.filled + '</span> ' + t('playedCount') + '</span>'
              : '<span><span class="count">' + ev.filled + '/' + ev.cap + '</span> ' + t('inCount') + '</span>' +
                (ev.waitlist ? '<span class="pill wait">' + t('waitlistCount', { n: ev.waitlist }) + '</span>' : '') +
                (!ev.open ? '<span class="pill closed">' + t('closed') + '</span>' : '')) +
            (mine ? '<span class="pill me">' + (ev.past ? t('youPlayedPill') : t('signedUpPill')) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<span class="chev" aria-hidden="true">›</span>' +
      '</a>'
    );
  }

  function leadersHtml(leaders) {
    if (!leaders || !leaders.length) return '';
    return (
      '<h2>' + t('regulars') + '</h2>' +
      '<ol class="names leaders">' +
      leaders.map(function (p, i) {
        return '<li><span class="n">' + (i + 1) + '</span><span>' + esc(p.name) + '</span>' +
          '<span class="g">' + tn('game', p.games) + '</span>' +
          '<span class="s">' + (p.streak >= 2 ? '🔥' + p.streak : '') + '</span></li>';
      }).join('') +
      '</ol><p class="hint">' + t('leadersHint') + '</p>'
    );
  }

  /* ---------- stats ---------- */

  // Profile card: who this phone is signed up as, email updates on/off, then stats and badges.
  function renderStatsBox() {
    const box = document.getElementById('stats-box');
    if (!box) return;
    const m = me();
    if (!m.email) {
      box.innerHTML =
        '<p class="small muted" style="margin-top:0">👤 ' + t('accountNone') + '</p>' +
        '<form id="stats-form">' +
          '<label for="st-email">' + t('statsPrompt') + '</label>' +
          '<input id="st-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required>' +
          '<button class="btn primary block" type="submit">' + t('showStats') + '</button>' +
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
    const on = m.notify !== false; // everyone gets emails unless they opted out
    const head = function (name) {
      return (
        '<div class="account-who">👤 <b>' + esc(m.name || name || '') + '</b> <span class="muted small">' + esc(m.email) + '</span></div>' +
        '<div class="notify-line small">' + (on ? t('notifyOn') : t('notifyOff')) +
          ' · <button class="linkish small" data-act="notify">' + (on ? t('turnOff') : t('turnOn')) + '</button>' +
          ' · <button class="linkish small" data-act="switch">' + t('notYouShort') + '</button>' +
        '</div>'
      );
    };
    const wire = function () {
      box.querySelector('[data-act="notify"]').onclick = function (e) {
        P.busy(e.currentTarget, async function () {
          try {
            await setNotifyAnywhere(!on);
            P.toast(!on ? t('notifyOnAll') : t('notifyOffAll'));
          } catch (err) {
            P.toast(err.message, true);
          }
          renderStatsBox();
        });
      };
      box.querySelector('[data-act="switch"]').onclick = function () {
        setMe({ name: '', email: '', notify: undefined });
        renderStatsBox();
      };
    };
    const paint = function (stats, note) {
      box.innerHTML = head(stats && stats.name) + (stats ? statsHtml(stats) : note || '');
      wire();
    };
    const cachedStats = P.cache.get('stats.' + m.email);
    paint(cachedStats, '<div class="muted small" style="margin-top:10px">' + t('loadingStats') + '</div>');
    getStats(m.email).then(function (r) {
      if (box.isConnected && !same(cachedStats, r.stats)) paint(r.stats);
    }).catch(function (e) {
      if (box.isConnected && !cachedStats) paint(null, '<div class="error-box small" style="margin-top:10px">' + esc(e.message) + '</div>');
    });
  }

  function statsHtml(s) {
    const level = LEVELS.filter(function (l) { return s.games >= l.games; }).pop();
    const next = LEVELS.find(function (l) { return s.games < l.games; });
    const earned = (level ? [Object.assign({ hint: tn('game', s.games) }, level)] : [])
      .concat(BADGES.filter(function (b) { return b.test(s); }));
    return (
      '<div class="stats-grid">' +
        '<div class="stat"><b>' + s.games + '</b><span>' + t('statGames') + '</span></div>' +
        '<div class="stat"><b>' + (s.streak ? '🔥' + s.streak : '0') + '</b><span>' + t('statStreak') + '</span></div>' +
        '<div class="stat"><b>' + s.bestStreak + '</b><span>' + t('statBest') + '</span></div>' +
        '<div class="stat"><b>' + s.earlyBirds + '</b><span>' + t('statFirst') + '</span></div>' +
      '</div>' +
      (earned.length
        ? '<div class="badges">' +
          earned.map(function (b) {
            return '<span class="badge" title="' + esc(b.hint) + '">' + b.icon + ' ' + b.name + '</span>';
          }).join('') +
          '</div>'
        : '') +
      (next
        ? '<div class="next-goal">' + esc(tn('nextGoal', next.games - s.games, { badge: next.icon + ' ' + next.name })) + '</div>'
        : '')
    );
  }

  /* ---------- event page ---------- */

  // silent = refresh after an action or on returning to the tab: skip the cached paint.
  async function showEvent(id, silent) {
    const seq = ++renderSeq;
    statsReq = null;
    const tokens = tokensFor(id);
    const cacheKey = 'event.' + id;
    let cached = silent ? null : P.cache.get(cacheKey);
    if (cached && !same(cached.tokens, tokens)) cached = null; // signed up/dropped since: don't show a stale "you"
    if (cached) renderEvent(cached.data); else if (!silent) loading();
    if (me().email) getStats(me().email); // fetch in parallel with the game
    let data;
    try {
      data = await P.api('getEvent', { eventId: id, tokens: tokens });
    } catch (e) {
      if (seq === renderSeq && !cached) showError(e);
      return;
    }
    // Forget signups that were dropped or removed by the admin.
    const live = data.mine.map(function (m) { return m.token; });
    if (tokens.some(function (t) { return live.indexOf(t) < 0; })) setTokens(id, live);
    if (data.mine.length && typeof data.mine[0].notify === 'boolean') setMe({ notify: data.mine[0].notify });
    P.cache.set(cacheKey, { tokens: tokensFor(id), data: data });
    if (seq !== renderSeq) return;
    if (cached && same(cached.data, data)) return;
    if (cached && app.querySelector('form[data-dirty]')) return; // don't wipe what they're typing
    renderEvent(data);
  }

  // Show the result of an action immediately, before the server's fresh list comes back.
  let lastEvent = null;
  function applyLocal(fn) {
    if (!lastEvent) return;
    const d = JSON.parse(JSON.stringify(lastEvent));
    fn(d);
    const all = d.roster.concat(d.waitlist);
    const cap = d.event.cap;
    d.roster = all.slice(0, cap);
    d.waitlist = all.slice(cap);
    d.event.total = all.length;
    d.event.filled = Math.min(all.length, cap);
    d.event.waitlist = Math.max(0, all.length - cap);
    d.mine = d.mine.map(function (m) {
      const i = all.findIndex(function (p) { return p.name.toLowerCase() === m.name.toLowerCase(); });
      return Object.assign(m, { position: i + 1, onRoster: i < cap, waitlistPosition: i < cap ? 0 : i - cap + 1 });
    }).filter(function (m) { return m.position > 0; });
    P.cache.set('event.' + d.event.id, { tokens: tokensFor(d.event.id), data: d });
    renderEvent(d);
  }
  function withoutName(list, name) {
    return list.filter(function (p) { return p.name.toLowerCase() !== name.toLowerCase(); });
  }

  function renderEvent(data) {
    lastEvent = data;
    const ev = data.event;
    const mine = data.mine;
    document.title = P.fmtDate(ev.date) + ' · ' + SITE;

    const pill = ev.past ? '<span class="pill past">' + t('pillFinished') + '</span>'
      : !ev.open ? '<span class="pill closed">' + t('pillClosed') + '</span>'
      : ev.filled >= ev.cap ? '<span class="pill wait">' + t('pillFull') + '</span>'
      : '<span class="pill">' + tn('spotsLeft', ev.cap - ev.filled) + '</span>';

    let html =
      '<a class="back" href="./" data-nav>' + t('backAllGames') + '</a>' +
      '<div class="card event-head">' +
        '<h2>' + esc(P.fmtDate(ev.date, { weekday: 'long', month: 'long', day: 'numeric' })) + '</h2>' +
        '<div class="when">' + esc(P.fmtTimeRange(ev.time, ev.endTime)) + '</div>' +
        '<a class="where" href="' + esc(P.mapsUrl(ev.location)) + '" target="_blank" rel="noopener">' +
          '<span class="pin" aria-hidden="true">📍</span><span><span class="where-name">' + esc(ev.location) + '</span>' +
          (P.findLocation(ev.location) && P.findLocation(ev.location).address
            ? '<span class="where-addr">' + esc(P.findLocation(ev.location).address) + '</span>' : '') +
          '<span class="where-map">' + t('openMap') + ' ↗</span></span></a>' +
        (ev.notes ? '<div class="notes">' + esc(ev.notes) + '</div>' : '') +
        '<div class="row">' + pill + '<button class="btn sm" id="share-btn">' + t('share') + '</button></div>' +
      '</div>';

    if (ev.past) html += '<div class="banner">' + t('pastBanner') + '</div>';

    mine.forEach(function (m) { html += meCard(ev, m, mine.length); });

    if (!ev.past) {
      if (!ev.open) {
        if (!mine.length) html += '<div class="banner">' + t('closedBanner') + '</div>';
      } else if (!mine.length) {
        html += signupForm(ev, false);
      } else if (mine.length < 2) {
        html += '<details class="find"><summary>' + t('addFamily') + '</summary>' + signupForm(ev, true) + '</details>';
      }
      if (!mine.length) html += findSpotHtml();
    }


    html += listsHtml(ev, data, mine);
    if (mine.length) html += '<div class="card" id="my-stats" style="margin-top:16px"><div class="muted small">' + t('loadingStats') + '</div></div>';
    app.innerHTML = html;
    wireEvent(ev, mine);
  }

  function meCard(ev, m, count) {
    const title = count > 1 ? esc(m.name) + ' – #' + m.position : t('youreSignedUp', { n: m.position });
    const sub = m.onRoster
      ? t('onRosterAs', { name: esc(m.name) })
      : t('onWaitlistAs', { n: m.waitlistPosition, name: esc(m.name) });
    return (
      '<div class="card me-card' + (m.onRoster ? '' : ' waitlisted') + '" data-token="' + esc(m.token) + '">' +
        '<div class="big">' + title + '</div>' +
        '<div class="small">' + sub + '</div>' +
        (!ev.past && typeof m.notify === 'boolean'
          ? '<div class="notify-line small">' + (m.notify ? t('notifyOn') : t('notifyOff')) +
            ' · <button class="linkish small" data-act="notify">' + (m.notify ? t('turnOff') : t('turnOn')) + '</button></div>'
          : '') +
        (ev.past ? '' :
          '<div class="btn-row">' +
            '<button class="btn" data-act="edit">' + t('editName') + '</button>' +
            '<button class="btn danger" data-act="drop">' + t('dropOut') + '</button>' +
          '</div>' +
          '<form class="hidden" data-act="rename-form">' +
            '<label>' + t('newName') + '</label>' +
            '<input name="name" type="text" maxlength="40" autocomplete="name" value="' + esc(m.name) + '" required>' +
            '<div class="btn-row"><button class="btn primary" type="submit">' + t('save') + '</button>' +
            '<button class="btn" type="button" data-act="cancel">' + t('cancel') + '</button></div>' +
          '</form>') +
      '</div>'
    );
  }

  function signupForm(ev, family) {
    const m = me();
    const full = ev.filled >= ev.cap;
    return (
      '<form class="card" data-act="signup"' + (family ? ' data-family="1"' : '') + ' novalidate>' +
        '<label for="su-name' + (family ? '-f' : '') + '">' + (family ? t('theirName') : t('yourName')) + '</label>' +
        '<input id="su-name' + (family ? '-f' : '') + '" name="name" type="text" maxlength="40" autocomplete="' + (family ? 'off' : 'name') + '" required value="' + (family ? '' : esc(m.name || '')) + '">' +
        '<label for="su-email' + (family ? '-f' : '') + '">' + (family ? t('yourEmail') : t('email')) + '</label>' +
        '<p class="email-why">' + t('emailWhy') + '</p>' +
        '<input id="su-email' + (family ? '-f' : '') + '" name="email" type="email" inputmode="email" autocomplete="email" maxlength="100" required value="' + esc(m.email || '') + '">' +
        // Asked once; after that the choice is remembered and changed from the player's card.
        (!family && typeof m.notify !== 'boolean'
          ? '<label class="check notify-check"><input type="checkbox" name="notify" checked><span>' + t('notifyCheck') + '</span></label>'
          : '') +
        (family ? '' :
          '<label class="check"><input type="checkbox" name="family"><span>' + t('familyCheck') + '</span></label>') +
        '<button class="btn primary block" type="submit">' + (full ? t('joinWaitlist') : (family ? t('signThemUp') : t('signMeUp'))) + '</button>' +
        (full ? '<p class="hint">' + t('fullHint') + '</p>' : '') +
      '</form>'
    );
  }

  function findSpotHtml() {
    return (
      '<details class="find"><summary>' + t('otherPhone') + '</summary>' +
        '<form class="card" data-act="find" novalidate>' +
          '<label for="fs-name">' + t('nameSignedUpWith') + '</label>' +
          '<input id="fs-name" name="name" type="text" maxlength="40" autocomplete="name" required value="' + esc(me().name || '') + '">' +
          '<label for="fs-email">' + t('email') + '</label>' +
          '<input id="fs-email" name="email" type="email" inputmode="email" autocomplete="email" required value="' + esc(me().email || '') + '">' +
          '<button class="btn block" type="submit">' + t('findSpot') + '</button>' +
        '</form>' +
      '</details>'
    );
  }

  function listsHtml(ev, data, mine) {
    const myNames = mine.map(function (m) { return m.name.toLowerCase(); });
    const item = function (p, i) {
      const isMe = myNames.indexOf(p.name.toLowerCase()) >= 0;
      return '<li' + (isMe ? ' class="is-me"' : '') + '><span class="n">' + (i + 1) + '</span><span class="nm">' + esc(p.name) + (isMe ? ' ' + t('you') : '') + '</span></li>';
    };
    // Two columns, numbered down the left column first (1–8 | 9–15).
    const cols = function (list, cls) {
      const rows = Math.ceil(list.length / 2);
      return '<ol class="names cols' + (cls ? ' ' + cls : '') + '" style="grid-template-rows:repeat(' + rows + ',auto)">' +
        list.map(item).join('') + (list.length % 2 ? '<li class="filler" aria-hidden="true"></li>' : '') + '</ol>';
    };
    let html =
      '<section class="list-section"><h3>' + t('roster') + ' <span class="count">' + ev.filled + '/' + ev.cap + '</span></h3>' +
      (data.roster.length ? cols(data.roster) : '<ol class="names"><li class="empty">' + t('noOneYet') + '</li></ol>') +
      '</section>';
    if (data.waitlist.length) {
      html += '<section class="list-section"><h3>' + t('waitlist') + ' <span class="count">' + data.waitlist.length + '</span></h3>' +
        '<p class="wait-rule">⚠️ ' + esc(t('waitRule', { cap: ev.cap })) + '</p>' +
        cols(data.waitlist, 'wait') + '</section>';
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
        if (!name) return P.toast(t('enterName'), true);
        if (!email) return P.toast(t('enterEmail'), true);
        P.busy(form.querySelector('button[type=submit]'), async function () {
          try {
            const box = field(form, 'notify');
            const payload = { eventId: ev.id, name: name, email: email, family: !!isFamily, lang: P.lang() };
            if (box) payload.notify = box.checked;
            const r = await P.api('signup', payload);
            addToken(ev.id, r.token);
            const notify = typeof r.notify === 'boolean' ? r.notify : (box ? box.checked : true);
            setMe(isFamily ? { email: email.toLowerCase(), notify: notify } : { name: name, email: email.toLowerCase(), notify: notify });
            applyLocal(function (d) {
              d.waitlist.push({ name: name });
              d.mine.push({ token: r.token, name: name, notify: notify });
            });
            P.toast(r.onRoster
              ? (isFamily ? t('toastInThem', { name: name, n: r.position }) : t('toastInYou', { n: r.position }))
              : t('toastWait', { n: r.position - ev.cap }));
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
            P.toast(t('foundYou'));
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
        if (!name) return P.toast(t('enterName'), true);
        P.busy(form.querySelector('button[type=submit]'), async function () {
          try {
            await P.api('rename', { eventId: ev.id, token: token, name: name });
            if ((me().name || '').toLowerCase() === m.name.toLowerCase()) setMe({ name: name });
            applyLocal(function (d) {
              const swap = function (p) { return p.name.toLowerCase() === m.name.toLowerCase() ? { name: name } : p; };
              d.roster = d.roster.map(swap);
              d.waitlist = d.waitlist.map(swap);
              d.mine.forEach(function (x) { if (x.token === token) x.name = name; });
            });
            P.toast(t('nameUpdated'));
            showEvent(ev.id, true);
          } catch (err) {
            P.toast(err.message, true);
          }
        });
      };
      const notifyBtn = card.querySelector('[data-act="notify"]');
      if (notifyBtn) {
        notifyBtn.onclick = function (e) {
          const want = !m.notify;
          P.busy(e.currentTarget, async function () {
            try {
              await P.api('setNotify', { eventId: ev.id, token: token, notify: want });
              setMe({ notify: want });
              applyLocal(function (d) { d.mine.forEach(function (x) { x.notify = want; }); });
              P.toast(want ? t('notifyOnAll') : t('notifyOffAll'));
            } catch (err) {
              P.toast(err.message, true);
            }
          });
        };
      }
      card.querySelector('[data-act="drop"]').onclick = function (e) {
        if (!confirm(t('confirmDrop', { name: m.name }) + (m.onRoster ? t('confirmDropRoster') : ''))) return;
        P.busy(e.currentTarget, async function () {
          try {
            await P.api('drop', { eventId: ev.id, token: token });
            removeToken(ev.id, token);
            applyLocal(function (d) {
              d.roster = withoutName(d.roster, m.name);
              d.waitlist = withoutName(d.waitlist, m.name);
              d.mine = d.mine.filter(function (x) { return x.token !== token; });
            });
            P.toast(t('dropped', { name: m.name }));
            showEvent(ev.id, true);
          } catch (err) {
            P.toast(err.message, true);
          }
        });
      };
    });

    const statsBox = document.getElementById('my-stats');
    if (statsBox) {
      const email = me().email;
      const paint = function (stats) { statsBox.innerHTML = '<div><b>' + t('yourStats') + '</b></div>' + statsHtml(stats); };
      const cachedStats = email && P.cache.get('stats.' + email);
      if (cachedStats) paint(cachedStats);
      (email ? getStats(email) : P.api('stats', { token: mine[0].token })).then(function (r) {
        if (statsBox.isConnected) paint(r.stats);
      }).catch(function () { if (!cachedStats) statsBox.remove(); });
    }
  }

  async function share(ev) {
    const url = location.origin + location.pathname + '?event=' + encodeURIComponent(ev.id);
    const text = t('shareText', { date: P.fmtDate(ev.date), time: P.fmtTimeRange(ev.time, ev.endTime), loc: ev.location });
    if (navigator.share) {
      try { await navigator.share({ title: SITE, text: text, url: url }); } catch (e) { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
      P.toast(t('linkCopied'));
    } catch (e) {
      prompt(t('copyLink'), url);
    }
  }

  route();
})();
