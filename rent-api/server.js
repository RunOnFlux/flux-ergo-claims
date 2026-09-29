#!/usr/bin/env node
/**
 * RENT-API — live storage-rent eligibility service
 * =================================================
 * Runs alongside your Ergo node, reads it directly (block-walk + UTXO checks),
 * and serves clean JSON that a browser UI (e.g. ergo.runonflux.com) fetches.
 * Read-only. Zero dependencies — Node 18+ built-in fetch + http only.
 *
 * WHY A SERVICE: a browser cannot reach the node (localhost + no CORS), and the
 * node has no "boxes about to expire" endpoint. This service bridges both: it
 * walks the settlement-height window on the node, keeps the live set in memory,
 * and exposes it with CORS.
 *
 * Eligibility: a box is rent-collectable when height - settlementHeight >= PERIOD.
 * The node returns a block's outputs (no spent flag), and /utxo/byId tells us if
 * an output is still unspent (200) or already spent (404). The block's own height
 * is the settlement height.
 *
 * ENDPOINTS
 *   GET /rent/summary            -> { height, generatedAt, totals, window, stale }
 *   GET /rent/boxes?status=&limit=&withTokens=  -> { ...summary, rows: [...] }
 *   GET /health                  -> { ok, height, lastScan, scanning }
 *   GET /                        -> plain-text status
 *
 * RUN
 *   ERGO_NODE_URL=http://127.0.0.1:9053 PORT=8480 node server.js
 *   ALLOW_ORIGIN=https://ergo.runonflux.com node server.js   # lock CORS down
 *
 * Put it behind HTTPS (nginx/caddy) at a public host so the static site can fetch it.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const NODE_URL = (process.env.ERGO_NODE_URL || 'http://127.0.0.1:9053').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 8480);
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const STORAGE_PERIOD = 1_051_200;
const BLOCK_SECONDS = 120;
const LOOKAHEAD_DAYS = Number(process.env.LOOKAHEAD_DAYS || 14);
const LOOKAHEAD_BLOCKS = Math.round((LOOKAHEAD_DAYS * 86400) / BLOCK_SECONDS);
const OVERDUE_LOOKBACK_BLOCKS = Number(process.env.OVERDUE_LOOKBACK_BLOCKS || 4320); // ~6 days back
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 60_000); // re-check cache every minute
const CONCURRENCY = Number(process.env.CONCURRENCY || 12);
const DUST_THRESHOLD = 150_000_000;
const REQ_TIMEOUT_MS = 20_000;
const ONLY_INTERESTING = process.env.ALL !== '1'; // keep dust or token-bearing boxes

const TOKEN_LABELS = {
  e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807: 'Flux',
  '472c3d4ecaa08fb7392ff041ee2e6af75f4a558810a74b28600549d5392810e8': 'NETA',
  d71693c49a84fbbecd4908c94813b46514b18b67a99952dc1e6e4791556de413: 'ergopad',
  '0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b': 'COMET',
  '03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04': 'SigUSD',
};

// ==================== NODE CLIENT ====================
async function nodeGet(path, { allow404 = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const r = await fetch(`${NODE_URL}${path}`, { signal: ctrl.signal });
    if (r.status === 404 && allow404) return null;
    if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const getHeight = async () => (await nodeGet('/info')).fullHeight;

// Every unspent output settled at a given height (the block's height IS settlement).
async function boxesSettledAt(height) {
  const ids = await nodeGet(`/blocks/at/${height}`);
  if (!Array.isArray(ids) || !ids.length) return [];
  const body = await nodeGet(`/blocks/${ids[0]}/transactions`);
  const txs = (body && body.transactions) || [];
  const out = [];
  for (const tx of txs) {
    for (const o of tx.outputs || []) {
      // still unspent iff present in the node's UTXO set
      const utxo = await nodeGet(`/utxo/byId/${o.boxId}`, { allow404: true });
      if (utxo) out.push(o);
    }
  }
  return out;
}

// Re-check whether a single cached box is still unspent.
const stillUnspent = (boxId) => nodeGet(`/utxo/byId/${boxId}`, { allow404: true }).then(Boolean).catch(() => true);

// bounded-concurrency map
async function pool(items, worker, limit) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await worker(items[i], i); } catch { results[i] = null; }
    }
  });
  await Promise.all(runners);
  return results;
}

// ==================== SHAPE ====================
function shape(o, settlementHeight, height) {
  const eligibleAt = settlementHeight + STORAGE_PERIOD;
  const assets = o.assets || [];
  return {
    boxId: o.boxId,
    address: o.address || null, // node output has no address; UI can resolve if needed
    valueNano: Number(o.value),
    settlementHeight,
    eligibleAt,
    eligibleInBlocks: eligibleAt - height,
    status: eligibleAt - height <= 0 ? 'COLLECTABLE' : 'soon',
    drainable: Number(o.value) < DUST_THRESHOLD,
    tokenCount: assets.length,
    tokens: assets.map(a => ({ tokenId: a.tokenId, amount: a.amount, label: TOKEN_LABELS[a.tokenId] || null })),
  };
}
const keep = (b) => !ONLY_INTERESTING || b.drainable || b.tokenCount > 0;

// ==================== STATE + SCANNER ====================
const cache = new Map(); // boxId -> shaped box (settlement + eligibleAt are stable)
let state = { height: 0, generatedAt: null, totals: {}, window: {}, ready: false };
let scanning = false;
let lastScannedFloor = null; // highest settlement height we've already ingested

function rebuild(height) {
  const rows = [];
  for (const b of cache.values()) {
    b.eligibleInBlocks = b.eligibleAt - height;
    b.status = b.eligibleInBlocks <= 0 ? 'COLLECTABLE' : 'soon';
    rows.push(b);
  }
  rows.sort((a, b) => a.eligibleInBlocks - b.eligibleInBlocks);
  const floor = height - STORAGE_PERIOD;
  state = {
    height,
    eligibleFloor: floor,
    generatedAt: new Date().toISOString(),
    window: { lookaheadBlocks: LOOKAHEAD_BLOCKS, overdueLookbackBlocks: OVERDUE_LOOKBACK_BLOCKS },
    totals: {
      boxes: rows.length,
      collectable: rows.filter(r => r.status === 'COLLECTABLE').length,
      withTokens: rows.filter(r => r.tokenCount > 0).length,
      ergAtRest: rows.reduce((a, r) => a + r.valueNano, 0),
    },
    ready: true,
    _rows: rows,
  };
}

async function ingestSettlementRange(fromH, toH, height) {
  const heights = [];
  for (let h = fromH; h <= toH; h++) heights.push(h);
  await pool(heights, async (h) => {
    const boxes = await boxesSettledAt(h);
    for (const o of boxes) {
      const b = shape(o, h, height);
      if (keep(b)) cache.set(b.boxId, b);
    }
  }, CONCURRENCY);
}

async function fullScan() {
  const height = await getHeight();
  const floor = height - STORAGE_PERIOD;
  const from = floor - OVERDUE_LOOKBACK_BLOCKS;
  const to = floor + LOOKAHEAD_BLOCKS;
  console.log(`[scan] full: settlement blocks ${from}..${to} (${to - from + 1}) at height ${height}`);
  const t0 = Date.now();
  await ingestSettlementRange(from, to, height);
  lastScannedFloor = to;
  rebuild(height);
  console.log(`[scan] full done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${cache.size} boxes cached`);
}

async function incrementalScan() {
  if (scanning) return;
  scanning = true;
  try {
    const height = await getHeight();
    const to = (height - STORAGE_PERIOD) + LOOKAHEAD_BLOCKS;
    // 1) ingest any settlement heights that newly entered the window
    if (lastScannedFloor != null && to > lastScannedFloor) {
      await ingestSettlementRange(lastScannedFloor + 1, to, height);
      lastScannedFloor = to;
    }
    // 2) drop boxes that got spent since we cached them, and prune ones that
    //    fell out of the overdue lookback (been collectable a long time)
    const cutoff = (height - STORAGE_PERIOD) - OVERDUE_LOOKBACK_BLOCKS;
    const ids = [...cache.keys()];
    await pool(ids, async (id) => {
      const b = cache.get(id);
      if (b.settlementHeight < cutoff) { cache.delete(id); return; }
      if (!(await stillUnspent(id))) cache.delete(id);
    }, CONCURRENCY);
    rebuild(height);
    console.log(`[scan] incr at ${height} — ${cache.size} boxes (${state.totals.collectable} collectable)`);
  } catch (e) {
    console.error('[scan] incremental failed:', e.message);
  } finally { scanning = false; }
}

// ==================== FEE-WAR EVIDENCE ====================
// Scan the mempool for storage-rent collection txs and surface the bidding wars:
// how much of dormant-box value is being handed to miners as fees, live.
const FEE_TREE_PREFIX = '1005040004000e36';
let feeWar = { generatedAt: null, mempoolTxs: 0, rentCollectionTxs: 0, contestedBoxes: 0, totalFeeToMinersNano: 0, maxFeeNano: 0, wars: [] };

async function fetchMempoolAll() {
  const out = [];
  for (let off = 0; off < 5000; off += 100) {
    const arr = await nodeGet(`/transactions/unconfirmed?limit=100&offset=${off}`).catch(() => null);
    if (!arr || !arr.length) break;
    out.push(...arr);
    if (arr.length < 100) break;
  }
  return out;
}
const emptyProof = (i) => { const p = (i.spendingProof || {}).proofBytes; return p == null || p === ''; };

async function refreshFeeWar() {
  try {
    const mp = await fetchMempoolAll();
    // a storage-rent collection tx has at least one input spent with an EMPTY proof
    const rent = mp.filter(t => (t.inputs || []).some(emptyProof));
    const byBox = new Map();
    let feeToMiners = 0, maxFee = 0;
    for (const t of rent) {
      const fee = (t.outputs || []).filter(o => (o.ergoTree || '').startsWith(FEE_TREE_PREFIX)).reduce((a, o) => a + Number(o.value), 0);
      feeToMiners += fee; if (fee > maxFee) maxFee = fee;
      const weight = fee / (t.size || 1);
      for (const i of (t.inputs || [])) if (emptyProof(i)) {
        if (!byBox.has(i.boxId)) byBox.set(i.boxId, []);
        byBox.get(i.boxId).push({ txId: t.id, fee, size: t.size, weight });
      }
    }
    const wars = [];
    for (const [boxId, txs] of byBox) {
      if (txs.length < 2) continue;                 // contested = ≥2 competing txs
      txs.sort((a, b) => b.weight - a.weight);
      wars.push({ boxId, bidders: txs.length, topFeeNano: txs[0].fee, topWeight: Math.round(txs[0].weight) });
    }
    wars.sort((a, b) => b.topFeeNano - a.topFeeNano);
    feeWar = {
      generatedAt: new Date().toISOString(),
      mempoolTxs: mp.length,
      rentCollectionTxs: rent.length,
      contestedBoxes: wars.length,
      totalFeeToMinersNano: feeToMiners,
      maxFeeNano: maxFee,
      wars: wars.slice(0, 40),
    };
  } catch (e) { console.error('[feewar] refresh failed:', e.message); }
}

// ==================== HTTP ====================
function send(res, code, obj, contentType = 'application/json') {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'public, max-age=15',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') {
    return send(res, 200, { ok: state.ready, height: state.height, lastScan: state.generatedAt, scanning, cached: cache.size });
  }
  // Public sweeper statistics (written by rent-sweeper.js in this directory).
  if (p === '/sweeper/stats') {
    try { return send(res, 200, JSON.parse(fs.readFileSync(path.join(__dirname, 'sweeper-stats.json'), 'utf8'))); }
    catch { return send(res, 200, { status: 'success', running: false, message: 'sweeper has not run yet' }); }
  }
  if (p === '/sweeper/log') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 500);
    try {
      const lines = fs.readFileSync(path.join(__dirname, 'sweeper-log.jsonl'), 'utf8').trim().split('\n');
      const rows = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
      return send(res, 200, { status: 'success', count: rows.length, rows });
    } catch { return send(res, 200, { status: 'success', count: 0, rows: [] }); }
  }
  // Live fee-war evidence — independent of the box scan, always available.
  if (p === '/rent/feewar') return send(res, 200, feeWar);

  // Pool self-harvest analysis (written by harvester-analysis.js, run on a cron).
  if (p === '/rent/harvesters') {
    try { return send(res, 200, JSON.parse(fs.readFileSync(path.join(__dirname, 'harvester-report.json'), 'utf8'))); }
    catch { return send(res, 200, { status: 'success', ready: false, message: 'harvester-analysis has not run yet' }); }
  }

  if (!state.ready) return send(res, 503, { status: 'error', data: { code: 503, name: 'warming-up', message: 'first scan in progress' } });

  const summary = {
    status: 'success',
    height: state.height,
    eligibleFloor: state.eligibleFloor,
    generatedAt: state.generatedAt,
    window: state.window,
    totals: state.totals,
  };

  if (p === '/rent/summary') return send(res, 200, summary);

  if (p === '/rent/boxes') {
    let rows = state._rows;
    const status = url.searchParams.get('status');
    if (status === 'collectable') rows = rows.filter(r => r.status === 'COLLECTABLE');
    if (url.searchParams.get('withTokens') === '1') rows = rows.filter(r => r.tokenCount > 0);
    const limit = Number(url.searchParams.get('limit') || 0);
    if (limit > 0) rows = rows.slice(0, limit);
    return send(res, 200, { ...summary, count: rows.length, rows });
  }

  if (p === '/') {
    return send(res, 200,
      `rent-api · node ${NODE_URL}\nheight ${state.height} · ${cache.size} boxes · ${state.totals.collectable} collectable\nendpoints: /rent/summary  /rent/boxes  /health\n`,
      'text/plain');
  }
  return send(res, 404, { status: 'error', data: { code: 404, name: 'not-found', message: p } });
});

// ==================== BOOT ====================
(async () => {
  console.log(`rent-api starting · node ${NODE_URL} · lookahead ${LOOKAHEAD_DAYS}d · CORS ${ALLOW_ORIGIN}`);
  server.listen(PORT, () => console.log(`listening on :${PORT} (serving /health while first scan runs)`));
  refreshFeeWar(); setInterval(refreshFeeWar, 30_000); // fee-war evidence, independent of the box scan
  try {
    await fullScan();
  } catch (e) {
    console.error('initial scan failed — is the node reachable at', NODE_URL, '?\n', e.message);
  }
  setInterval(incrementalScan, SCAN_INTERVAL_MS);
})();
