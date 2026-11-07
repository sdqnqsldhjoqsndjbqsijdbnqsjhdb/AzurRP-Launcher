'use strict';

const { normalizeApiUrl } = require('../config');

const DEFAULT_TIMEOUT = 15000;

function networkErrorCode(error) {
  let cause = error;
  while (cause) {
    if (typeof cause.code === 'string') return cause.code;
    cause = cause.cause;
  }
  return '';
}

function networkErrorMessage(code) {
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return 'Le nom du serveur API est introuvable. Vérifie l’URL et le DNS.';
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
    return 'Le serveur API refuse la connexion ou est indisponible.';
  }
  if (['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)) {
    return 'Le certificat HTTPS de l’API est invalide ou expiré.';
  }
  return 'Impossible de joindre le serveur AzurRP. Vérifie ta connexion et l’URL de l’API.';
}

class ApiError extends Error {
  constructor(message, code = 'API_ERROR', status = 0, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(baseUrl, route, options = {}) {
  const { method = 'GET', body = null, token = null, timeout = DEFAULT_TIMEOUT } = options;
  let base;
  try {
    base = normalizeApiUrl(baseUrl);
  } catch (error) {
    throw new ApiError(error.message, 'BAD_API_URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'AzurRP-Launcher/1.0'
  };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const apiCode = payload?.error?.code || `HTTP_${response.status}`;
      const message = payload?.error?.message || `Erreur serveur (${response.status}).`;
      throw new ApiError(message, apiCode, response.status, payload?.error?.details ?? null);
    }
    if (!payload || payload.ok !== true) {
      throw new ApiError(payload?.error?.message || 'Réponse invalide du serveur AzurRP.', payload?.error?.code || 'INVALID_RESPONSE', response.status);
    }
    return payload.data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('Le serveur AzurRP met trop de temps à répondre.', 'TIMEOUT');
    }
    const code = networkErrorCode(error);
    throw new ApiError(networkErrorMessage(code), 'NETWORK_ERROR', 0, {
      host: new URL(base).host,
      ...(code ? { networkCode: code } : {})
    });
  } finally {
    clearTimeout(timer);
  }
}

function validateAuthPayload(data) {
  if (!data || typeof data.token !== 'string' || !data.user?.username) {
    throw new ApiError('Réponse d’authentification invalide.', 'INVALID_RESPONSE');
  }
  return {
    token: data.token,
    expiresAt: data.expiresAt || null,
    user: data.user
  };
}

async function login(baseUrl, identifier, password) {
  const data = await request(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { identifier, password }
  });
  return validateAuthPayload(data);
}

async function register(baseUrl, username, email, password) {
  const data = await request(baseUrl, '/api/v1/auth/register', {
    method: 'POST',
    body: { username, email, password }
  });
  return validateAuthPayload(data);
}

async function me(baseUrl, token) {
  const data = await request(baseUrl, '/api/v1/auth/me', { token, timeout: 10000 });
  if (!data?.user?.username) throw new ApiError('Profil invalide.', 'INVALID_RESPONSE');
  return data.user;
}

async function content(baseUrl, token = null) {
  return request(baseUrl, '/api/v1/content', { token, timeout: 10000 });
}

async function health(baseUrl) {
  return request(baseUrl, '/api/v1/health', { timeout: 6000 });
}

module.exports = { ApiError, request, login, register, me, content, health };
