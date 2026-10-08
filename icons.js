// Custom icon set (24×24 line icons) and badge medallions, in the site's Panza Verde colors.
(function () {
  const PATHS = {
    // badges
    ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3.2 3.2 3.2 9.6 0 12.8M18.4 5.6c-3.2 3.2-3.2 9.6 0 12.8"/>',
    star: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8z"/>',
    medal: '<path d="M7.5 2.5l3 6.5M16.5 2.5l-3 6.5"/><circle cx="12" cy="15" r="6"/><path d="M12 12.2v5.6M10.6 13.4l1.4-1.2"/>',
    crown: '<path d="M3 8.5l4.6 4 4.4-7 4.4 7 4.6-4-1.8 10.5H4.8z"/><path d="M5 21h14"/>',
    flame: '<path d="M12 2.8c.8 3.6 5.2 5.6 5.2 10.4a5.2 5.2 0 0 1-10.4 0c0-2.6 1.4-4.3 2.6-5.3.2 1.6 1 2.7 2.1 3.2-.2-3 .1-5.6.5-8.3z"/>',
    dumbbell: '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>',
    sunrise: '<path d="M12 2.5v4M4.9 8.9l1.6 1.6M19.1 8.9l-1.6 1.6M2.5 17h19M6.5 17a5.5 5.5 0 0 1 11 0M8 20.5h8"/>',
    stopwatch: '<circle cx="12" cy="14" r="7"/><path d="M12 14v-3.5M9.5 2.5h5M12 2.5V7M18.2 6.8l1.6-1.6"/>',
    // interface
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.4-4 4.4-6 8-6s6.6 2 8 6"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 1.8H4.2z"/><path d="M10 21.2h4"/>',
    bellOff: '<path d="M6 16.5V11a6 6 0 0 1 9.6-4.8M18 11v5.5l1.8 1.8H8"/><path d="M10 21.2h4M3 3l18 18"/>',
    pin: '<path d="M12 21.5s-7-6.3-7-12.2a7 7 0 0 1 14 0c0 5.9-7 12.2-7 12.2z"/><circle cx="12" cy="9.3" r="2.6"/>',
    trophy: '<path d="M8 3.5h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 5.5H4.5a3.5 3.5 0 0 0 3.6 4.2M16 5.5h3.5a3.5 3.5 0 0 1-3.6 4.2M12 13v4M8 21h8M9.5 17h5v4h-5z"/>',
    alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.7L16.2 9.6"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
    install: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.2"/><path d="M12 7v7M9.3 11.4L12 14l2.7-2.6M10.5 18.5h3"/>',
  };

  // Badge key → glyph and medallion color.
  const BADGES = {
    rookie: { glyph: 'ball', color: '#e07a2e' },
    regular: { glyph: 'star', color: '#d99a1e' },
    veteran: { glyph: 'medal', color: '#3a7a46' },
    legend: { glyph: 'crown', color: '#17321f', glyphColor: '#f2c14e' },
    onFire: { glyph: 'flame', color: '#b4532a' },
    ironMan: { glyph: 'dumbbell', color: '#5b5348' },
    earlyBird: { glyph: 'sunrise', color: '#2f7f86' },
    buzzer: { glyph: 'stopwatch', color: '#8a3b5c' },
  };

  function svg(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PATHS[name] || '') + '</svg>';
  }

  // Round colored medallion with a white glyph, used for badges.
  function medal(key, cls) {
    const b = BADGES[key];
    if (!b) return '';
    return '<span class="medal' + (cls ? ' ' + cls : '') + '" style="background:' + b.color + ';color:' + (b.glyphColor || '#fff') + '">' +
      svg(b.glyph) + '</span>';
  }

  window.PickupIcons = { svg: svg, medal: medal };
})();
