import fs from 'node:fs';
import readline from 'node:readline';
import config, { ensureDataDir } from './config.js';

let samples = []; // newest last
let flushTimer = null;
let dirty = false;

function cutoffMs() {
  return Date.now() - config.retentionHours * 3_600_000;
}

/** Build one sample. `extra` merges probe results (endpoints, etc). */
export function makeSample(base, extra = {}) {
  return {
    ts: Date.now(),
    cpuPct: round(base.cpuPct, 1),
    memUsedPct: round(base.memory?.usedPct, 1),
    memUsedBytes: base.memory?.usedBytes ?? null,
    memTotalBytes: base.memory?.totalBytes ?? null,
    diskUsedPct: base.disks?.[0]?.usedPct != null ? round(base.disks[0].usedPct, 1) : null,
    load1: round(base.load?.l1, 2),
    tempC: base.tempC != null ? round(base.tempC, 1) : null,
    uptimeS: base.uptimeS ?? null,
    ...extra
  };
}

function round(v, digits) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function start() {
  ensureDataDir();
  loadHistory();
  flushTimer = setInterval(flush, config.flushIntervalMs);
  flushTimer.unref?.();
}

export function stop() {
  clearInterval(flushTimer);
  flush();
}

/** Push a sample, trim retention + point cap. */
export function push(sample) {
  samples.push(sample);
  const cutoff = cutoffMs();
  if (samples.length > config.historyMaxPoints || (samples.length && samples[0].ts < cutoff)) {
    while (samples.length && (samples.length > config.historyMaxPoints || samples[0].ts < cutoff)) {
      samples.shift();
    }
  }
  dirty = true;
}

export function history({ points = 720, since = 0 } = {}) {
  let out = samples;
  if (since > 0) out = out.filter((s) => s.ts >= since);
  if (out.length > points) out = out.slice(out.length - points);
  return out;
}

export function latest() {
  return samples.length ? samples[samples.length - 1] : null;
}

export function stats() {
  const cutoff = cutoffMs();
  const window = samples.filter((s) => s.ts >= cutoff);
  const pick = (key) => window.map((s) => s[key]).filter((v) => v != null);
  const minMaxAvg = (arr) => {
    if (!arr.length) return null;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { min: r(min), max: r(max), avg: r(avg) };
  };
  return {
    points: window.length,
    windowHours: config.retentionHours,
    cpu: minMaxAvg(pick('cpuPct')),
    memory: minMaxAvg(pick('memUsedPct')),
    disk: minMaxAvg(pick('diskUsedPct')),
    temperature: minMaxAvg(pick('tempC'))
  };
}

function r(v) {
  return Math.round(v * 10) / 10;
}

/** Tail-load JSONL (bounded), newest samples survive restarts. */
function loadHistory() {
  if (!fs.existsSync(config.historyFile)) return;
  try {
    const stat = fs.statSync(config.historyFile);
    const maxBytes = config.historyMaxPoints * 160; // ~bytes/line upper bound
    const start = Math.max(0, stat.size - maxBytes);
    const stream = fs.createReadStream(config.historyFile, { start, encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line) return;
      try {
        const s = JSON.parse(line);
        if (s && s.ts >= cutoffMs()) samples.push(s);
      } catch {
        // torn line after restart — skip
      }
    });
    rl.on('close', () => {
      const cutoff = cutoffMs();
      samples = samples.filter((s) => s.ts >= cutoff);
      if (start > 0) dirty = true; // truncated head should be rewritten
    });
  } catch (err) {
    console.error('[store] load failed:', err.message);
  }
}

export function resetForTests() {
  samples = [];
  dirty = false;
}

export function flush() {
  if (!dirty) return;
  try {
    ensureDataDir();
    const tmp = config.historyFile + '.tmp';
    fs.writeFileSync(tmp, samples.map((s) => JSON.stringify(s)).join('\n') + '\n');
    fs.renameSync(tmp, config.historyFile);
    dirty = false;
  } catch (err) {
    console.error('[store] flush failed:', err.message);
  }
}
