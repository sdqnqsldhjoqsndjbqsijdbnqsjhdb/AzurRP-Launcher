'use strict';

function fallbackContent() {
  return {
    news: [],
    links: {
      discord: 'https://discord.azur-rp.eu',
      website: 'https://azur-rp.eu',
      rules: 'https://azur-rp.eu/reglement',
      map: 'https://azur-rp.eu/carte'
    },
    announcement: null,
    offlineFallback: true
  };
}

module.exports = { fallbackContent };
