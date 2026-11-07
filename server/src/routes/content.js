import { Router } from 'express';
import env from '../env.js';
import { query, toIso } from '../db.js';
import { asyncHandler, sendData } from '../http.js';

const router = Router();

function parseMeta(rows, key, fallback) {
  const row = rows.find((item) => item.meta_key === key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.meta_value);
  } catch {
    return fallback;
  }
}

export function serializeNews(row) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    tag: row.tag,
    image: row.image,
    publishedAt: toIso(row.published_at)
  };
}

export async function loadContent() {
  const [news, meta] = await Promise.all([
    query(
      `SELECT id, title, excerpt, tag, image, published_at
       FROM news WHERE visible = 1
       ORDER BY published_at DESC, created_at DESC
       LIMIT 12`
    ),
    query('SELECT meta_key, meta_value FROM app_meta')
  ]);

  const links = parseMeta(meta, 'links', env.links);
  const announcement = parseMeta(meta, 'announcement', null);

  return {
    news: news.map(serializeNews),
    links: {
      discord: links?.discord || env.links.discord,
      website: links?.website || env.links.website,
      rules: links?.rules || env.links.rules,
      map: links?.map || env.links.map
    },
    announcement: typeof announcement?.text === 'string' ? announcement.text : null
  };
}

router.get(
  '/content',
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=30');
    sendData(res, await loadContent());
  })
);

export default router;
