# rent-api

Live storage-rent eligibility service. Runs alongside an Ergo node, reads it
directly, and serves clean JSON that the site (`ergo.runonflux.com`) fetches for
its **RENT WATCH** tab. Read-only. Zero dependencies (Node 18+ built-ins only).

```
Ergo node (127.0.0.1:9053) ──block-walk + /utxo/byId──▶ rent-api ──CORS JSON──▶ ergo.runonflux.com
```

## Why it exists
- A browser can't reach the node (localhost, no CORS) and the node has no
  "boxes about to expire" endpoint.
- The Zelcore GraphQL can't do unfiltered height scans (times out) and can't see
  plain-ERG dormant boxes at all.

rent-api walks the settlement-height window on the node and keeps the live set in
memory: **spent status comes from the node's UTXO set** (`/utxo/byId/{id}` →
200 = unspent, 404 = spent), and each block's own height is the settlement height.

## Endpoints
| Route | Returns |
|---|---|
| `GET /rent/summary` | `height`, `generatedAt`, `totals`, `window` |
| `GET /rent/boxes?status=collectable&withTokens=1&limit=300` | summary + `rows[]` |
| `GET /health` | `{ ok, height, lastScan, scanning, cached }` |
| `GET /sweeper/stats` | live sweeper totals (fees paid, ERG recovered, net, boxes swept) — public |
| `GET /sweeper/log?limit=` | recent sweeper tx records |
| `GET /` | plain-text status |

Row: `{ boxId, valueNano, settlementHeight, eligibleAt, eligibleInBlocks, status, drainable, tokenCount, tokens[] }`.

## Run
Config and secrets live in a gitignored `.env` (never on the command line):
```bash
cp .env.example .env      # then edit: node URL, CORS origin, and (for the sweeper) your key
node --env-file=.env server.js        # rent-api        (Node 20.6+)
node --env-file=.env rent-sweeper.js  # sweeper
```
`pm2 start ecosystem.config.js` runs both and passes `--env-file=.env` for you.
You can still override any single value inline (e.g. `PORT=9000 node --env-file=.env server.js`) — an explicit env var wins over the file.
First boot does one full scan of the window (fast on a local node), then
re-scans incrementally every `SCAN_INTERVAL_MS` (new settlement blocks + a UTXO
re-check of cached boxes, dropping spent ones). `/health` returns while warming up.

### Config (env)
| Var | Default | Notes |
|---|---|---|
| `ERGO_NODE_URL` | `http://127.0.0.1:9053` | your node |
| `PORT` | `8480` | listen port |
| `ALLOW_ORIGIN` | `*` | set to `https://ergo.runonflux.com` in prod |
| `LOOKAHEAD_DAYS` | `14` | how far ahead to track |
| `OVERDUE_LOOKBACK_BLOCKS` | `4320` | keep recently-collectable boxes (~6d) |
| `SCAN_INTERVAL_MS` | `60000` | incremental cycle |
| `CONCURRENCY` | `12` | parallel node requests |
| `ALL` | unset | `1` = every box; default keeps only dust or token-bearing |

## Deploy for `api.ergo.runonflux.com`

**systemd** (`/etc/systemd/system/rent-api.service`):
```ini
[Unit]
Description=Ergo rent-api
After=network.target

[Service]
WorkingDirectory=/opt/flux-ergo-claims/rent-api
Environment=ERGO_NODE_URL=http://127.0.0.1:9053
Environment=ALLOW_ORIGIN=https://ergo.runonflux.com
Environment=PORT=8480
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
```bash
systemctl enable --now rent-api
```

**nginx** TLS terminator for `api.ergo.runonflux.com`:
```nginx
server {
  listen 443 ssl;
  server_name api.ergo.runonflux.com;
  # ssl_certificate ... (certbot/caddy)
  location / {
    proxy_pass http://127.0.0.1:8480;
    proxy_read_timeout 30s;
  }
}
```

CORS is emitted by the service itself (`ALLOW_ORIGIN`), so nginx only needs to
proxy. The site's RENT WATCH tab points at `https://api.ergo.runonflux.com`
(set as `RENT_API` in `site/index.html`); until the service is live the tab
degrades gracefully to a "feed unavailable" notice.

---

## rent-sweeper.js — automated collector

Runs alongside the node and rent-api. Every block it pulls currently-collectable
boxes, keeps the **whole-takeable** ones (value ≤ the box's own storage fee =
`bytes × storageFeeFactor`), packs a moderate batch, and sweeps them into one
consolidated output — self-funding from the swept ERG. It writes public stats
(`sweeper-stats.json`) and a per-tx log (`sweeper-log.jsonl`) that rent-api serves.

**Safe by default:** `DRY_RUN=1` builds and logs the intended transactions but does
**not** broadcast. Inspect them, then set `DRY_RUN=0` to go live.

```bash
cp .env.example .env      # set SWEEP_PRIVATE_KEY (or SWEEP_MNEMONIC) and keep DRY_RUN=1
node --env-file=.env rent-sweeper.js
```
Provide **one** of `SWEEP_PRIVATE_KEY` (raw dlog secret, 64 hex chars) or `SWEEP_MNEMONIC`.
On startup it prints `dest <address>` — confirm that matches your funded address.

### Config (env)
| Var | Default | Notes |
|---|---|---|
| `SWEEP_MNEMONIC` | — | wallet that funds the tx and receives sweeps (**required**) |
| `DRY_RUN` | `1` | `1` = build+log only; `0` = broadcast |
| `SAFE_ADDRESS` | wallet addr | where swept funds go (set to a public safe address for defensive sweep-and-return) |
| `BATCH_CAP` | `20` | boxes per tx — small enough to limit whole-tx invalidation if a rival snipes an input |
| `MIN_MARGIN` | `2000000` | require net ≥ 0.002 ERG before broadcasting |
| `KEEP_TOKENS` | `1` | keep tokens/NFTs (`0` burns them) |
| `RENT_API_URL` | `http://127.0.0.1:8480` | candidate source |

### Strategy
Sweep **every block** (the fee is negligible and waiting donates boxes to faster
competitors); cap the batch so one sniped input can't void a huge tx; fold the
previous output box in as an input to consolidate for free; only broadcast when
`recoverable − fee ≥ MIN_MARGIN`. Only **whole-takeable** boxes are targeted —
funded boxes (value > fee) would each need a recreated output and only yield the
~0.13 ERG rent fee; that mode (`SWEEP_FUNDED`) is a TODO.

### Notes
- Needs Node 18+ and `ergo-lib-wasm-nodejs`. The tx-building/signing calls are
  written against the same library `bot/shield.js` uses; method names can shift
  across ergo-lib versions — validate a DRY_RUN tx against your node before going live.
- `pm2 start ecosystem.config.js` starts both rent-api and rent-sweeper (sweeper
  ships with `DRY_RUN=1`). Put `SWEEP_MNEMONIC` in the environment, never in the repo.
