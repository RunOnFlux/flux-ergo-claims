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
const BATCH_CAP = Number(process.env.BATCH_CAP || 20);     // boxes per tx (limit snipe blast radius)
const MIN_MARGIN = BigInt(process.env.MIN_MARGIN || 2_000_000); // require net >= 0.002 ERG to broadcast
const MIN_BOX_TAKE = BigInt(process.env.MIN_BOX_TAKE || 0);// skip boxes worth less than this (0 = include all)
const KEEP_TOKENS = process.env.KEEP_TOKENS !== '0';       // keep tokens/NFTs (default) vs burn junk
const POLL_MS = Number(process.env.POLL_MS || 20_000);
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
const getUtxo = (boxId) => jget(`${NODE_URL}/utxo/byId/${boxId}`, { allow404: true });
async function submitTx(txJson) {
  const r = await fetch(`${NODE_URL}/transactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(txJson),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`submit ${r.status}: ${body}`);
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
// whole-takeable iff value <= storageFeeFactor * boxBytes
function wholeTakeable(boxJson) {
  const fee = storageFeeFactor * BigInt(boxBytesLen(boxJson));
  return BigInt(boxJson.value) <= fee;
}

async function candidates(height) {
  // rent-api gives collectable boxes network-wide; re-verify each against the UTXO
  // set (still unspent) and confirm whole-takeable via its real byte size.
  const d = await jget(`${RENT_API}/rent/boxes?status=collectable&limit=1000`).catch(() => null);
  const rows = (d && d.rows) || [];
  const out = [];
  for (const r of rows) {
    if (out.length >= BATCH_CAP) break;
    const box = await getUtxo(r.boxId);          // 404 => already swept by someone
    if (!box) continue;
    if (box.creationHeight != null && height - box.creationHeight < STORAGE_PERIOD) continue; // guard
    if (!wholeTakeable(box)) continue;           // funded box -> skip (needs recreation)
    if (BigInt(box.value) < MIN_BOX_TAKE) continue;
    out.push(box);
  }
  return out;
}

// ==================== TX BUILD ====================
// Build a sweep of whole-takeable boxes into one consolidated output at destAddress.
// Rent inputs carry empty proofs (age rule); a wallet funding box signs the tx and
// also consolidates. Tokens are kept (default) or burned (KEEP_TOKENS=0).
async function buildSweep(boxes, height, stateCtx) {
  // gather wallet funding box (also serves as the consolidation seed)
  const mine = await jget(`${NODE_URL}/wallet/boxes/unspent?minConfirmations=1&minInclusionHeight=0`).catch(() => null);
  // fall back to explorer-style if node wallet API not enabled:
  let funding = null;
  if (mine && mine.length) funding = mine[0].box || mine[0];
  if (!funding) {
    const bx = await jget(`${NODE_URL}/blockchain/box/unspent/byAddress`, {}).catch(() => null); // may 404
    funding = bx && bx.items && bx.items[0];
  }
  if (!funding) throw new Error('no wallet funding box found (enable node wallet API or set a funded address)');

  const allIn = [...boxes, funding];
  const inputs = ergoLib.ErgoBoxes.from_boxes(allIn.map(b => ergoLib.ErgoBox.from_json(JSON.stringify(b))));

  const totalIn = allIn.reduce((a, b) => a + BigInt(b.value), 0n);
  const outValue = totalIn - FEE;
  if (outValue < 1_000_000n) throw new Error('output below min box value');

  // aggregate tokens across swept boxes + funding
  const tokMap = new Map();
  for (const b of allIn) for (const a of (b.assets || [])) tokMap.set(a.tokenId, (tokMap.get(a.tokenId) || 0n) + BigInt(a.amount));

  const outB = new ergoLib.ErgoBoxCandidateBuilder(
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(outValue.toString())),
    ergoLib.Address.from_base58(destAddress).to_ergo_tree(), height);

  let kept = 0, burned = 0, burnTokens = [];
  for (const [tid, amt] of tokMap) {
    if (KEEP_TOKENS) {
      outB.add_token(ergoLib.TokenId.from_str(tid), ergoLib.TokenAmount.from_i64(ergoLib.I64.from_str(amt.toString())));
      kept++;
    } else { burnTokens.push({ tid, amt }); burned++; }
  }
  const outputs = ergoLib.ErgoBoxCandidates.from_boxes([outB.build()]);

  const txb = ergoLib.TxBuilder.new(
    new ergoLib.BoxSelection(inputs, new ergoLib.ErgoBoxAssetsDataList()),
    outputs, height,
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(FEE.toString())),
    ergoLib.Address.from_base58(destAddress));
  // NOTE: to burn tokens (KEEP_TOKENS=0) some ergo-lib versions need a burn permit,
  // e.g. txb.set_token_burn_permit(<Tokens>). Left explicit for you to wire to your version.
  const unsigned = txb.build();

  // per-input proofs: sign only inputs we own; rent inputs -> empty proof
  const dataInputs = ergoLib.ErgoBoxes.from_boxes([]);
  const uj = JSON.parse(unsigned.to_json());
  const signedInputs = uj.inputs.map((inp, idx) => {
    try {
      const si = wallet.sign_transaction_input(stateCtx, unsigned, inputs, dataInputs, idx);
      return { boxId: inp.boxId, spendingProof: JSON.parse(si.to_json()).spendingProof };
    } catch {
      return { boxId: inp.boxId, spendingProof: { proofBytes: '', extension: {} } };
    }
  });
  const finalTx = { inputs: signedInputs, dataInputs: uj.dataInputs || [], outputs: uj.outputs };
  return { finalTx, outValue, feePaid: FEE, kept, burned, tokenBoxes: boxes.filter(b => (b.assets || []).length).length };
}

// ==================== BLOCK LOOP ====================
let lastHeight = 0, working = false;
async function tick() {
  if (working) return; working = true;
  try {
    const info = await getInfo();
    const height = info.fullHeight;
    if (info.parameters && info.parameters.storageFeeFactor) storageFeeFactor = BigInt(info.parameters.storageFeeFactor);
    if (height === lastHeight) { working = false; return; }
    lastHeight = height;

    const boxes = await candidates(height);
    if (!boxes.length) { console.log(`[${height}] nothing whole-takeable`); working = false; return; }

    const recoverable = boxes.reduce((a, b) => a + BigInt(b.value), 0n);
    if (recoverable - FEE < MIN_MARGIN) { console.log(`[${height}] ${boxes.length} boxes but net < margin`); working = false; return; }

    const stateCtx = buildStateCtx(await jget(`${NODE_URL}/blocks/lastHeaders/10`));
    const { finalTx, outValue, feePaid, kept, burned, tokenBoxes } = await buildSweep(boxes, height, stateCtx);

    const rec = { height, boxes: boxes.length, tokenBoxes, recoverableNano: recoverable.toString(), feeNano: feePaid.toString(), kept, burned };
    if (DRY_RUN) {
      // Ask the node to fully validate the assembled tx (no broadcast). This is the
      // end-to-end correctness check: valid=true means it WOULD be accepted on-chain.
      const chk = await checkTx(finalTx);
      stats.dryRunChecks = (stats.dryRunChecks || 0) + 1;
      stats.dryRunValid = (stats.dryRunValid || 0) + (chk.valid ? 1 : 0);
      saveStats();
      console.log(`[${height}] DRY-RUN ${boxes.length} boxes, recover ${Number(recoverable) / 1e9} ERG — node /check: ${chk.valid ? 'VALID ✓ ' + chk.detail : 'INVALID ✗ ' + chk.detail}`);
      logLine({ mode: 'dry-run', check: chk.valid ? 'valid' : 'invalid', checkDetail: chk.detail, ...rec });
    } else {
      try {
        const txId = await submitTx(finalTx);
        stats.txsSubmitted++; stats.boxesSwept += boxes.length; stats.boxesTokenBearing += tokenBoxes;
        stats.ergRecoveredNano += Number(recoverable); stats.feesPaidNano += Number(feePaid);
        stats.tokensKept += kept; stats.tokensBurned += burned; stats.lastTxId = txId; stats.lastSweepAt = new Date().toISOString();
        saveStats(); logLine({ mode: 'live', txId, ...rec });
        console.log(`[${height}] swept ${boxes.length} boxes -> ${txId} (+${Number(recoverable) / 1e9} ERG)`);
      } catch (e) {
        const invalid = /already spent|double|missing/i.test(e.message);
        if (invalid) stats.txsInvalidated++; else stats.txsFailed++;
        saveStats(); logLine({ mode: 'error', height, error: e.message });
        console.log(`[${height}] submit failed (${invalid ? 'sniped/invalid' : 'error'}): ${e.message}`);
      }
    }
  } catch (e) { console.error('tick error:', e.message); }
  finally { working = false; }
}

function buildStateCtx(headers) {
  const bh = ergoLib.BlockHeaders.from_json(headers);
  const pre = ergoLib.PreHeader.from_block_header(bh.get(0));
  // Newer ergo-lib requires a Parameters instance as the 3rd arg.
  const params = ergoLib.Parameters.default_parameters();
  return new ergoLib.ErgoStateContext(pre, bh, params);
}

// ==================== BOOT ====================
console.log(`rent-sweeper ${DRY_RUN ? '[DRY-RUN]' : '[LIVE]'} node ${NODE_URL} · dest ${destAddress}`);
console.log(`batch<=${BATCH_CAP} · keepTokens=${KEEP_TOKENS} · minMargin=${Number(MIN_MARGIN) / 1e9} ERG`);
saveStats();
tick();
setInterval(tick, POLL_MS);
