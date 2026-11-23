import config from './config.js';
import { pingTcp } from './collectors.js';
import * as alerts from './alerts.js';

let endpoints = []; // [{ name, host, port, intervalMs, last: {ok, ms, error, checkedAt}, wasDown }]
let timer = null;

/** Config from SYSMON_ENDPOINTS: "name=host:port[:intervalSec],..." */
export function parseEndpoints(raw) {
  if (!raw) return [];
  return raw.split(',').map((chunk) => {
    const parts = chunk.trim().split(':');
    if (parts.length < 2) return null;
    const [name, host, portRaw, intervalRaw] = parts;
    const port = parseInt(portRaw, 10);
    if (!name || !host || !Number.isFinite(port)) return null;
    const intervalMs = Math.max(5_000, (parseInt(intervalRaw, 10) || 30) * 1000);
    return { name, host, port, intervalMs, last: null, wasDown: false };
  }).filter(Boolean);
}

export function initFromEnv(raw) {
  endpoints = parseEndpoints(raw);
  return endpoints;
}

export function start() {
  if (!endpoints.length) return;
  for (const ep of endpoints) scheduleProbe(ep, 0);
}

function scheduleProbe(ep, delayMs) {
  const t = setTimeout(() => probe(ep), delayMs);
  t.unref?.();
}

async function probe(ep) {
  const result = await pingTcp(ep.host, ep.port);
  const prev = ep.last;
  ep.last = { ...result, checkedAt: Date.now() };

  if (result.ok) {
    if (ep.wasDown) {
      ep.wasDown = false;
      alerts.endpointUp(ep.name, true);
    }
  } else {
    // Only fire once per outage: wasDown guard.
    alerts.endpointDown(ep.name, result.error || 'unreachable', !ep.wasDown && prev != null);
    ep.wasDown = true;
  }
  scheduleProbe(ep, ep.intervalMs);
}

export function getEndpoints() {
  return endpoints.map(({ name, host, port, intervalMs, last, wasDown }) => ({
    name, host, port, intervalMs,
    status: last ? (last.ok ? 'up' : 'down') : 'pending',
    latencyMs: last?.ms ?? null,
    lastError: last?.error ?? null,
    checkedAt: last?.checkedAt ?? null,
    wasDown
  }));
}

export function stop() {
  clearTimeout(timer);
}
