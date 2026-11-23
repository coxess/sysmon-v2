import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildRoutes } from '../src/routes.js';
import { authorized } from '../src/http.js';
import config from '../src/config.js';
import * as collectors from '../src/collectors.js';
import * as store from '../src/store.js';

const ctx = { collectors, startedAt: Date.now() - 5000 };
const routes = buildRoutes(ctx);

function request(path, headers = {}) {
  return new Promise(async (resolve) => {
    const handler = routes[Object.keys(routes).find((k) => k.split(' ')[1] === new URL(path, 'http://x').pathname && k.startsWith('GET'))];
    if (!handler) return resolve({ status: 404, body: { error: 'not found' } });
    const req = { headers: new Headers(headers), url: `http://x${path}` };
    const res = await handler(req);
    resolve({ status: res.status, body: JSON.parse(await res.text()) });
  });
}

test.beforeEach(() => {
  config.apiToken = '';
});

test('healthz is open and unauthenticated', async () => {
  const r = await request('/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('all api routes return ok when auth disabled', async () => {
  for (const p of ['/api/v1/status', '/api/v1/history', '/api/v1/stats', '/api/v1/alerts', '/api/v1/endpoints', '/api/v1/uptime']) {
    const r = await request(p);
    assert.equal(r.status, 200, p);
  }
});

test('api is gated when token is set', async () => {
  config.apiToken = 'sekrit';
  const denied = await request('/api/v1/status');
  assert.equal(denied.status, 401);
  // simulate header
  const req = { headers: new Headers({ authorization: 'Bearer sekrit' }), url: 'http://x/api/v1/status' };
  assert.equal(authorized(req), true);
  const ok = await routes['GET /api/v1/status'](req);
  assert.equal(ok.status, 200);
});

test('history honors points cap', async () => {
  for (let i = 0; i < 3; i++) store.push({ ts: Date.now() + i, cpuPct: i });
  const r = await request('/api/v1/history?points=2');
  assert.equal(r.body.count, 2);
});
