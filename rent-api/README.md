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
| `GET /` | plain-text status |

Row: `{ boxId, valueNano, settlementHeight, eligibleAt, eligibleInBlocks, status, drainable, tokenCount, tokens[] }`.

## Run
```bash
ERGO_NODE_URL=http://127.0.0.1:9053 \
ALLOW_ORIGIN=https://ergo.runonflux.com \
PORT=8480 \
node server.js
```
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
