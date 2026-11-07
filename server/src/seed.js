import env from './env.js';
import { query } from './db.js';

const SEED_NEWS = [
  {
    id: 'festival-lanternes',
    title: 'Le Festival des Lumières illumine le centre-ville',
    excerpt:
      'Trois soirées de concerts, de food trucks et d’installations lumineuses sur l’avenue centrale. La ville ne dormira pas.',
    tag: 'Événement',
    image: 'news-festival.svg',
    publishedAt: '2026-10-28 18:00:00'
  },
  {
    id: 'marche-suspendu',
    title: 'Le marché nocturne s’installe sur l’avenue',
    excerpt:
      'Artisans, producteurs et commerçants prennent possession du centre-ville à la tombée de la nuit. Un nouvel espace pour l’économie locale.',
    tag: 'Économie',
    image: 'news-market.svg',
    publishedAt: '2026-10-21 16:30:00'
  },
  {
    id: 'archives-azur',
    title: 'Le quartier d’affaires ouvre ses portes',
    excerpt:
      'Bureaux, commerces et résidences haut de gamme : le nouveau quartier d’affaires d’Azur City accueille ses premiers habitants et entreprises.',
    tag: 'Ville',
    image: 'news-lore.svg',
    publishedAt: '2026-10-14 12:00:00'
  }
];

export async function seedDefaults({ force = false } = {}) {
  const links = JSON.stringify(env.links);
  if (force) {
    await query(
      `INSERT INTO app_meta (meta_key, meta_value) VALUES ('links', ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [links]
    );
  } else {
    await query(`INSERT IGNORE INTO app_meta (meta_key, meta_value) VALUES ('links', ?)`, [links]);
  }

  const [{ total }] = await query('SELECT COUNT(*) AS total FROM news');
  if (Number(total) > 0 && !force) {
    return { news: 0, links: 0 };
  }

  for (const item of SEED_NEWS) {
    if (force) {
      await query(
        `INSERT INTO news (id, title, excerpt, tag, image, published_at, visible)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE title = VALUES(title), excerpt = VALUES(excerpt),
           tag = VALUES(tag), image = VALUES(image), published_at = VALUES(published_at), visible = 1`,
        [item.id, item.title, item.excerpt, item.tag, item.image, item.publishedAt]
      );
    } else {
      await query(
        `INSERT IGNORE INTO news (id, title, excerpt, tag, image, published_at, visible)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [item.id, item.title, item.excerpt, item.tag, item.image, item.publishedAt]
      );
    }
  }

  console.log(`[seed] ${SEED_NEWS.length} actualité(s) et liens par défaut insérés`);
  return { news: SEED_NEWS.length, links: 1 };
}
