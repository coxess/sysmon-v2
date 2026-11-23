import config from './config.js';

/** Extract Authorization: Bearer token from a Request or Node request. */
export function bearerToken(req) {
  const header = typeof req.headers?.get === 'function'
    ? (req.headers.get('authorization') || '')
    : String(req.headers?.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : '';
}

export function authorized(req) {
  if (!config.apiToken) return true;
  return bearerToken(req) === config.apiToken;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}
