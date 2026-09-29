#!/usr/bin/env node
/**
 * ERGO STORAGE-RENT MONITOR — live "about to expire" tracker
 * ==========================================================
 * Watches boxes approaching storage-rent eligibility and boxes already
 * collectable, via the Zelcore Ergo GraphQL. Read-only — never spends anything.
 *
 * Eligibility rule: a box becomes rent-collectable (anyone-can-spend under the
 * age rule) when   currentHeight - settlementHeight >= STORAGE_PERIOD.
 * We key off `settlementHeight` (the block the box was INCLUDED in) because that
 * is what the protocol's storage-rent check uses — not the declared
 * `creationHeight`. (bot/shield.js uses creationHeight; settlement is correct.)
 *
 * LIMITATION discovered against the live endpoint: an unfiltered height-range
 * scan times out (504 — no index). So this monitor is TOKEN-SCOPED: it can only
 * surface boxes that hold one of the watched tokens. Plain-ERG dormant boxes are
 * not discoverable here; for full network coverage use a node UTXO snapshot.
 * The endpoint is also slow (~20-30s/query), so REFRESH defaults high.
 *
 * RUN: npm install axios   (no wasm needed — this never builds a tx)
 *      node rent-monitor.js
 *      LOOKAHEAD_DAYS=7 SHOW_OVERDUE=1 node rent-monitor.js
 *      node rent-monitor.js --once            # single pass, print & exit
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const GRAPHQL_ENDPOINTS = [
  'https://graphql.erg.zelcore.io',
  'https://graphql.erg-1.zelcore.io',
];
const STORAGE_PERIOD = 1_051_200;         // blocks (~4 years) until rent-eligible
const BLOCK_SECONDS = 120;                // Ergo target block time
const LOOKAHEAD_DAYS = Number(process.env.LOOKAHEAD_DAYS || 7);
const LOOKAHEAD_BLOCKS = Math.round((LOOKAHEAD_DAYS * 86400) / BLOCK_SECONDS);
// NOTE: the overdue window (a wide settlement-height lookback) times out on the
// public endpoint for popular tokens, so it is OFF by default. Enable with
// SHOW_OVERDUE=1 and keep the lookback small. Full coverage of already-collectable
// boxes is better served by rent-collector-node.js (node block-walk).
const SHOW_OVERDUE = process.env.SHOW_OVERDUE === '1';
const OVERDUE_LOOKBACK_BLOCKS = Number(process.env.OVERDUE_LOOKBACK_BLOCKS || 2000);
const DUST_THRESHOLD = 150_000_000;       // nanoERG (0.15 ERG) — low-value flag (shield.js parity)
const REFRESH_MS = Number(process.env.REFRESH_MS || 180_000); // 3 min default
const GQL_TIMEOUT_MS = 45_000;
const PAGE = 50;
const MAX_PAGES = 20;                      // safety cap per (token, window)
const ONCE = process.argv.includes('--once');
const SNAPSHOT_FILE = path.join(__dirname, 'rent-monitor-snapshot.json');

// Watched tokens (same set as shield.js). Label -> tokenId.
const TOKENS = {
  Flux:    'e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807',
  NETA:    '472c3d4ecaa08fb7392ff041ee2e6af75f4a558810a74b28600549d5392810e8',
  ergopad: 'd71693c49a84fbbecd4908c94813b46514b18b67a99952dc1e6e4791556de413',
  COMET:   '0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b',
  SigUSD:  '03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04',
  WT_ADA:  '30974274078845f263b4f21787e33cc99e9ec19a17ad85a5bc6da2cca91c5a2e',
  WT_ERG:  'ef802b475c06189fdbf844153cdc1d449a5ba87cce13d11bb47b5a539f27f12b',
  ogre:    '6de6f46e5c3eca524d938d822e444b924dbffbe02e5d34bd9dcd4bbfe9e85940',
};

// ==================== GRAPHQL ====================
let endpointIdx = 0;
async function gql(query, variables) {
  let lastErr;
  for (let i = 0; i < GRAPHQL_ENDPOINTS.length; i++) {
    const ep = GRAPHQL_ENDPOINTS[(endpointIdx + i) % GRAPHQL_ENDPOINTS.length];
    try {
      const r = await axios.post(ep, { query, variables }, {
        timeout: GQL_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'ergo-rent-monitor/1.0' },
      });
      if (r.data.errors) throw new Error(r.data.errors[0].message);
      endpointIdx = (endpointIdx + i) % GRAPHQL_ENDPOINTS.length; // stick to the one that worked
      return r.data.data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const getHeight = async () =>
  (await gql('{ blockHeaders(take:1){ height } }')).blockHeaders[0].height;

// Page through boxes for one token within a settlement-height window.
async function fetchToken(tokenId, lo, hi) {
  const q = `query($t:String,$lo:Int,$hi:Int,$skip:Int){
    boxes(take:${PAGE}, skip:$skip, tokenId:$t, spent:false,
          minHeight:$lo, maxHeight:$hi, heightType:settlement){
      boxId address value settlementHeight assets{ tokenId amount } } }`;
  const out = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const d = await gql(q, { t: tokenId, lo, hi, skip: p * PAGE });
    const boxes = d.boxes || [];
    out.push(...boxes);
    if (boxes.length < PAGE) break;
  }
  return out;
}

// ==================== FORMAT ====================
function human(blocks) {
  if (blocks <= 0) return 'NOW';
  const s = blocks * BLOCK_SECONDS;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
const erg = n => (Number(n) / 1e9).toFixed(4); // ERG = 1e9 nanoERG
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const padL = (s, n) => String(s).padStart(n);

// ==================== SCAN ====================
async function scan() {
  const height = await getHeight();
  const eligibleFloor = height - STORAGE_PERIOD; // settlement <= this => eligible now
  const soonLo = eligibleFloor + 1;
  const soonHi = eligibleFloor + LOOKAHEAD_BLOCKS;

  const rows = [];
  for (const [label, tokenId] of Object.entries(TOKENS)) {
    try {
      // about-to-expire window
      const soon = await fetchToken(tokenId, soonLo, soonHi);
      // already collectable (bounded lookback so active tokens don't explode)
      const overdue = SHOW_OVERDUE
        ? await fetchToken(tokenId, eligibleFloor - OVERDUE_LOOKBACK_BLOCKS, eligibleFloor)
        : [];
      for (const b of [...overdue, ...soon]) {
        const eligibleAt = b.settlementHeight + STORAGE_PERIOD;
        const inBlocks = eligibleAt - height;
        rows.push({
          token: label,
          boxId: b.boxId,
          address: b.address,
          valueNano: Number(b.value),
          value: erg(b.value),
          settlementHeight: b.settlementHeight,
          eligibleAt,
          eligibleInBlocks: inBlocks,
          eligibleInHuman: human(inBlocks),
          status: inBlocks <= 0 ? 'COLLECTABLE' : 'soon',
          drainable: Number(b.value) < DUST_THRESHOLD, // rent fee ~ consumes small boxes
          tokenCount: (b.assets || []).length,
        });
      }
    } catch (e) {
      rows.push({ token: label, error: e.message });
    }
  }

  // de-dupe (a box could match both windows at the boundary) and sort soonest-first
  const seen = new Set();
  const clean = rows.filter(r => r.boxId && !seen.has(r.boxId) && seen.add(r.boxId));
  clean.sort((a, b) => a.eligibleInBlocks - b.eligibleInBlocks);
  const errors = rows.filter(r => r.error);
  return { height, eligibleFloor, soonHi, rows: clean, errors };
}

// ==================== RENDER ====================
function render({ height, rows, errors }) {
  if (!ONCE) process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const collectable = rows.filter(r => r.status === 'COLLECTABLE');
  console.log(`ERGO STORAGE-RENT MONITOR   height ${height}   ${now}   lookahead ${LOOKAHEAD_DAYS}d`);
  console.log(`watching ${Object.keys(TOKENS).length} tokens · ${rows.length} boxes near/at eligibility · ${collectable.length} COLLECTABLE now\n`);

  console.log(pad('TOKEN', 8), pad('VALUE(ERG)', 12), pad('ELIGIBLE IN', 13), pad('STATUS', 12), pad('TOK', 4), 'BOX');
  console.log('-'.repeat(96));
  for (const r of rows.slice(0, 40)) {
    const flag = r.drainable ? '⚠' : ' ';
    const status = r.status === 'COLLECTABLE' ? '● COLLECT' : `${padL(r.eligibleInBlocks, 6)}blk`;
    console.log(
      pad(r.token, 8),
      padL(r.value, 11) + flag,
      pad(r.eligibleInHuman, 13),
      pad(r.status === 'COLLECTABLE' ? 'COLLECTABLE' : status, 12),
      padL(r.tokenCount, 3) + ' ',
      r.boxId.slice(0, 16) + '…',
    );
  }
  if (rows.length > 40) console.log(`… and ${rows.length - 40} more (see ${path.basename(SNAPSHOT_FILE)})`);
  if (errors.length) console.log(`\n[warn] ${errors.length} token queries failed: ` +
    errors.map(e => e.token).join(', '));
  console.log(`\n⚠ = value < ${erg(DUST_THRESHOLD)} ERG (rent fee can fully drain it). Snapshot: ${SNAPSHOT_FILE}`);
  if (!ONCE) console.log(`Refreshing every ${Math.round(REFRESH_MS / 1000)}s · Ctrl-C to stop`);
}

// ==================== MAIN ====================
async function tick() {
  try {
    const result = await scan();
    render(result);
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2));
  } catch (e) {
    console.error('scan failed:', e.message);
  }
}

(async () => {
  await tick();
  if (ONCE) return;
  setInterval(tick, REFRESH_MS);
})();
