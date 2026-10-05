// The only file you need to edit. See README.md, step 5.
window.APP_CONFIG = {
  // Paste your Apps Script web app URL here (it ends in /exec).
  API_URL: 'https://script.google.com/macros/s/AKfycby2MEEUdjqYnH2JoTOk_6nMC6XSioizTJtMUy2YU4DNFgdAHwi38DLBjO2KyiXU8OdCog/exec',

  // Shown at the top of the page and in the browser tab.
  SITE_NAME: 'Antigua Pickup',
  TAGLINE: 'Pickup basketball · Antigua Guatemala',
  TAGLINE_ES: 'Básquet · Antigua Guatemala',

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
