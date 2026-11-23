import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.env.SYSMON_HOME || process.cwd();

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function list(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const dataDir = path.join(ROOT, 'data');

const config = {
  // Network
  port: num('SYSMON_PORT', 4120),
  host: process.env.SYSMON_HOST || '0.0.0.0',

  // Polling / retention
  sampleIntervalMs: Math.max(1_000, num('SYSMON_SAMPLE_INTERVAL_MS', 10_000)),
  retentionHours: num('SYSMON_RETENTION_HOURS', 48),
  flushIntervalMs: num('SYSMON_FLUSH_INTERVAL_MS', 30_000),
  historyMaxPoints: num('SYSMON_HISTORY_MAX_POINTS', 17_280), // 48h @ 10s

  // Alerts
  alertsEnabled: process.env.SYSMON_ALERTS !== '0',
  cpuAlertPct: num('SYSMON_CPU_ALERT_PCT', 90),
  memAlertPct: num('SYSMON_MEM_ALERT_PCT', 90),
  diskAlertPct: num('SYSMON_DISK_ALERT_PCT', 90),
  tempAlertC: num('SYSMON_TEMP_ALERT_C', 80),
  downAlertMs: num('SYSMON_DOWN_ALERT_MS', 60_000),
  // Consecutive breach samples before firing (hysteresis on)
  alertConsecutive: Math.max(1, num('SYSMON_ALERT_CONSECUTIVE', 3)),
  // Cooldown per alert kind before re-notifying
  alertCooldownMs: num('SYSMON_ALERT_COOLDOWN_MS', 10 * 60_000),

  // Telegram
  telegramToken: process.env.SYSMON_TELEGRAM_TOKEN || '',
  telegramChatId: process.env.SYSMON_TELEGRAM_CHAT_ID || '',

  // Security: if set, all API routes require `Authorization: Bearer <token>`
  apiToken: process.env.SYSMON_API_TOKEN || '',

  // Paths
  dataDir,
  historyFile: path.join(dataDir, 'history.jsonl'),
  stateFile: path.join(dataDir, 'state.json'),

  // Endpoints probed via TCP connect: "name=host:port[:intervalSec],..."
  endpoints: process.env.SYSMON_ENDPOINTS || '',
  // Mounts reported by /api/v1/status "disks"
  diskMounts: list('SYSMON_DISK_MOUNTS', ['/']),

  // Overrides for /api/v1/uptime: service started after this epoch ms
  startedAtEpochMs: num('SYSMON_STARTED_AT_EPOCH_MS', 0)
};

export function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

export function hostLabel() {
  return process.env.SYSMON_HOST_LABEL || os.hostname() || 'device';
}

export default config;
