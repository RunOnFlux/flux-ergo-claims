#!/usr/bin/env node
/**
 * RENT-SWEEPER — automated storage-rent collector, runs alongside your node
 * =========================================================================
 * Every block: pull currently-collectable boxes, keep the ones that are
 * WHOLE-TAKEABLE (value <= the box's own storage fee), pack a moderate batch,
 * and sweep them into one consolidated output (self-funding from the swept ERG).
 * Records fees paid / ERG recovered / boxes swept to public stats files that
 * rent-api serves.
 *
 * SAFE BY DEFAULT: DRY_RUN=1 builds + logs the intended tx WITHOUT broadcasting.
 * Set DRY_RUN=0 (and SUBMIT=1) only once you've inspected the built txs on your
 * node and are satisfied. Read-only until you do.
 *
 * WHY WHOLE-TAKEABLE ONLY: a box with value <= storageFee (= bytes*storageFeeFactor)
 * can be spent entirely — no recreation required — so it folds cleanly into one
 * output. FUNDED boxes (value > fee) would each need a recreated output carrying
 * their tokens back to the owner and only yield the ~0.13 ERG fee; that mode is a
 * TODO (SWEEP_FUNDED), off by default. Targeting whole-takeable boxes is also the
 * most profitable per box (you keep the entire balance + tokens).
 *
 * STRATEGY (see README): sweep every block (fee is negligible, waiting donates
 * boxes to competitors); cap batch size to limit whole-tx invalidation if a rival
 * snipes one input; fold the previous output box in as an input to consolidate for
 * free; only broadcast when recoverable - fee >= MIN_MARGIN.
 *
 * RUN:  npm install ergo-lib-wasm-nodejs
 *       SWEEP_MNEMONIC="..." DRY_RUN=1 node rent-sweeper.js
 */

const fs = require('fs');
const path = require('path');
let ergoLib;
try { ergoLib = require('ergo-lib-wasm-nodejs'); }
catch { console.error('Run: npm install ergo-lib-wasm-nodejs'); process.exit(1); }

// ==================== CONFIG ====================
const NODE_URL = (process.env.ERGO_NODE_URL || 'http://127.0.0.1:9053').replace(/\/$/, '');
const HOST = NODE_URL;
const RENT_API = (process.env.RENT_API_URL || 'http://127.0.0.1:8480').replace(/\/$/, '');
const MNEMONIC = process.env.SWEEP_MNEMONIC || '';
const PRIVKEY = (process.env.SWEEP_PRIVATE_KEY || '').trim().replace(/^0x/, ''); // raw dlog secret, hex
const SAFE_ADDRESS = process.env.SAFE_ADDRESS || '';       // where swept funds go (default: wallet addr)
const DRY_RUN = process.env.DRY_RUN !== '0';               // default SAFE: don't broadcast
// Base/first-bid fee. Mempool replacement is STRICTLY greater weight (fee/byte), so a
// tx at the exact 0.001 default TIES other default-fee bots and loses. Default just
// above 0.001 to out-weight them on the FIRST attempt (no waiting for escalation).
const FEE = BigInt(process.env.FEE || 1_100_000);          // 0.0011 ERG
const BATCH_CAP = Number(process.env.BATCH_CAP || 20);     // max boxes examined per block
const DUST_CHUNK = Number(process.env.DUST_CHUNK || 1);    // dust boxes per tx — 1 = solo (max win rate: one snipe never voids others)
const MIN_MARGIN = BigInt(process.env.MIN_MARGIN || 2_000_000); // require net >= 0.002 ERG to broadcast
const MIN_BOX_TAKE = BigInt(process.env.MIN_BOX_TAKE || 0);// skip boxes worth less than this (0 = include all)
const KEEP_TOKENS = process.env.KEEP_TOKENS !== '0';       // keep tokens/NFTs (default) vs burn junk
const SWEEP_FUNDED = process.env.SWEEP_FUNDED === '1';     // also collect the ~fee from funded boxes (recreate them)
const SWEEP_DUST = process.env.SWEEP_DUST !== '0';        // race for whole-take dust boxes (hyper-contested; set 0 to focus purely on funded)
// Ergo mempool does fee-based replacement: your tx replaces a conflicting one if its
// fee/byte weight is higher. So on a lost box we escalate its fee (capped at a fraction
// of the box's value, so a win is always profitable).
const BID_ESCALATE = Number(process.env.BID_ESCALATE || 1.6);        // fee multiplier per loss
const BID_MAX_FRACTION = Number(process.env.BID_MAX_FRACTION || 0.4); // never bid more than this share of box value
const bidFee = new Map(); // boxId -> current fee (nanoERG, BigInt)
const VERBOSE = process.env.VERBOSE !== '0'; // per-box logs: competitor fee, our bid, win/lose reason
const POLL_MS = Number(process.env.POLL_MS || 1_500);      // fast block detection — act the instant a block lands
const STATS_FILE = path.join(__dirname, 'sweeper-stats.json');
const LOG_FILE = path.join(__dirname, 'sweeper-log.jsonl');
const STORAGE_PERIOD = 1_051_200;

