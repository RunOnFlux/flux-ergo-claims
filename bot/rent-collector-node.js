#!/usr/bin/env node
/**
 * ERGO STORAGE-RENT COLLECTOR — full-coverage (network-wide) batch scan
 * =====================================================================
 * Read-only. Finds EVERY box approaching or past storage-rent eligibility,
 * including plain-ERG boxes the token-scoped GraphQL monitor can't see.
 *
 * Why this exists: the Zelcore GraphQL cannot do an unfiltered height-range
 * scan (it 504s — no index). The explorer's block endpoint, however, returns
 * every output of a block WITH its spent status (`spentTransactionId`) and
 * `mainChain` flag — and the block's own height IS the box's settlement height.
 * So we walk the settlement window block-by-block and keep the unspent outputs.
 *
 * Eligibility: box is rent-collectable when height - settlementHeight >= PERIOD.
 * A box settled at height S becomes eligible at S + PERIOD. To find boxes that
 * become eligible within the lookahead (and those already overdue), we scan
 * block heights in [floor - overdueLookback, floor + lookahead], floor = H - PERIOD.
 *
 * COST: one block fetch (~0.5 MB on the public explorer) per height. Keep the
 * window modest and run it periodically (hourly/daily), NOT every few minutes.
 * Point NODE_URL at your own node/explorer to avoid public rate limits.
 *
 * RUN: npm install axios
 *      node rent-collector-node.js
 *      LOOKAHEAD_DAYS=2 OVERDUE_LOOKBACK_BLOCKS=720 CONCURRENCY=8 node rent-collector-node.js
 *      NODE_URL=https://my-explorer/api/v1 node rent-collector-node.js
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const API = process.env.NODE_URL || 'https://api.ergoplatform.com/api/v1';
const STORAGE_PERIOD = 1_051_200;
const BLOCK_SECONDS = 120;
const LOOKAHEAD_DAYS = Number(process.env.LOOKAHEAD_DAYS || 2);
const LOOKAHEAD_BLOCKS = Math.round((LOOKAHEAD_DAYS * 86400) / BLOCK_SECONDS);
const OVERDUE_LOOKBACK_BLOCKS = Number(process.env.OVERDUE_LOOKBACK_BLOCKS || 720);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const DUST_THRESHOLD = 150_000_000;      // nanoERG (0.15) — drainable flag
const ONLY_INTERESTING = process.env.ALL !== '1'; // default: keep dust or token-bearing boxes
const TIMEOUT_MS = 30_000;
const SNAPSHOT_FILE = path.join(__dirname, 'rent-collector-snapshot.json');

// Known token labels for nicer output (extend freely).
const TOKEN_LABELS = {
  e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807: 'Flux',
  '472c3d4ecaa08fb7392ff041ee2e6af75f4a558810a74b28600549d5392810e8': 'NETA',
  d71693c49a84fbbecd4908c94813b46514b18b67a99952dc1e6e4791556de413: 'ergopad',
  '0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b': 'COMET',
  '03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04': 'SigUSD',
};

const HOST = API.replace(/\/api\/v1\/?$/, ''); // node-style routes live at the host root
const http = axios.create({ timeout: TIMEOUT_MS, headers: { 'User-Agent': 'ergo-rent-collector/1.0' } });

async function getHeight() {
  const r = await http.get(`${API}/networkState`);
  return r.data.height;
}

// height -> main-chain headerId, then full block with outputs + spent status.
async function boxesSettledAt(height) {
  const ids = (await http.get(`${HOST}/blocks/at/${height}`)).data; // ["headerId", ...] main chain first
  if (!Array.isArray(ids) || !ids.length) return [];
  const blk = (await http.get(`${API}/blocks/${ids[0]}`)).data.block;
  if (!blk || blk.header.height !== height) return [];
  const txs = blk.blockTransactions || [];
  const out = [];
  for (const tx of txs) {
    for (const o of tx.outputs || []) {
      if (o.spentTransactionId || o.mainChain === false) continue; // still unspent only
      out.push(o);
    }
  }
  return out;
}

function classify(o, settlementHeight, height) {
  const eligibleAt = settlementHeight + STORAGE_PERIOD;
  const inBlocks = eligibleAt - height;
  const assets = o.assets || [];
  return {
    boxId: o.boxId || o.id,
    address: o.address,
    valueNano: Number(o.value),
    value: (Number(o.value) / 1e8).toFixed(4),
    settlementHeight,
    eligibleAt,
    eligibleInBlocks: inBlocks,
    status: inBlocks <= 0 ? 'COLLECTABLE' : 'soon',
    drainable: Number(o.value) < DUST_THRESHOLD,
    tokenCount: assets.length,
    tokens: assets.map(a => ({ tokenId: a.tokenId, amount: a.amount, label: TOKEN_LABELS[a.tokenId] })),
  };
}

// simple bounded-concurrency map
async function pool(items, worker, limit) {
  const results = [];
  let idx = 0, active = 0, done = 0;
  return await new Promise((resolve, reject) => {
    const next = () => {
      if (done === items.length) return resolve(results);
      while (active < limit && idx < items.length) {
        const i = idx++; active++;
        Promise.resolve(worker(items[i], i))
          .then(r => { results[i] = r; })
          .catch(() => { results[i] = null; })
          .finally(() => {
            active--; done++;
            if (process.stderr.isTTY) process.stderr.write(`\r  scanned ${done}/${items.length} blocks`);
            else if (done % 250 === 0 || done === items.length) process.stderr.write(`  scanned ${done}/${items.length}\n`);
            next();
          });
      }
    };
    next();
  });
}

async function main() {
  const height = await getHeight();
  const floor = height - STORAGE_PERIOD;
  const from = floor - OVERDUE_LOOKBACK_BLOCKS;
  const to = floor + LOOKAHEAD_BLOCKS;
  const heights = [];
  for (let h = from; h <= to; h++) heights.push(h);

  console.error(`height ${height} · scanning settlement blocks ${from}..${to} (${heights.length} blocks) · concurrency ${CONCURRENCY}`);

  const perBlock = await pool(heights, async (h) => {
    try {
      const boxes = await boxesSettledAt(h);
      return boxes.map(o => classify(o, h, height));
    } catch { return null; }
  }, CONCURRENCY);
  process.stderr.write('\n');

  let rows = perBlock.filter(Boolean).flat();
  if (ONLY_INTERESTING) rows = rows.filter(r => r.drainable || r.tokenCount > 0);
  rows.sort((a, b) => a.eligibleInBlocks - b.eligibleInBlocks);

  const collectable = rows.filter(r => r.status === 'COLLECTABLE').length;
  const withTokens = rows.filter(r => r.tokenCount > 0).length;
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: 'node-blockwalk',
    height, eligibleFloor: floor,
    scanned: { from, to, blocks: heights.length },
    totals: { boxes: rows.length, collectable, withTokens },
    rows,
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));

  console.log(`\nboxes near/at eligibility: ${rows.length}  (COLLECTABLE now: ${collectable}, with tokens: ${withTokens})`);
  console.log(`filter: ${ONLY_INTERESTING ? 'dust(<0.15 ERG) or token-bearing (set ALL=1 for every box)' : 'ALL boxes'}`);
  for (const r of rows.slice(0, 25)) {
    const t = r.status === 'COLLECTABLE' ? 'COLLECTABLE' : `${r.eligibleInBlocks} blk`;
    console.log(`  ${r.value.padStart(10)} ERG  ${String(t).padStart(12)}  tok ${r.tokenCount}  ${(r.boxId||'').slice(0,16)}…`);
  }
  console.log(`\nsnapshot -> ${SNAPSHOT_FILE}`);
}

main().catch(e => { console.error('\ncollector failed:', e.message); process.exit(1); });
