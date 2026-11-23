import config, { hostLabel } from './config.js';
import { authorized, json, errorJson } from './http.js';
import * as store from './store.js';
import * as alerts from './alerts.js';
import { getEndpoints } from './probes.js';
import os from 'node:os';

function guard(req) {
  return authorized(req) ? null : errorJson('unauthorized', 401);
}

export function buildRoutes(ctx) {
  const { collectors, startedAt } = ctx;

  return {
    'GET /'(req) {
      const fail = guard(req);
      if (fail) return fail;
      return json({
        name: 'sysmon-v2',
        version: '2.0.0',
        host: hostLabel(),
        endpoints: ['/api/v1/status', '/api/v1/history', '/api/v1/stats', '/api/v1/alerts', '/api/v1/endpoints', '/api/v1/uptime', '/healthz']
      });
    },

    'GET /healthz'() {
      return json({ ok: true, uptimeS: Math.round(process.uptime()) });
    },

    async 'GET /api/v1/status'(req) {
      const fail = guard(req);
      if (fail) return fail;

      const cpuPrev = collectors.cpuTimes();
      await sleep(Math.max(100, Math.round(config.sampleIntervalMs / 10)));
      const cpuPct = collectors.cpuBusyPct(cpuPrev, collectors.cpuTimes());
      const cpus = os.cpus();
      const live = store.latest();

      return json({
        host: hostLabel(),
        ts: Date.now(),
        cpu: { pct: cpuPct, cores: cpus.length, model: cpus[0]?.model ?? null, load: collectors.loadavg() },
        memory: collectors.memory(),
        disks: collectors.disks(config.diskMounts),
        temperatureC: collectors.temperature(),
        battery: collectors.battery(),
        uptimeS: collectors.uptimeSeconds(),
        poller: {
          intervalMs: config.sampleIntervalMs,
          lastSampleAt: live?.ts ?? null,
          storedPoints: store.stats().points
        },
        alerts: alerts.snapshot()
      });
    },

    'GET /api/v1/history'(req) {
      const fail = guard(req);
      if (fail) return fail;
      const url = new URL(req.url, 'http://localhost');
      const points = clampInt(url.searchParams.get('points'), 1, 10_000, 720);
      const since = clampInt(url.searchParams.get('since'), 0, Date.now(), 0);
      const samples = store.history({ points, since });
      return json({ host: hostLabel(), count: samples.length, samples });
    },

    'GET /api/v1/stats'(req) {
      const fail = guard(req);
      if (fail) return fail;
      return json({ host: hostLabel(), ...store.stats() });
    },

    'GET /api/v1/alerts'(req) {
      const fail = guard(req);
      if (fail) return fail;
      return json({
        host: hostLabel(),
        enabled: config.alertsEnabled,
        thresholds: { cpuPct: config.cpuAlertPct, memPct: config.memAlertPct, diskPct: config.diskAlertPct, tempC: config.tempAlertC },
        state: alerts.snapshot()
      });
    },

    'GET /api/v1/endpoints'(req) {
      const fail = guard(req);
      if (fail) return fail;
      return json({ host: hostLabel(), endpoints: getEndpoints() });
    },

    'GET /api/v1/uptime'(req) {
      const fail = guard(req);
      if (fail) return fail;
      const uptimeS = collectors.uptimeSeconds();
      return json({
        host: hostLabel(),
        uptimeS,
        bootedAt: new Date(Date.now() - uptimeS * 1000).toISOString(),
        serviceUptimeS: Math.round((Date.now() - startedAt) / 1000)
      });
    }
  };
}

function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
