import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/store.js';
import { resetForTests as resetStore } from '../src/store.js';

const base = (cpuPct, memPct) => ({
  cpuPct,
  memory: { totalBytes: 1000, availableBytes: 1000 - memPct * 10, usedBytes: memPct * 10, usedPct: memPct },
  disks: [{ mount: '/', totalBytes: 1000, freeBytes: 100, usedBytes: 900, usedPct: 90 }],
  load: { l1: 1, l5: 1, l15: 1 },
  tempC: 40,
  uptimeS: 100
});

test('makeSample rounds and nulls gracefully', () => {
  const s = store.makeSample(base(12.345, 50));
  assert.equal(s.cpuPct, 12.3);
  assert.equal(s.memUsedPct, 50);
  assert.equal(s.diskUsedPct, 90);
  assert.equal(s.tempC, 40);
});

test('push/history bounded by points and retention', async () => {
  const cfg = (await import('../src/config.js')).default;
  cfg.historyMaxPoints = 5;
  cfg.retentionHours = 1;
  for (let i = 0; i < 10; i++) store.push({ ts: Date.now(), cpuPct: i });
  const h = store.history({});
  assert.equal(h.length, 5);
  assert.equal(h[h.length - 1].cpuPct, 9);
});

test('stats aggregates min/max/avg', async () => {
  const cfg = (await import('../src/config.js')).default;
  cfg.retentionHours = 1;
  resetStore();
  const t0 = Date.now();
  const samples = [10, 20, 30].map((cpuPct, i) => ({ ts: t0 + i, cpuPct, memUsedPct: cpuPct }));
  for (const s of samples) store.push(s);
  const st = store.stats();
  assert.equal(st.cpu.min, 10);
  assert.equal(st.cpu.max, 30);
  assert.equal(st.cpu.avg, 20);
});
