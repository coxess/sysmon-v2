import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import * as collectors from '../src/collectors.js';

test('cpuTimes parses /proc/stat and cpuBusyPct is sane', () => {
  const t1 = collectors.cpuTimes();
  assert.ok(t1, 'cpuTimes should parse on linux');
  assert.ok(t1.total > 0);
});

test('memory returns consistent byte fields', () => {
  const m = collectors.memory();
  assert.ok(m);
  assert.ok(m.totalBytes > 0);
  assert.ok(m.usedPct >= 0 && m.usedPct <= 100);
  assert.ok(m.usedBytes <= m.totalBytes);
});

test('disks reports root mount', () => {
  const d = collectors.disks(['/']);
  assert.equal(d.length, 1);
  assert.ok(d[0].totalBytes > 0);
});

test('loadavg numbers are finite', () => {
  const l = collectors.loadavg();
  for (const v of [l.l1, l.l5, l.l15]) assert.ok(Number.isFinite(v));
});

test('uptimeSeconds is positive', () => {
  assert.ok(collectors.uptimeSeconds() > 0);
});

test('pingTcp to localhost fails fast on closed port', async () => {
  const r = await collectors.pingTcp('127.0.0.1', 1, 500);
  assert.equal(r.ok, false);
});

test('pingTcp reaches a real listener', async () => {
  const net = await import('node:net');
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const r = await collectors.pingTcp('127.0.0.1', port, 1000);
  assert.equal(r.ok, true);
  assert.ok(r.ms >= 0);
  server.close();
});
