// The only file you need to edit. See README.md, step 5.
window.APP_CONFIG = {
  // Paste your Apps Script web app URL here (it ends in /exec).
  API_URL: 'https://script.google.com/macros/s/AKfycbxMSpXikc0sPAemXM0uuJPWlSJ3YK2qjx40_2A6EJkRAz_-tCJLEtsuSd4bkyzGqRHcog/exec',

  // Shown at the top of the page and in the browser tab.
  SITE_NAME: 'Antigua Pickup',
  TAGLINE: 'Pickup basketball · Antigua Guatemala',
  TAGLINE_ES: 'Básquet · Antigua Guatemala',

  // Default total court cost (quetzales) for new games; each game can be changed in admin.
  // The game page shows the cost per player, rounded up to the nearest Q5.
  DEFAULT_COST: 400,
  // Split the cost across a full roster until at least this many have signed up.
  COST_MIN_PLAYERS: 6,

  // Gyms shown in the admin dropdown. The first one is the default for new games.
  // On the player page the game's location links to Google Maps.
  // Optional mapUrl: paste a Google Maps share link to pin the exact spot.
  LOCATIONS: [
    {
      name: 'Centro Integral Deportivo Ciudad Vieja',
      address: '185 5 Calle, Ciudad Vieja, Guatemala',
      mapUrl: 'https://maps.app.goo.gl/peQhwgZyHqcAAcET8',
    },
  ],
};