if (!MNEMONIC && !PRIVKEY) { console.error('Set SWEEP_MNEMONIC or SWEEP_PRIVATE_KEY (funds the tx / receives sweeps).'); process.exit(1); }

// ==================== NODE / API ====================
async function jget(url, { allow404 = false } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'rent-sweeper/1.0' } });
  if (r.status === 404 && allow404) return null;
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
const getInfo = () => jget(`${NODE_URL}/info`);

// Scan the whole mempool once and map each spent input boxId -> the competing tx's
// fee and size, so we can read a rival's exact fee/byte and bid just above it.
async function fetchMempoolConflicts() {
  const map = new Map();
  try {
    for (let off = 0, p = 0; p < 20; p++, off += 100) {
      const txs = await jget(`${NODE_URL}/transactions/unconfirmed?limit=100&offset=${off}`);
      const arr = Array.isArray(txs) ? txs : (txs && txs.items) || [];
      if (!arr.length) break;
      for (const t of arr) {
        const fee = (t.outputs || []).filter(o => (o.ergoTree || '').startsWith('1005040004000e36'))
          .reduce((a, o) => a + Number(o.value), 0);
        const size = t.size || 300;
        for (const inp of t.inputs || []) if (!map.has(inp.boxId)) map.set(inp.boxId, { fee, size, weight: fee / size });
      }
      if (arr.length < 100) break;
    }
  } catch (e) { if (VERBOSE) console.log(`  [mempool] scan failed: ${e.message}`); }
  return map;
}

// CONFIRMED UTXO set (not withPool): we WANT to still see boxes sitting in a rival's
// mempool tx so we can out-bid and replace them (Ergo fee-replacement). A box that is
// truly mined-spent 404s here and is skipped. Our own pending txs are avoided via the
// inFlight guard (set on wins), not by hiding mempool-spent boxes.
const getUtxo = (boxId) => jget(`${NODE_URL}/utxo/byId/${boxId}`, { allow404: true });
async function submitTx(txJson) {
  const r = await fetch(`${NODE_URL}/transactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txJson),
  });
  const body = await r.text();
  if (!r.ok) { let d = body; try { d = JSON.parse(body).detail || body; } catch {} throw new Error(`submit ${r.status}: ${d}`); }
  return body.replace(/"/g, '');
}
// Full consensus validation WITHOUT broadcasting: the node checks signatures, the
// storage-rent age rule, token balance and fee, and returns the txId if valid.
async function checkTx(txJson) {
  const r = await fetch(`${NODE_URL}/transactions/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txJson),
  });
  const body = await r.text();
  return { valid: r.ok, detail: body.replace(/"/g, '') };
}

// ==================== WALLET ====================
// Accepts EITHER a raw dlog private key (SWEEP_PRIVATE_KEY, hex) or a BIP39
// mnemonic (SWEEP_MNEMONIC). The key/seed only ever lives in this host's env.
let wallet, myAddress;
if (PRIVKEY) {
  const bytes = Uint8Array.from(Buffer.from(PRIVKEY, 'hex'));   // 32-byte secret => 64 hex chars
  const sk = ergoLib.SecretKey.dlog_from_bytes(bytes);          // build the secret directly
  const secretKeys = new ergoLib.SecretKeys(); secretKeys.add(sk);
  wallet = ergoLib.Wallet.from_secrets(secretKeys);
  myAddress = sk.get_address().to_base58(ergoLib.NetworkPrefix.Mainnet);
} else {
  const seed = ergoLib.Mnemonic.to_seed(MNEMONIC, '');
  const rootSecret = ergoLib.ExtSecretKey.derive_master(seed);
  const secretKey = rootSecret.derive(ergoLib.DerivationPath.from_string("m/44'/429'/0'/0/0"));
  const secretKeys = new ergoLib.SecretKeys(); secretKeys.add(secretKey.secret_key());
  wallet = ergoLib.Wallet.from_secrets(secretKeys);
  myAddress = secretKey.public_key().to_address().to_base58(ergoLib.NetworkPrefix.Mainnet);
}
const destAddress = SAFE_ADDRESS || myAddress;

// ==================== STATS ====================
let stats = loadStats();
function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch { return {
    startedAt: new Date().toISOString(), updatedAt: null, mode: DRY_RUN ? 'dry-run' : 'live',
    dest: destAddress, txsSubmitted: 0, txsInvalidated: 0, txsFailed: 0,
    boxesSwept: 0, boxesTokenBearing: 0, ergRecoveredNano: 0, feesPaidNano: 0,
    tokensKept: 0, tokensBurned: 0, netProfitNano: 0, lastTxId: null, lastSweepAt: null,
  }; }
}
function saveStats() {
  stats.updatedAt = new Date().toISOString();
  stats.mode = DRY_RUN ? 'dry-run' : 'live';
  stats.netProfitNano = stats.ergRecoveredNano - stats.feesPaidNano;
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); } catch (e) { console.error('stats write:', e.message); }
}
function logLine(obj) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + '\n'); } catch {}
}

