import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as alerts from '../src/alerts.js';
import config from '../src/config.js';

const sent = [];

// capture outbound Telegram text without network
const origFetch = globalThis.fetch;
test.beforeEach(() => {
  alerts.resetForTests();
  sent.length = 0;
  globalThis.fetch = async (url, opts) => {
    sent.push(JSON.parse(opts.body).text);
    return { ok: true };
  };
  config.telegramToken = 'test-token';
  config.telegramChatId = '123';
  config.alertConsecutive = 2;
  config.alertCooldownMs = 1000;
  config.sampleIntervalMs = 10000;
});

const sample = (cpu) => ({ cpuPct: cpu, memUsedPct: 10, diskUsedPct: 10, tempC: 40 });

test('fires only after N consecutive breaches', () => {
  alerts.evaluate(sample(95));
  assert.equal(sent.length, 0);
  alerts.evaluate(sample(95));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /CPU 95%/);
});

test('recovery sends green notification', () => {
  alerts.evaluate(sample(95));
  alerts.evaluate(sample(95));
  alerts.evaluate(sample(20));
  assert.equal(sent.length, 2);
  assert.match(sent[1], /🟢/);
});

test('cooldown suppresses immediate re-fire', () => {
  alerts.evaluate(sample(95));
  alerts.evaluate(sample(95)); // fire
  alerts.evaluate(sample(20)); // recover
  alerts.evaluate(sample(95));
  alerts.evaluate(sample(95)); // would fire again but within cooldown
  const fires = sent.filter((s) => s.includes('🔴')).length;
  assert.equal(fires, 1);
});

test('below-threshold never fires', () => {
  for (let i = 0; i < 10; i++) alerts.evaluate(sample(50));
  assert.equal(sent.length, 0);
});
