#!/usr/bin/env node
/**
 * PROBE-TOKEN — validate the valuable-token sweep path WITHOUT broadcasting.
 * =========================================================================
 * Storage-rent spends need NO signature: an expired box (age >= STORAGE_PERIOD) with value
 * <= its storage fee is spent with an EMPTY proof + context-extension var 127. A token dust
 * box holds ~0 ERG so it can't pay its own fee, so we CO-FUND from other expired dust boxes —
 * every input empty-proof, no wallet signing (ergo-lib has no storage-rent prover). This
 * builds exactly that batch for one target box (+ co-funders) and runs it through the node's
 * /transactions/check (full consensus validation, no broadcast). Never submits anything.
 *
 * RUN (on the node host):   node --env-file=.env probe-token.js [boxId]
 * With no boxId it auto-picks a whole-takeable token box from rent-api (falls back to any
 * drainable box) and co-funds from the rest of the collectable set.
 */
const ergoLib = require('ergo-lib-wasm-nodejs');

const NODE_URL = (process.env.ERGO_NODE_URL || 'http://127.0.0.1:9053').replace(/\/$/, '');
const RENT_API = (process.env.RENT_API_URL || 'http://127.0.0.1:8480').replace(/\/$/, '');
const SAFE_ADDRESS = process.env.SAFE_ADDRESS || '';
const DEST = SAFE_ADDRESS || process.env.PROBE_DEST || '9f6f6uhJnp6mBzcYwruAbS7ajjmsoix2gTqWx1Es3Coo5xJwXHv';
const FEE = BigInt(process.env.FEE || 1_100_000);
const STORAGE_PERIOD = 1_051_200;

const FEE_TREE = '1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304';
const EXT_OUTPUT0 = '0300';

async function jget(url, { allow404 = false } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'probe-token/1.0' } });
  if (r.status === 404 && allow404) return null;
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
const getUtxo = (boxId) => jget(`${NODE_URL}/utxo/byId/${boxId}`, { allow404: true });
function p2pkErgoTree(a58) { return '0008cd' + Buffer.from(ergoLib.Address.from_base58(a58).content_bytes()).toString('hex'); }
function boxBytes(boxJson) { return ergoLib.ErgoBox.from_json(JSON.stringify(boxJson)).sigma_serialize_bytes().length; }

async function main() {
  console.log(`probe-token · node ${NODE_URL} · dest ${DEST}`);
  const info = await jget(`${NODE_URL}/info`);
  const height = info.fullHeight;
  const factor = BigInt((info.parameters && info.parameters.storageFeeFactor) || 1_250_000);
  console.log(`fullHeight ${height} · storageFeeFactor ${factor}`);

  // 1) pick a target + co-funders from rent-api's collectable set
  const d = await jget(`${RENT_API}/rent/boxes?status=collectable&limit=1000`).catch(() => null);
  const rows = (d && d.rows) || [];
  let targetId = process.argv[2];
  if (!targetId) {
    const tokenRow = rows.find(r => r.tokenCount > 0 && r.drainable);
    const anyRow = rows.find(r => r.drainable);
    const pick = tokenRow || anyRow;
    if (!pick) { console.error('✗ no drainable box in rent-api right now — pass a boxId explicitly'); process.exit(1); }
    targetId = pick.boxId;
    console.log(`auto-picked ${tokenRow ? 'TOKEN' : 'plain'} target ${targetId.slice(0, 16)}…`);
  }
  const target = await getUtxo(targetId);
  if (!target) { console.error(`✗ target ${targetId.slice(0, 16)}… not in UTXO set (spent?)`); process.exit(1); }
  const age = height - target.creationHeight;
  const fee = factor * BigInt(boxBytes(target));
  console.log(`✓ TARGET: ${targetId.slice(0, 16)}… ${(Number(target.value) / 1e9).toFixed(4)} ERG · ${(target.assets || []).length} token(s) · age ${age} (need ${STORAGE_PERIOD}) · storageFee ${(Number(fee) / 1e9).toFixed(4)} ERG · whole-takeable ${BigInt(target.value) <= fee}`);
  if (age < STORAGE_PERIOD) { console.error('✗ target not expired yet — not storage-rent eligible'); process.exit(1); }

  // 2) co-fund the fee from other drainable dust until totalIn - FEE >= min output
  const batch = [target];
  let totalIn = BigInt(target.value);
  for (const r of rows) {
    if (totalIn - FEE >= 2_000_000n) break;
    if (r.boxId === targetId || !r.drainable) continue;
    const cf = await getUtxo(r.boxId); if (!cf) continue;
    batch.push(cf); totalIn += BigInt(cf.value);
  }
  if (totalIn - FEE < 2_000_000n) { console.error(`✗ not enough co-funding dust (have ${(Number(totalIn) / 1e9).toFixed(4)} ERG) — try again when more boxes are collectable`); process.exit(1); }
  console.log(`✓ CO-FUNDING: ${batch.length - 1} extra dust box(es), totalIn ${(Number(totalIn) / 1e9).toFixed(4)} ERG`);

  // 3) build the empty-proof sweep (identical shape to rent-sweeper buildSweep)
  const tokMap = new Map();
  for (const b of batch) for (const a of (b.assets || [])) tokMap.set(a.tokenId, (tokMap.get(a.tokenId) || 0n) + BigInt(a.amount));
  const outputs = [
    { value: Number(totalIn - FEE), ergoTree: p2pkErgoTree(DEST), creationHeight: height, assets: [...tokMap].map(([tokenId, amount]) => ({ tokenId, amount: Number(amount) })), additionalRegisters: {} },
    { value: Number(FEE), ergoTree: FEE_TREE, creationHeight: height, assets: [], additionalRegisters: {} },
  ];
  const inputs = batch.map(b => ({ boxId: b.boxId, spendingProof: { proofBytes: '', extension: { '127': EXT_OUTPUT0 } } }));
  const finalTx = { inputs, dataInputs: [], outputs };

  // 4) consensus check — no broadcast
  const r = await fetch(`${NODE_URL}/transactions/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalTx) });
  const body = (await r.text()).replace(/"/g, '');
  console.log(r.ok ? `\n✅ VALID — /check accepted: ${body}\n(${tokMap.size} token type(s) preserved into our output. Nothing was broadcast. The token path works.)`
                   : `\n❌ INVALID — /check rejected: ${body}`);
}
main().catch(e => { console.error('probe error:', e.message); process.exit(1); });
