export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function sendData(res, data, status = 200) {
  res.status(status).json({ ok: true, data });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' }
  });
}

export function errorHandler(error, req, res, _next) {
  if (error instanceof ApiError) {
    if (error.status >= 500) console.error(`[api] ${error.code}: ${error.message}`);
    res.status(error.status).json({
      ok: false,
      error: { code: error.code, message: error.message, details: error.details }
    });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({
      ok: false,
      error: { code: 'INVALID_JSON', message: 'Corps de requête JSON invalide.' }
    });
    return;
  }

  console.error('[api] erreur inattendue:', error);
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Une erreur interne est survenue.' }
  });
}
