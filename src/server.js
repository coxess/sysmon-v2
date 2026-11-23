import http from 'node:http';
import { fileURLToPath } from 'node:url';
import config, { hostLabel, ensureDataDir } from './config.js';
import * as collectors from './collectors.js';
import * as store from './store.js';
import * as alerts from './alerts.js';
import * as probes from './probes.js';
import { buildRoutes } from './routes.js';

const startedAt = Date.now();

/** One poll: CPU delta over 10% of the interval, then compose + store + evaluate. */
async function sampleOnce() {
  const cpuPrev = collectors.cpuTimes();
  await sleep(Math.max(100, Math.round(config.sampleIntervalMs / 10)));
  const base = {
    cpuPct: collectors.cpuBusyPct(cpuPrev, collectors.cpuTimes()),
    memory: collectors.memory(),
    disks: collectors.disks(config.diskMounts),
    load: collectors.loadavg(),
    tempC: collectors.temperature(),
    uptimeS: collectors.uptimeSeconds()
  };
  const sample = store.makeSample(base);
  store.push(sample);
  alerts.evaluate(sample);
  return sample;
}

function startPoller() {
  let stopped = false;
  (async () => {
    while (!stopped) {
      try {
        await sampleOnce();
      } catch (err) {
        console.error('[poller] sample failed:', err.message);
      }
      await sleep(config.sampleIntervalMs);
    }
  })();
  return () => { stopped = true; };
}

const routes = buildRoutes({ collectors, startedAt });

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const handler = routes[`${req.method} ${url.pathname}`];
  res.setHeader('X-Sysmon', 'v2');
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  try {
    const response = await handler(req);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(await response.text());
  } catch (err) {
    console.error('[http] handler error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal' }));
  }
}

export function main() {
  ensureDataDir();
  store.start();
  probes.initFromEnv(process.env.SYSMON_ENDPOINTS || '');
  probes.start();
  const stopPoller = startPoller();

  const server = http.createServer(handle);
  server.listen(config.port, config.host, () => {
    console.log(`[sysmon-v2] listening on ${config.host}:${config.port} (host=${hostLabel()}, sample=${config.sampleIntervalMs}ms)`);
  });

  const shutdown = (signal) => {
    console.log(`[sysmon-v2] ${signal}, flushing and closing`);
    stopPoller();
    probes.stop();
    store.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run directly: `node src/server.js`
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
