'use strict';

function fallbackContent() {
  return {
    news: [
      {
        id: 'festival-lanternes',
        title: 'Le Festival des Lumières illumine le centre-ville',
        excerpt: 'Trois soirées de concerts, de food trucks et d’installations lumineuses sur l’avenue centrale. La ville ne dormira pas.',
        tag: 'Événement',
        image: 'news-festival.svg',
        publishedAt: '2026-10-28T18:00:00.000Z'
      },
      {
        id: 'marche-suspendu',
        title: 'Le marché nocturne s’installe sur l’avenue',
        excerpt: 'Artisans, producteurs et commerçants prennent possession du centre-ville à la tombée de la nuit. Un nouvel espace pour l’économie locale.',
        tag: 'Économie',
        image: 'news-market.svg',
        publishedAt: '2026-10-21T16:30:00.000Z'
      },
      {
        id: 'archives-azur',
        title: 'Le quartier d’affaires ouvre ses portes',
        excerpt: 'Bureaux, commerces et résidences haut de gamme : le nouveau quartier d’affaires d’Azur City accueille ses premiers habitants et entreprises.',
        tag: 'Ville',
        image: 'news-lore.svg',
        publishedAt: '2026-10-14T12:00:00.000Z'
      }
    ],
    links: {
      discord: 'https://discord.gg/azurrp',
      website: 'https://azurrp.fr',
      rules: 'https://azurrp.fr/reglement',
      map: 'https://azurrp.fr/carte'
    },
    announcement: null,
    offlineFallback: true
  };
}

module.exports = { fallbackContent };