// ==================== ELIGIBILITY / SELECTION ====================
let storageFeeFactor = 1_250_000n; // refreshed from node params

function boxBytesLen(boxJson) {
  const b = ergoLib.ErgoBox.from_json(JSON.stringify(boxJson));
  return b.sigma_serialize_bytes().length;
}
// storage fee owed by a box (nanoERG) = bytes * storageFeeFactor
function storageFee(boxJson) { return storageFeeFactor * BigInt(boxBytesLen(boxJson)); }
// whole-takeable iff value <= its storage fee
function wholeTakeable(boxJson) { return BigInt(boxJson.value) <= storageFee(boxJson); }
// serialized SShort constant for a small non-negative index (zigzag: n -> 2n; single VLQ byte for n < 64)
function sshortExt(i) { return '03' + ((2 * i) & 0xff).toString(16).padStart(2, '0'); }

const inFlight = new Map(); // boxId -> height we submitted it; avoids re-targeting our own pending inputs

async function candidates(height) {
  // rent-api gives collectable boxes network-wide; re-verify each against the UTXO
  // set (still unspent) and classify by whether it's whole-takeable or funded.
  const diag = { apiReachable: true, collectable: 0, sniped: 0, fundedSkipped: 0, tooSmall: 0, notEligible: 0, inflight: 0 };
  let d;
  try { d = await jget(`${RENT_API}/rent/boxes?status=collectable&limit=1000`); }
  catch { diag.apiReachable = false; return { dust: [], funded: [], diag }; }
  const rows = (d && d.rows) || [];
  diag.collectable = rows.length;
  // skip our own pending, then check all UTXOs in PARALLEL (speed: no per-box lag)
  const fresh = rows.filter(r => !(inFlight.has(r.boxId) && height - inFlight.get(r.boxId) < 3));
  diag.inflight = rows.length - fresh.length;
  const boxes = await Promise.all(fresh.map(r => getUtxo(r.boxId).catch(() => null)));
  const dust = [], funded = [];
  for (const box of boxes) {
    if (dust.length + funded.length >= BATCH_CAP) break;
    if (!box) { diag.sniped++; continue; }       // 404 => spent (mempool-aware)
    if (box.creationHeight != null && height - box.creationHeight < STORAGE_PERIOD) { diag.notEligible++; continue; }
    if (wholeTakeable(box)) {                     // value <= fee: take the whole box
      if (BigInt(box.value) < MIN_BOX_TAKE) { diag.tooSmall++; continue; }
      dust.push(box);
    } else if (SWEEP_FUNDED) {                     // value > fee: recreate + collect the fee
      funded.push(box);
    } else { diag.fundedSkipped++; }
  }
  return { dust, funded, diag };
}

// ==================== TX BUILD ====================
// Whole-takeable storage-rent spend, built as raw tx JSON (no TxBuilder / no signing
// needed — the batch self-funds and rent inputs use empty proofs). Per sigma-rust
// storage_rent.rs: an expired box (age >= STORAGE_PERIOD) with value <= its storage
// fee is spendable with an EMPTY proof plus context-extension var 127 (STORAGE_
// EXTENSION_INDEX = i8::MAX) set to the output index (SShort). We point every rent
// input at output 0 (our consolidated box). SShort(0) serializes to "0300".
const FEE_TREE = '1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304';
const EXT_OUTPUT0 = '0300'; // serialized SShort constant, value 0 -> output index 0

