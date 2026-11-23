# sysmon-v2

**Self-hosted system monitor for edge devices** — a dependency-free REST API that tracks CPU, memory, disk, temperature, and uptime on anything that runs Node.js ≥ 18. Built and battle-tested on Android/Termux, where heavier stacks (Prometheus, Zabbix) are impractical.

[![CI](https://github.com/coxess/sysmon-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/coxess/sysmon-v2/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green)](package.json)

## Why

A headless Android phone (e.g. a Vivo V2029 without a screen) makes a surprisingly capable mini-server: Termux + runit supervise nginx / php-fpm / gateways, and **sysmon-v2 is the observability layer** — polling `/proc` and sysfs directly, exposing a clean JSON API over HTTP, keeping a bounded history on disk, and pushing alerts to Telegram. Zero npm dependencies, one process, ~10 MB RSS.

```
┌──────────────┐   HTTP    ┌───────────────────────────────┐
│  dashboards  │──────────▶│  sysmon-v2 (Node, no deps)    │
│  curl / CI   │           │  ┌─────────┐  ┌────────────┐  │──▶ Telegram
└──────────────┘           │  │ poller  │─▶│ history    │  │    (down/CPU/
                           │  └─────────┘  │ JSONL file │  │     RAM alerts)
                           │  ┌─────────┐  └────────────┘  │
                           │  │ probes  │──▶ TCP endpoints │
                           │  └─────────┘                  │
                           └───────────────────────────────┘
```

## Features

- **Live status** — CPU (via `/proc/stat` deltas), memory (`MemAvailable`-aware, correct on Android), per-mount disk usage, load average, SoC temperature, battery, uptime.
- **History** — JSONL persistence that survives restarts, bounded by time *and* point count; min/max/avg aggregates per retention window.
- **Alerts** — CPU / RAM / disk / temperature thresholds with hysteresis (N consecutive breaches) and per-kind cooldown; **Telegram** push for fire + recovery.
- **Endpoint probes** — periodic TCP connect checks (e.g. gateway `:53`, web `:443`) with up/down recovery notifications.
- **Token auth** — optional `Authorization: Bearer` gate on every route; `/healthz` stays open for supervisors.
- **Zero dependencies** — no npm install, no build step, no native modules. Runs on Termux out of the box.

## Quick start

```bash
git clone https://github.com/coxess/sysmon-v2.git
cd sysmon-v2
SYSMON_PORT=4120 node src/server.js
```

```bash
$ curl -s localhost:4120/healthz
{"ok":true,"uptimeS":3}

$ curl -s localhost:4120/api/v1/status | jq .cpu
{ "pct": 12.4, "cores": 8, "model": "AArch64 Processor rev 4", "load": { "l1": 0.42, … } }
```

### Termux (Android) with runit

```bash
# once
mkdir -p ~/service/sysmon && cp deploy/runit/service.run ~/service/sysmon/run
# env lives in ~/.config/sysmon/env (see .env.example)
sv up sysmon   # or: runsv ~/service/sysmon
```

`deploy/runit/service.run` sets `SYSMON_HOME` to the project dir and executes Node from Termux's prefix — no root required.

## API

All routes return JSON. When `SYSMON_API_TOKEN` is set, every route except `GET /healthz` requires `Authorization: Bearer <token>`.

| Route | Description |
|---|---|
| `GET /healthz` | Liveness for supervisors — no auth. |
| `GET /` | Service metadata + route index. |
| `GET /api/v1/status` | One-shot live sample (fresh CPU delta + last stored point + alert state). |
| `GET /api/v1/history?points=720&since=<epoch-ms>` | Stored time series (bounded, newest N). |
| `GET /api/v1/stats` | min / max / avg over the retention window. |
| `GET /api/v1/alerts` | Thresholds + live breach state per alert kind. |
| `GET /api/v1/endpoints` | Probe configs and last results (`up`/`down`/`pending`, latency). |
| `GET /api/v1/uptime` | Device uptime, boot time, and service uptime. |

<details>
<summary>Example: <code>/api/v1/status</code></summary>

```json
{
  "host": "vivo-v2029",
  "ts": 1763900000000,
  "cpu": { "pct": 12.4, "cores": 8, "model": "AArch64 Processor rev 4", "load": { "l1": 0.4, "l5": 0.3, "l15": 0.2 } },
  "memory": { "totalBytes": 3992977408, "availableBytes": 1480000000, "usedBytes": 2512977408, "usedPct": 62.9 },
  "disks": [{ "mount": "/", "totalBytes": 53687091200, "freeBytes": 21474836480, "usedBytes": 32212254720, "usedPct": 60.0 }],
  "temperatureC": 38.6,
  "battery": { "percent": 87, "status": "Discharging" },
  "uptimeS": 864000,
  "poller": { "intervalMs": 10000, "lastSampleAt": 1763899990000, "storedPoints": 17280 },
  "alerts": { "cpu": { "active": false, "consecutive": 0, "lastValue": null, "lastFiredAt": null } }
}
```
</details>

## Configuration

All configuration is environment-driven — no config files to edit, friendly to `runsvenv`/`supervise` setups. See [`.env.example`](.env.example) for the full list; the essentials:

| Variable | Default | Description |
|---|---|---|
| `SYSMON_PORT` | `4120` | HTTP listen port. |
| `SYSMON_HOST` | `0.0.0.0` | Bind address; set `127.0.0.1` behind nginx. |
| `SYSMON_SAMPLE_INTERVAL_MS` | `10000` | Poller cadence (≥ 1000). |
| `SYSMON_RETENTION_HOURS` | `48` | History kept on disk. |
| `SYSMON_API_TOKEN` | *(unset)* | When set, gates all API routes behind Bearer auth. |
| `SYSMON_TELEGRAM_TOKEN` / `SYSMON_TELEGRAM_CHAT_ID` | *(unset)* | Telegram alert delivery (log-only when unset). |
| `SYSMON_CPU_ALERT_PCT` | `90` | CPU alert threshold, % busy. |
| `SYSMON_MEM_ALERT_PCT` | `90` | Memory alert threshold, % used. |
| `SYSMON_DISK_ALERT_PCT` | `90` | Disk alert threshold (first mount), % used. |
| `SYSMON_TEMP_ALERT_C` | `80` | SoC temperature alert, °C. |
| `SYSMON_ALERT_CONSECUTIVE` | `3` | Consecutive breaches before firing (hysteresis). |
| `SYSMON_ALERT_COOLDOWN_MS` | `600000` | Min interval between re-notifications per kind. |
| `SYSMON_ENDPOINTS` | *(unset)* | TCP probes: `gw=192.168.1.1:53:30,web=example.com:443:60`. |
| `SYSMON_DISK_MOUNTS` | `/` | Comma-separated mounts to report. |
| `SYSMON_HOST_LABEL` | hostname | Name used in API payloads and alert messages. |

## Data & persistence

- `data/history.jsonl` — one JSON object per line, newest appended; rewritten atomically (`tmp` + `rename`) every `SYSMON_FLUSH_INTERVAL_MS` when dirty.
- Retention is enforced in-memory on every push (time window + `SYSMON_HISTORY_MAX_POINTS`) and re-applied when reloading after a restart, so the file can never grow unbounded.
- `SIGINT`/`SIGTERM` flush and close cleanly — safe under runit's default stop signals.

## Development

```bash
node --test test/          # unit + API tests, no deps needed
node --watch src/server.js # local dev with hot reload
```

The test suite covers the collectors against the real `/proc`/`/sys` interfaces, store retention math, alert hysteresis/cooldown state machine, and the HTTP surface (auth, pagination, 404) via an in-process server.

## Deployment notes (Termux/Android)

- **Keep it alive**: runit (recommended) or `termux-services`; the service script exits on `SIGTERM` so `sv` restarts it cleanly.
- **Wake locks**: `termux-wake-lock` in the service run script prevents Android from freezing the process.
- **Behind nginx**: bind `SYSMON_HOST=127.0.0.1`, proxy `location /sysmon/ { proxy_pass http://127.0.0.1:4120/; }`, and set `SYSMON_API_TOKEN` — the LAN gets it via HTTPS, the API stays token-gated.
- **Doze mode**: alerts keep working as long as the process runs; keep the device plugged in for 24/7 monitoring.

## Roadmap

- [ ] Web UI: minimal dashboard served from `/` (static, no framework).
- [ ] More output channels (webhook, ntfy) alongside Telegram.
- [ ] Optional SQLite backend for long retention.
- [ ] Multi-node mode: scrape remote sysmon instances into one history.

## License

[MIT](LICENSE) © coxess
