const buckets = new Map();
let lastCleanup = Date.now();

/**
 * Limiteur en mémoire, suffisant pour une instance unique.
 * Pour plusieurs instances, remplacer par Redis.
 */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyPrefix = 'global' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > 60_000) {
      lastCleanup = now;
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: `Trop de tentatives. Réessaie dans ${Math.ceil(retryAfter / 60)} minute(s).`,
          details: { retryAfter }
        }
      });
      return;
    }

    next();
  };
}