function p2pkErgoTree(addrB58) {
  const a = ergoLib.Address.from_base58(addrB58);
  return '0008cd' + Buffer.from(a.content_bytes()).toString('hex'); // P2PK: 0008cd + 33-byte pubkey
}

// current bid fee for a box (escalates each time we lose it), and the escalation on loss.
// `take` = what WE collect from this box (dust: whole value; funded: the storage fee),
// so the cap is a share of our actual take, never the box's face value.
const getBid = (box) => bidFee.get(box.boxId) || FEE;
function escalateBid(box, take) {
  const cur = getBid(box);
  const cap = BigInt(Math.floor(Number(take) * BID_MAX_FRACTION));
  let next = BigInt(Math.floor(Number(cur) * BID_ESCALATE));
  if (next > cap) next = cap;
  if (next > cur) bidFee.set(box.boxId, next); // else already at cap — competitor values it more than we can pay
}
// Pick the fee for a box: max of (escalated floor, just-above any rival in the mempool),
// capped at a share of our take. Returns { fee, cap, rival } for logging/decisions.
function chooseFee(box, take, conflicts, kind) {
  const cap = BigInt(Math.floor(Number(take) * BID_MAX_FRACTION));
  let fee = getBid(box);                                   // floor from prior losses
  const rival = conflicts.get(box.boxId);
  let ourSize = 300;
  if (rival) {
    // Ergo replaces on WEIGHT (fee/byte), not fee. Our tx bytes ≈ box bytes (dust) or
    // ~2× (funded recreates the box). Bid to out-weight them for OUR size, +8% margin.
    const bb = boxBytesLen(box);
    ourSize = (kind === 'funded' ? 2 * bb : bb) + 240;
    const beat = BigInt(Math.ceil(rival.weight * ourSize * 1.08)) + 2000n;
    if (beat > fee) fee = beat;
  }
  if (fee < FEE) fee = FEE;
  const capped = fee > cap;
  if (capped) fee = cap;
  // winnable iff our resulting weight (fee/byte) beats the rival's
  const winnable = !rival || (Number(fee) / ourSize) > rival.weight;
  return { fee, cap, rival, capped, winnable };
}

async function buildSweep(boxes, height, fee = FEE) {
  const totalIn = boxes.reduce((a, b) => a + BigInt(b.value), 0n);
  const outValue = totalIn - fee;
  if (outValue < 1_000_000n) throw new Error(`batch self-funds too little (${Number(totalIn) / 1e9} ERG <= fee+min); need more boxes`);

  // aggregate tokens; keep them all (default) or drop = burn (consensus allows it)
  const tokMap = new Map();
  for (const b of boxes) for (const a of (b.assets || [])) tokMap.set(a.tokenId, (tokMap.get(a.tokenId) || 0n) + BigInt(a.amount));
  // node JSON wants value/amount as numbers (all well under 2^53 here)
  const assets = KEEP_TOKENS ? [...tokMap].map(([tokenId, amount]) => ({ tokenId, amount: Number(amount) })) : [];

  const outputs = [
    { value: Number(outValue), ergoTree: p2pkErgoTree(destAddress), creationHeight: height, assets, additionalRegisters: {} },
    { value: Number(fee), ergoTree: FEE_TREE, creationHeight: height, assets: [], additionalRegisters: {} },
  ];
  const inputs = boxes.map(b => ({ boxId: b.boxId, spendingProof: { proofBytes: '', extension: { '127': EXT_OUTPUT0 } } }));

  const finalTx = { inputs, dataInputs: [], outputs };
  return {
    finalTx, outValue, feePaid: fee,
    kept: KEEP_TOKENS ? tokMap.size : 0,
    burned: KEEP_TOKENS ? 0 : tokMap.size,
    tokenBoxes: boxes.filter(b => (b.assets || []).length).length,
  };
}

