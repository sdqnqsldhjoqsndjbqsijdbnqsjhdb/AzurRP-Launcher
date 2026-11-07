import env from './env.js';
import { query } from './db.js';

const OBSOLETE_NEWS_IDS = ['festival-lanternes', 'marche-suspendu', 'archives-azur'];

export async function seedDefaults({ force = false } = {}) {
  // Remove les anciennes actualités de démonstration déjà présentes en base.
  await query('DELETE FROM news WHERE id IN (?, ?, ?)', OBSOLETE_NEWS_IDS);

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

  return { news: 0, links: 1 };
}
