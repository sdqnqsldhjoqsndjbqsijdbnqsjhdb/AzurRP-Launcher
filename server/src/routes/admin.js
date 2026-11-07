import { Router } from 'express';
import { query, serializeUser, toIso } from '../db.js';
import { ApiError, asyncHandler, sendData } from '../http.js';
import { requireAuth, requireRole } from '../auth.js';
import { serializeNews } from './content.js';

const router = Router();

router.use(requireAuth, requireRole('admin', 'staff'));

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toMysqlDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function validateNews(body, { partial = false } = {}) {
  const output = {};
  const has = (key) => Object.hasOwn(body, key);

  if (!partial || has('title')) {
    const title = String(body.title ?? '').trim();
    if (title.length < 3 || title.length > 160) {
      throw new ApiError(400, 'INVALID_NEWS', 'Le titre doit contenir entre 3 et 160 caractères.');
    }
    output.title = title;
  }

  if (!partial || has('excerpt')) {
    output.excerpt = String(body.excerpt ?? '').trim().slice(0, 600);
  }

  if (!partial || has('tag')) {
    const tag = String(body.tag ?? 'AzurRP').trim().slice(0, 40);
    output.tag = tag || 'AzurRP';
  }

  if (!partial || has('image')) {
    const image = String(body.image ?? 'news-lore.svg').trim().slice(0, 500);
    if (image && !/^(https:\/\/|[\w.-]+\.(svg|png|jpe?g|webp)$)/i.test(image)) {
      throw new ApiError(400, 'INVALID_NEWS_IMAGE', 'Image invalide : utilise un nom de fichier ou une URL HTTPS.');
    }
    output.image = image || 'news-lore.svg';
  }

  if (!partial || has('publishedAt')) {
    output.publishedAt = toMysqlDate(body.publishedAt, null);
  }

  if (!partial || has('visible')) {
    output.visible = body.visible === false || body.visible === 0 ? 0 : 1;
  }

  return output;
}

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const [rows, countRows] = await Promise.all([
      query(
        `SELECT id, username, email, role, created_at, last_login_at
         FROM users ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
      ),
      query('SELECT COUNT(*) AS total FROM users')
    ]);
    sendData(res, {
      total: Number(countRows[0].total),
      page,
      limit,
      users: rows.map(serializeUser)
    });
  })
);

router.get(
  '/news',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT id, title, excerpt, tag, image, published_at, visible, created_at
       FROM news ORDER BY published_at DESC, created_at DESC`
    );
    sendData(res, {
      news: rows.map((row) => ({
        ...serializeNews(row),
        visible: Boolean(row.visible),
        createdAt: toIso(row.created_at)
      }))
    });
  })
);

router.post(
  '/news',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const data = validateNews(body);
    const id = slugify(body.id || data.title);
    if (!id) throw new ApiError(400, 'INVALID_NEWS_ID', 'Identifiant d’actualité invalide.');

    const existing = await query('SELECT id FROM news WHERE id = ? LIMIT 1', [id]);
    if (existing.length) throw new ApiError(409, 'NEWS_EXISTS', 'Une actualité utilise déjà cet identifiant.');

    const publishedAt = data.publishedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');
    await query(
      `INSERT INTO news (id, title, excerpt, tag, image, published_at, visible)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.title, data.excerpt, data.tag, data.image, publishedAt, data.visible]
    );
    sendData(res, { id }, 201);
  })
);

router.put(
  '/news/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '');
    const existing = await query('SELECT * FROM news WHERE id = ? LIMIT 1', [id]);
    if (!existing.length) throw new ApiError(404, 'NEWS_NOT_FOUND', 'Actualité introuvable.');

    const data = validateNews(req.body || {}, { partial: true });
    const fields = [];
    const values = [];
    const columns = {
      title: 'title',
      excerpt: 'excerpt',
      tag: 'tag',
      image: 'image',
      visible: 'visible'
    };
    for (const [key, column] of Object.entries(columns)) {
      if (data[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(data[key]);
      }
    }
    if (data.publishedAt) {
      fields.push('published_at = ?');
      values.push(data.publishedAt);
    }
    if (!fields.length) throw new ApiError(400, 'NOTHING_TO_UPDATE', 'Aucune modification fournie.');

    values.push(id);
    await query(`UPDATE news SET ${fields.join(', ')} WHERE id = ?`, values);
    sendData(res, { id });
  })
);

router.delete(
  '/news/:id',
  asyncHandler(async (req, res) => {
    const result = await query('DELETE FROM news WHERE id = ?', [String(req.params.id || '')]);
    if (!result.affectedRows) throw new ApiError(404, 'NEWS_NOT_FOUND', 'Actualité introuvable.');
    sendData(res, { deleted: true });
  })
);

router.put(
  '/announcement',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text ?? '').trim().slice(0, 500);
    await query(
      `INSERT INTO app_meta (meta_key, meta_value) VALUES ('announcement', ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [JSON.stringify({ text })]
    );
    sendData(res, { text });
  })
);

router.put(
  '/links',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const links = {};
    for (const key of ['discord', 'website', 'rules', 'map']) {
      const value = String(body[key] ?? '').trim();
      if (!/^https?:\/\/[^\s]{3,2000}$/i.test(value)) {
        throw new ApiError(400, 'INVALID_LINK', `Lien invalide pour « ${key} ».`);
      }
      links[key] = value;
    }
    await query(
      `INSERT INTO app_meta (meta_key, meta_value) VALUES ('links', ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [JSON.stringify(links)]
    );
    sendData(res, { links });
  })
);

export default router;
