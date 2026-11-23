import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';

const RE_CPU_LINE = /^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/;

function readProc(pathname) {
  try {
    return fs.readFileSync(pathname, 'utf8');
  } catch {
    return '';
  }
}

function toInt(s) {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/** First line of /proc/uptime: seconds with 2 decimals. */
export function uptimeSeconds() {
  const raw = readProc('/proc/uptime').split('\n')[0];
  const s = parseFloat(raw);
  return Number.isFinite(s) ? s : Math.round(process.uptime());
}

/** 0..100 busy fraction between two /proc/stat snapshots. */
export function cpuTimes() {
  const line = readProc('/proc/stat').split('\n')[0];
  const m = RE_CPU_LINE.exec(line);
  if (!m) return null;
  const [user, nice, system, idle, iowait, irq, softirq, steal] = m.slice(1).map(toInt);
  const idleAll = idle + iowait;
  const total = user + nice + system + idleAll + irq + softirq + steal;
  const proc = procTicks();
  return { idle: idleAll, total, ...proc };
}

export function cpuBusyPct(prev, curr) {
  if (!prev || !curr) return null;
  const dTotal = curr.total - prev.total;
  const dIdle = curr.idle - prev.idle;
  if (dTotal > 0) {
    const pct = (1 - dIdle / dTotal) * 100;
    return Math.max(0, Math.min(100, pct));
  }
  // /proc/stat frozen (e.g. proot bind-mounts a static snapshot):
  // fall back to this process's CPU time.
  return procBusyPct(prev, curr);
}

/** Fallback: usage of this process + its children between snapshots. */
export function procBusyPct(prev, curr) {
  if (!prev?.procTicks || !curr?.procTicks) return null;
  const dTicks = curr.procTicks - prev.procTicks;
  if (dTicks <= 0) return null;
  const elapsedS = (curr.hrtimeNs - prev.hrtimeNs) / 1e9;
  const cores = os.cpus().length || 1;
  const hz = 100; // USER_HZ on Linux
  const pct = (dTicks / hz / elapsedS / cores) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** Process CPU ticks (user+system, incl. waited-for children). */
export function procTicks() {
  const stat = readProc('/proc/self/stat');
  const fields = stat.split(' ');
  const ticks = toInt(fields[13]) + toInt(fields[14]) + toInt(fields[15]) + toInt(fields[16]);
  if (!ticks) return null;
  return { procTicks: ticks, hrtimeNs: Number(process.hrtime.bigint()) };
}

/**
 * Memory in bytes. Android/Termux: MemAvailable from /proc/meminfo is the
 * honest "free" number; fall back to free + buffers + cached.
 */
export function memory() {
  const info = {};
  for (const line of readProc('/proc/meminfo').split('\n')) {
    const m = /^(\w+):\s+(\d+)\s+kB/.exec(line);
    if (m) info[m[1]] = toInt(m[2]) * 1024;
  }
  const total = info.MemTotal ?? os.totalmem();
  if (!total) return null;
  let available = info.MemAvailable;
  if (!available) {
    available = (info.MemFree ?? 0) + (info.Buffers ?? 0) + (info.Cached ?? 0);
  }
  const used = Math.max(0, total - available);
  return {
    totalBytes: total,
    availableBytes: available,
    usedBytes: used,
    usedPct: (used / total) * 100
  };
}

/** Per-filesystem usage for a fixed list of mount points. */
export function disks(mounts = ['/']) {
  const out = [];
  for (const mount of mounts) {
    try {
      const st = fs.statfsSync(mount);
      const bsize = st.bsize ?? 4096;
      const total = st.blocks * bsize;
      const free = st.bavail * bsize;
      if (!total) continue;
      const used = total - free;
      out.push({
        mount,
        totalBytes: total,
        freeBytes: free,
        usedBytes: used,
        usedPct: (used / total) * 100
      });
    } catch {
      // mount not present on this device
    }
  }
  return out;
}

export function loadavg() {
  const [l1, l5, l15] = os.loadavg();
  return { l1, l5, l15 };
}

/** Temperature in Celsius from the usual suspects; null when unknown. */
export function temperature() {
  const candidates = [
    '/sys/class/thermal/thermal_zone0/temp',
    '/sys/class/hwmon/hwmon0/temp1_input',
    '/sys/class/thermal/thermal_zone1/temp'
  ];
  for (const p of candidates) {
    const raw = readProc(p).trim();
    if (!raw) continue;
    const milli = toInt(raw);
    if (milli > 0) {
      // Some drivers report milli-Celsius, a few plain Celsius.
      return milli > 1000 ? milli / 1000 : milli;
    }
  }
  return null;
}

export function battery() {
  const read = (p) => {
    const v = readProc(p).trim();
    return v === '' ? null : toInt(v);
  };
  const capacity = read('/sys/class/power_supply/battery/capacity');
  if (capacity === null) return null;
  const status = readProc('/sys/class/power_supply/battery/status').trim() || 'Unknown';
  return { percent: capacity, status };
}

/** TCP connect latency to a host, or null when unreachable. */
export function pingTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = net.createConnection({ host, port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      done({ ok: true, ms: Math.round(ms * 10) / 10 });
    });
    socket.on('timeout', () => done({ ok: false, error: 'timeout' }));
    socket.on('error', (err) => done({ ok: false, error: err.code || 'error' }));
  });
}
