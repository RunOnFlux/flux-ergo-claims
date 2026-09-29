#!/usr/bin/env node
/**
 * HARVESTER ANALYSIS — which mining pools mine storage-rent collections
 * =====================================================================
 * Walks recent blocks, attributes each to the pool that mined it (explorer's
 * miner labels), finds the storage-rent collection txs inside (inputs spent with
 * an EMPTY proof), and flags the ones paying an economically IRRATIONAL fee.
 *
 * The signal, stated carefully: a rent-collection tx paying a fee far above the
 * 0.001 ERG norm hands most of the box's value to the block's miner. That is only
 * rational for the COLLECTOR if the collector IS the miner (the fee returns to
 * them). So when a pool's own blocks repeatedly contain such txs, it is evidence
 * — presented as an observed on-chain pattern, not an accusation of intent — that
 * the pool is self-harvesting.
 *
 * Writes rent-api/harvester-report.json, which rent-api serves at /rent/harvesters.
 *
 * RUN (periodically, e.g. hourly cron):
 *   BLOCKS=256 node harvester-analysis.js
 */

const fs = require('fs');
const path = require('path');

const EXPLORER = (process.env.EXPLORER_URL || 'https://api.ergoplatform.com').replace(/\/$/, '');
const NODE_URL = (process.env.ERGO_NODE_URL || 'http://127.0.0.1:9053').replace(/\/$/, '');
const BLOCKS = Number(process.env.BLOCKS || 256);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const IRRATIONAL_FEE = Number(process.env.IRRATIONAL_FEE || 5_000_000); // >0.005 ERG fee ⇒ irrational for a non-miner
const OUT = path.join(__dirname, 'harvester-report.json');
const STORAGE_PERIOD = 1_051_200;
const FEE_PREFIX = '1005040004000e36';

async function jget(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'harvester-analysis/1.0' } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function pool(items, worker, limit) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const j = i++; try { res[j] = await worker(items[j]); } catch { res[j] = null; } }
  }));
  return res;
}
const emptyProof = (i) => { const sp = i.spendingProof; const b = sp == null ? null : (typeof sp === 'string' ? sp : sp.proofBytes); return b == null || b === ''; };

async function recentBlocks(n) {
  // explorer list carries the miner label; page back from the tip
  const out = [];
  for (let off = 0; out.length < n; off += 100) {
    const d = await jget(`${EXPLORER}/api/v1/blocks?limit=100&offset=${off}&sortBy=height&sortDirection=desc`);
    const items = d.items || [];
    if (!items.length) break;
    out.push(...items);
    if (items.length < 100) break;
  }
  return out.slice(0, n);
}

async function main() {
  console.error(`analysing last ${BLOCKS} blocks…`);
  const blocks = await recentBlocks(BLOCKS);
  const perMiner = new Map(); // name -> stats

  await pool(blocks, async (b) => {
    const miner = (b.miner && (b.miner.name || b.miner.address)) || 'unknown';
    const body = await jget(`${NODE_URL}/blocks/${b.id}/transactions`).catch(() => null);
    const txs = (body && body.transactions) || [];
    let harvestTxs = 0, harvestFees = 0, irrational = 0, irrationalFees = 0;
    for (const t of txs) {
      if (!(t.inputs || []).some(emptyProof)) continue;         // not a rent collection
      const fee = (t.outputs || []).filter(o => (o.ergoTree || '').startsWith(FEE_PREFIX)).reduce((a, o) => a + Number(o.value), 0);
      harvestTxs++; harvestFees += fee;
      if (fee >= IRRATIONAL_FEE) { irrational++; irrationalFees += fee; }
    }
    const s = perMiner.get(miner) || { miner, address: b.miner && b.miner.address, blocksMined: 0, blocksWithHarvest: 0, harvestTxs: 0, harvestFeesNano: 0, irrationalHarvests: 0, irrationalFeesNano: 0 };
    s.blocksMined++;
    if (harvestTxs) s.blocksWithHarvest++;
    s.harvestTxs += harvestTxs; s.harvestFeesNano += harvestFees;
    s.irrationalHarvests += irrational; s.irrationalFeesNano += irrationalFees;
    perMiner.set(miner, s);
  }, CONCURRENCY);

  const pools = [...perMiner.values()].sort((a, b) => b.irrationalFeesNano - a.irrationalFeesNano || b.harvestFeesNano - a.harvestFeesNano);
  const totals = pools.reduce((t, p) => ({
    blocks: t.blocks + p.blocksMined, harvestTxs: t.harvestTxs + p.harvestTxs,
    harvestFeesNano: t.harvestFeesNano + p.harvestFeesNano, irrational: t.irrational + p.irrationalHarvests,
  }), { blocks: 0, harvestTxs: 0, harvestFeesNano: 0, irrational: 0 });

  const report = {
    generatedAt: new Date().toISOString(),
    blocksAnalyzed: blocks.length,
    fromHeight: blocks.length ? blocks[blocks.length - 1].height : null,
    toHeight: blocks.length ? blocks[0].height : null,
    irrationalFeeThresholdNano: IRRATIONAL_FEE,
    totals,
    pools: pools.map(p => ({ ...p })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`\nblocks ${report.fromHeight}–${report.toHeight} · ${totals.harvestTxs} rent-collection txs · ${(totals.harvestFeesNano / 1e9).toFixed(2)} ERG in fees to miners · ${totals.irrational} irrational-fee (self-harvest signal)\n`);
  console.log('POOL'.padEnd(22), 'blocks', 'w/harvest', 'harvestTx', 'fees(ERG)', 'irrational');
  for (const p of pools.slice(0, 15)) {
    console.log(String(p.miner).slice(0, 21).padEnd(22),
      String(p.blocksMined).padStart(6), String(p.blocksWithHarvest).padStart(9),
      String(p.harvestTxs).padStart(9), (p.harvestFeesNano / 1e9).toFixed(3).padStart(9), String(p.irrationalHarvests).padStart(10));
  }
  console.log(`\nreport -> ${OUT}`);
}
main().catch(e => { console.error('failed:', e.message); process.exit(1); });