// Funded boxes (value > fee): the protocol only lets us take the storage fee. We
// RECREATE each box (same ergoTree, tokens, R4-R9 registers; value - fee; creation
// height = now) at its own output index, point that input's ctx-var 127 at it, and
// collect the freed fees (Σfee - minerFee) to destAddress. Tokens return to owners.
async function buildFundedSweep(boxes, height, minerFee = FEE) {
  const recreations = [], inputs = [];
  let totalFee = 0n;
  for (const b of boxes) {
    const fee = storageFee(b);
    const keepVal = BigInt(b.value) - fee;            // recreated value (minimum allowed = value - fee)
    if (keepVal < 1_000_000n) continue;               // recreation would fall below min box value — skip
    const idx = recreations.length;                   // this box's recreation output index
    recreations.push({
      // storage-rent check requires the recreation's creationHeight == the validation
      // height, which is the NEXT block (fullHeight + 1), not the current tip.
      value: Number(keepVal), ergoTree: b.ergoTree, creationHeight: height + 1,
      assets: (b.assets || []).map(a => ({ tokenId: a.tokenId, amount: Number(a.amount) })),
      additionalRegisters: b.additionalRegisters || {},
    });
    inputs.push({ boxId: b.boxId, spendingProof: { proofBytes: '', extension: { '127': sshortExt(idx) } } });
    totalFee += fee;
  }
  if (!inputs.length) throw new Error('no funded boxes recreatable (all near fee boundary)');
  const profit = totalFee - minerFee;
  if (profit < 1_000_000n) throw new Error(`funded profit ${Number(profit) / 1e9} ERG below min output (fee bid too high)`);
  const outputs = [
    ...recreations,                                                                                   // 0 .. N-1
    { value: Number(profit), ergoTree: p2pkErgoTree(destAddress), creationHeight: height, assets: [], additionalRegisters: {} }, // N: our fee take
    { value: Number(minerFee), ergoTree: FEE_TREE, creationHeight: height, assets: [], additionalRegisters: {} },                // N+1: miner fee
  ];
  return { finalTx: { inputs, dataInputs: [], outputs }, outValue: profit, feePaid: minerFee, kept: 0, burned: 0, tokenBoxes: 0, totalFee };
}

// ==================== BLOCK LOOP ====================
// Process one built batch: validate (dry-run) or submit (live), update stats.
async function processBatch(kind, boxes, height, built) {
  const { finalTx, outValue, feePaid, kept, burned, tokenBoxes } = built;
  const rec = { kind, height, boxes: boxes.length, tokenBoxes, takeNano: outValue.toString(), feeNano: feePaid.toString(), kept, burned };
  if (DRY_RUN) {
    const chk = await checkTx(finalTx);   // full consensus validation, no broadcast
    stats.dryRunChecks = (stats.dryRunChecks || 0) + 1;
    stats.dryRunValid = (stats.dryRunValid || 0) + (chk.valid ? 1 : 0);
    saveStats();
    console.log(`[${height}] DRY-RUN ${kind} ${boxes.length} boxes, take ${Number(outValue) / 1e9} ERG — /check: ${chk.valid ? 'VALID ✓ ' + chk.detail : 'INVALID ✗ ' + chk.detail}`);
    logLine({ mode: 'dry-run', check: chk.valid ? 'valid' : 'invalid', checkDetail: chk.detail, ...rec });
  } else {
    try {
      const txId = await submitTx(finalTx);
      for (const b of boxes) { inFlight.set(b.boxId, height); bidFee.delete(b.boxId); } // won: stop tracking/bidding it
      stats.txsSubmitted++; stats.boxesSwept += boxes.length; stats.boxesTokenBearing += tokenBoxes;
      stats.ergRecoveredNano += Number(outValue); stats.feesPaidNano += Number(feePaid);
      stats.tokensKept += kept; stats.tokensBurned += burned;
      stats[kind === 'funded' ? 'fundedWins' : 'dustWins'] = (stats[kind === 'funded' ? 'fundedWins' : 'dustWins'] || 0) + 1;
      stats.lastTxId = txId; stats.lastSweepAt = new Date().toISOString();
      saveStats(); logLine({ mode: 'live', txId, ...rec });
      console.log(`[${height}] ✅ WON ${kind} ${boxes[0].boxId.slice(0, 10)}… +${(Number(outValue) / 1e9).toFixed(4)} ERG (fee ${(Number(feePaid) / 1e9).toFixed(4)}) -> ${txId.slice(0, 12)}…`);
    } catch (e) {
      const lost = /already spent|double|missing/i.test(e.message);
      if (lost) {
        stats.txsInvalidated++; stats.racesLost = (stats.racesLost || 0) + 1;
        for (const b of boxes) escalateBid(b, kind === 'funded' ? storageFee(b) : BigInt(b.value)); // out-bid next block
      } else stats.txsFailed++;
      const reason = e.message.replace(/\s+/g, ' ').replace(/^submit \d+: /, '').slice(0, 160);
      saveStats(); logLine({ mode: lost ? 'lost' : 'error', ...rec, error: e.message });
      console.log(`[${height}] ${lost ? '❌ LOST' : '⚠ ERR '} ${kind} ${boxes[0].boxId.slice(0, 10)}… — ${reason}`);
    }
  }
}

