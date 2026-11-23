import config, { hostLabel } from './config.js';

const state = {
  // kind -> { count, lastFiredMs, active, lastValue, sinceMs }
  breaches: new Map()
};

function tgSend(text) {
  if (!config.telegramToken || !config.telegramChatId) {
    console.log('[alert:tg-unset]', text);
    return;
  }
  const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  }).catch((err) => console.error('[alert] telegram send failed:', err.message));
}

function fmtPct(v) {
  return v == null ? 'n/a' : `${Math.round(v)}%`;
}

const KINDS = {
  cpu: (s) => `CPU ${fmtPct(s.cpuPct)}`,
  memory: (s) => `RAM ${fmtPct(s.memUsedPct)}`,
  disk: (s) => `Disk ${fmtPct(s.diskUsedPct)}`,
  temperature: (s) => `Temp ${s.tempC != null ? s.tempC + '°C' : 'n/a'}`,
  endpoint: (s) => `Down ${s.endpointDown || ''}`
};

function thresholds() {
  return {
    cpu: config.cpuAlertPct,
    memory: config.memAlertPct,
    disk: config.diskAlertPct,
    temperature: config.tempAlertC
  };
}

/** Evaluate one sample; stateful hysteresis + cooldown per alert kind. */
export function evaluate(sample) {
  if (!config.alertsEnabled) return;

  const th = thresholds();
  const now = Date.now();
  for (const [kind, threshold] of Object.entries(th)) {
    const value = sample[kind === 'temperature' ? 'tempC' : `${kind}Pct`];
    if (value == null) continue;
    const entry = state.breaches.get(kind) ?? { count: 0, lastFiredMs: 0, active: false };

    if (value >= threshold) {
      entry.count += 1;
      entry.lastValue = value;
      if (!entry.active && entry.count >= config.alertConsecutive && now - entry.lastFiredMs >= config.alertCooldownMs) {
        entry.active = true;
        entry.lastFiredMs = now;
        entry.sinceMs = now;
        tgSend(`🔴 <b>${hostLabel()}</b> ${KINDS[kind](sample)} ≥ ${threshold} (>${Math.round(config.alertConsecutive * config.sampleIntervalMs / 1000)}s)`);
      }
    } else if (entry.active) {
      entry.active = false;
      entry.count = 0;
      tgSend(`🟢 <b>${hostLabel()}</b> ${KINDS[kind](sample)} kembali normal (< ${threshold})`);
    } else {
      entry.count = 0;
    }
    state.breaches.set(kind, entry);
  }
}

/** Endpoint down/recovery alerts (called by the poller). */
export function endpointDown(name, detail, wasUp) {
  if (!config.alertsEnabled) return;
  if (wasUp) {
    tgSend(`🔴 <b>${hostLabel()}</b> endpoint DOWN: ${name} — ${detail}`);
  }
}

export function endpointUp(name, wasDown) {
  if (!config.alertsEnabled) return;
  if (wasDown) {
    tgSend(`🟢 <b>${hostLabel()}</b> endpoint UP: ${name}`);
  }
}

/** Snapshot for /api/v1/alerts */
export function snapshot() {
  const out = {};
  for (const [kind, entry] of state.breaches) {
    out[kind] = {
      active: entry.active,
      consecutive: entry.count,
      lastValue: entry.lastValue ?? null,
      lastFiredAt: entry.lastFiredMs ? new Date(entry.lastFiredMs).toISOString() : null
    };
  }
  return out;
}

export function resetForTests() {
  state.breaches.clear();
}
