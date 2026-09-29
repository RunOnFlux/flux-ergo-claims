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
const FEE = BigInt(process.env.FEE || 1_000_000);          // 0.001 ERG
const BATCH_CAP = Number(process.env.BATCH_CAP || 20);     // max boxes examined per block
const DUST_CHUNK = Number(process.env.DUST_CHUNK || 1);    // dust boxes per tx — 1 = solo (max win rate: one snipe never voids others)
const MIN_MARGIN = BigInt(process.env.MIN_MARGIN || 2_000_000); // require net >= 0.002 ERG to broadcast
const MIN_BOX_TAKE = BigInt(process.env.MIN_BOX_TAKE || 0);// skip boxes worth less than this (0 = include all)
const KEEP_TOKENS = process.env.KEEP_TOKENS !== '0';       // keep tokens/NFTs (default) vs burn junk
const SWEEP_FUNDED = process.env.SWEEP_FUNDED === '1';     // also collect the ~fee from funded boxes (recreate them)
const SWEEP_DUST = process.env.SWEEP_DUST !== '0';        // race for whole-take dust boxes (hyper-contested; set 0 to focus purely on funded)
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
// mempool-aware: excludes boxes already spent in the mempool (by us OR competitors),
// so we don't re-submit our own pending inputs or race an already-pending spend.
const getUtxo = (boxId) => jget(`${NODE_URL}/utxo/withPool/byId/${boxId}`, { allow404: true });
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

async function buildSweep(boxes, height) {
  const totalIn = boxes.reduce((a, b) => a + BigInt(b.value), 0n);
  const outValue = totalIn - FEE;
  if (outValue < 1_000_000n) throw new Error(`batch self-funds too little (${Number(totalIn) / 1e9} ERG <= fee+min); need more boxes`);

  // aggregate tokens; keep them all (default) or drop = burn (consensus allows it)
  const tokMap = new Map();
  for (const b of boxes) for (const a of (b.assets || [])) tokMap.set(a.tokenId, (tokMap.get(a.tokenId) || 0n) + BigInt(a.amount));
  // node JSON wants value/amount as numbers (all well under 2^53 here)
  const assets = KEEP_TOKENS ? [...tokMap].map(([tokenId, amount]) => ({ tokenId, amount: Number(amount) })) : [];

  const outputs = [
    { value: Number(outValue), ergoTree: p2pkErgoTree(destAddress), creationHeight: height, assets, additionalRegisters: {} },
    { value: Number(FEE), ergoTree: FEE_TREE, creationHeight: height, assets: [], additionalRegisters: {} },
  ];
  const inputs = boxes.map(b => ({ boxId: b.boxId, spendingProof: { proofBytes: '', extension: { '127': EXT_OUTPUT0 } } }));

  const finalTx = { inputs, dataInputs: [], outputs };
  return {
    finalTx, outValue, feePaid: FEE,
    kept: KEEP_TOKENS ? tokMap.size : 0,
    burned: KEEP_TOKENS ? 0 : tokMap.size,
    tokenBoxes: boxes.filter(b => (b.assets || []).length).length,
  };
}

// Funded boxes (value > fee): the protocol only lets us take the storage fee. We
// RECREATE each box (same ergoTree, tokens, R4-R9 registers; value - fee; creation
// height = now) at its own output index, point that input's ctx-var 127 at it, and
// collect the freed fees (Σfee - minerFee) to destAddress. Tokens return to owners.
async function buildFundedSweep(boxes, height) {
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
  const profit = totalFee - FEE;
  if (profit < 1_000_000n) throw new Error(`funded batch profit ${Number(profit) / 1e9} ERG below min output`);
  const outputs = [
    ...recreations,                                                                                   // 0 .. N-1
    { value: Number(profit), ergoTree: p2pkErgoTree(destAddress), creationHeight: height, assets: [], additionalRegisters: {} }, // N: our fee take
    { value: Number(FEE), ergoTree: FEE_TREE, creationHeight: height, assets: [], additionalRegisters: {} },                     // N+1: miner fee
  ];
  return { finalTx: { inputs, dataInputs: [], outputs }, outValue: profit, feePaid: FEE, kept: 0, burned: 0, tokenBoxes: 0 };
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
      for (const b of boxes) inFlight.set(b.boxId, height); // don't re-target until confirmed/dropped
      stats.txsSubmitted++; stats.boxesSwept += boxes.length; stats.boxesTokenBearing += tokenBoxes;
      stats.ergRecoveredNano += Number(outValue); stats.feesPaidNano += Number(feePaid);
      stats.tokensKept += kept; stats.tokensBurned += burned;
      stats[kind === 'funded' ? 'fundedWins' : 'dustWins'] = (stats[kind === 'funded' ? 'fundedWins' : 'dustWins'] || 0) + 1;
      stats.lastTxId = txId; stats.lastSweepAt = new Date().toISOString();
      saveStats(); logLine({ mode: 'live', txId, ...rec });
      console.log(`[${height}] WON ${kind} ${boxes.length} boxes -> ${txId} (+${Number(outValue) / 1e9} ERG)`);
    } catch (e) {
      const lost = /already spent|double|missing/i.test(e.message);
      if (lost) { stats.txsInvalidated++; stats.racesLost = (stats.racesLost || 0) + 1; }
      else stats.txsFailed++;
      saveStats(); logLine({ mode: lost ? 'lost' : 'error', ...rec, error: e.message });
      console.log(`[${height}] ${lost ? 'LOST race' : 'submit error'} (${kind}): ${e.message.replace(/\s+/g, ' ').slice(0, 400)}`);
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

    // Dust (whole-take): most contested. Solo/small chunks, fired in PARALLEL so a
    // snipe on one never blocks the others and we hit the mempool fast. (SWEEP_DUST=0 skips.)
    if (SWEEP_DUST) {
      const chunks = [];
      for (let i = 0; i < dust.length; i += DUST_CHUNK) chunks.push(dust.slice(i, i + DUST_CHUNK));
      await Promise.all(chunks.map(async chunk => {
        const recoverable = chunk.reduce((a, b) => a + BigInt(b.value), 0n);
        if (recoverable - FEE < MIN_MARGIN) return;
        try { await processBatch('dust', chunk, height, await buildSweep(chunk, height)); }
        catch (e) { console.log(`[${height}] dust build skipped: ${e.message}`); }
      }));
    }
    // Funded batch (recreate + collect fee): less contested, steadier wins.
    if (funded.length) {
      try {
        const built = await buildFundedSweep(funded, height);
        if (built.outValue >= MIN_MARGIN) await processBatch('funded', funded, height, built);
        else console.log(`[${height}] funded net ${Number(built.outValue) / 1e9} < margin`);
      } catch (e) { console.log(`[${height}] funded build skipped: ${e.message}`); }
    }
  } catch (e) { console.error('tick error:', e.message); }
  finally { working = false; }
}

// ==================== BOOT ====================
console.log(`rent-sweeper ${DRY_RUN ? '[DRY-RUN]' : '[LIVE]'} node ${NODE_URL} · dest ${destAddress}`);
console.log(`batch<=${BATCH_CAP} · keepTokens=${KEEP_TOKENS} · minMargin=${Number(MIN_MARGIN) / 1e9} ERG`);
saveStats();
tick();
setInterval(tick, POLL_MS);