let lastHeight = 0, working = false;
async function tick() {
  if (working) return; working = true;
  try {
    const info = await getInfo();
    const height = info.fullHeight;
    if (info.parameters && info.parameters.storageFeeFactor) storageFeeFactor = BigInt(info.parameters.storageFeeFactor);
    if (height === lastHeight) { working = false; return; }
    lastHeight = height;
    for (const [id, h] of inFlight) if (height - h >= 3) inFlight.delete(id); // prune confirmed/dropped

    const { dust, funded, diag } = await candidates(height);
    if (!dust.length && !funded.length) {
      if (!diag.apiReachable) console.log(`[${height}] rent-api UNREACHABLE at ${RENT_API} — running on this host? (set RENT_API_URL)`);
      else console.log(`[${height}] nothing · collectable ${diag.collectable} → funded-skipped ${diag.fundedSkipped}, spent ${diag.sniped}, in-flight ${diag.inflight}, below-min ${diag.tooSmall}, not-eligible ${diag.notEligible}`);
      working = false; return;
    }

    // Read the whole mempool once so we can bid just above each rival's exact fee.
    const conflicts = await fetchMempoolConflicts();
    if (VERBOSE) console.log(`[${height}] dust ${dust.length} · funded ${funded.length} · mempool rivals ${conflicts.size}`);

    // One solo tx per box, fired in parallel. `take` = what WE collect (dust: whole
    // value; funded: the storage fee), which sets both the profit and the bid cap.
    const attempt = async (kind, box, take, buildFn) => {
      const { fee, cap, rival, capped, winnable } = chooseFee(box, take, conflicts, kind);
      const net = take - fee;
      const tag = `${kind} ${box.boxId.slice(0, 10)}…`;
      if (!winnable) { // even at our cap, our fee/byte can't beat the rival's weight
        if (VERBOSE) console.log(`  SKIP ${tag}: rival weight ${rival.weight.toFixed(0)} > our best (fee ${(Number(fee) / 1e9).toFixed(4)}, cap ${(Number(cap) / 1e9).toFixed(4)}) — can't out-weight profitably`);
        return;
      }
      if (net < MIN_MARGIN) {
        if (VERBOSE) console.log(`  SKIP ${tag}: net ${(Number(net) / 1e9).toFixed(4)} < margin` +
          (rival ? ` (rival fee ${(rival.fee / 1e9).toFixed(4)}, need > cap ${(Number(cap) / 1e9).toFixed(4)})` : ''));
        return;
      }
      if (VERBOSE) console.log(`  BID  ${tag}: take ${(Number(take) / 1e9).toFixed(4)} · fee ${(Number(fee) / 1e9).toFixed(4)}` +
        (rival ? ` vs rival ${(rival.fee / 1e9).toFixed(4)} (w ${rival.weight.toFixed(1)})` : ' (no rival — first in)') + (capped ? ' [CAPPED]' : ''));
      try { await processBatch(kind, [box], height, await buildFn(fee)); }
      catch (e) { console.log(`  SKIP ${tag}: build failed — ${e.message}`); }
    };

    const jobs = [];
    if (SWEEP_DUST) for (const box of dust) jobs.push(attempt('dust', box, BigInt(box.value), fee => buildSweep([box], height, fee)));
    for (const box of funded) jobs.push(attempt('funded', box, storageFee(box), fee => buildFundedSweep([box], height, fee)));
    await Promise.all(jobs);
  } catch (e) { console.error('tick error:', e.message); }
  finally { working = false; }
}

// ==================== BOOT ====================
console.log(`rent-sweeper ${DRY_RUN ? '[DRY-RUN]' : '[LIVE]'} node ${NODE_URL} · dest ${destAddress}`);
console.log(`batch<=${BATCH_CAP} · keepTokens=${KEEP_TOKENS} · minMargin=${Number(MIN_MARGIN) / 1e9} ERG`);
saveStats();
tick();
setInterval(tick, POLL_MS);
