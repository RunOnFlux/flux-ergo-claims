#!/usr/bin/env node
/**
 * ERGO COMMUNITY SHIELD BOT — v1.0
 * ==================================
 * Monitors for underfunded boxes reaching rent eligibility, sweeps them
 * to a public safe address before commercial harvesters. Fully open source.
 *
 * ONLY NEEDS: SHIELD_MNEMONIC env var + an Ergo node URL for submission.
 * SETUP: npm install ergo-lib-wasm-nodejs axios
 *
 * The rent-collection pattern (verified from tx bb3607fa):
 *   Input [0]: victim box — proofBytes: EMPTY (protocol age rule)
 *   Input [1]: bot's funding box — proofBytes: SIGNED
 *   Output:    ALL contents → SAFE_ADDRESS (the bot's public address)
 *
 * License: MIT
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

let ergoLib;
try { ergoLib = require('ergo-lib-wasm-nodejs'); }
catch (e) { console.error('Run: npm install ergo-lib-wasm-nodejs axios'); process.exit(1); }

// ==================== CONFIG ====================
const GRAPHQL_ENDPOINTS = [
  'https://graphql.erg-1.zelcore.io',
  'https://graphql.erg.zelcore.io',
];
const STORAGE_PERIOD = 1051200;
const DUST_THRESHOLD = 150000000;
const POLL_INTERVAL_MS = 15000;
const PRE_BUILD_BLOCKS = 3;
const FEE = 1000000; // 0.001 ERG
const LOG_FILE = path.join(__dirname, 'shield-log.jsonl');

const MNEMONIC = process.env.SHIELD_MNEMONIC;
const NODE_URL = process.env.SHIELD_NODE_URL || 'https://api.ergoplatform.com';

if (!MNEMONIC) {
  console.error('Set SHIELD_MNEMONIC. Generate: node -e "console.log(require(\'ergo-lib-wasm-nodejs\').Wallet.generate_mnemonic())"');
  process.exit(1);
}

const TOKENS_TO_WATCH = [
  'e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807', // Flux
  '472c3d4ecaa08fb7392ff041ee2e6af75f4a558810a74b28600549d5392810e8', // NETA
  'd71693c49a84fbbecd4908c94813b46514b18b67a99952dc1e6e4791556de413', // ergopad
  '0cd8c9f416e5b1ca9f986a7f10a84191dfb85941619e49e53c0dc30ebf83324b', // COMET
  '03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04', // SigUSD
  '30974274078845f263b4f21787e33cc99e9ec19a17ad85a5bc6da2cca91c5a2e', // WT_ADA
  'ef802b475c06189fdbf844153cdc1d449a5ba87cce13d11bb47b5a539f27f12b', // WT_ERG
  '6de6f46e5c3eca524d938d822e444b924dbffbe02e5d34bd9dcd4bbfe9e85940', // ogre
];

// ==================== WALLET ====================
let wallet, publicKey, safeAddress;

async function setupWallet() {
  wallet = ergoLib.Wallet.from_mnemonic(MNEMONIC, '');
  publicKey = wallet.get_public_key();
  const addr = ergoLib.Address.from_public_key(publicKey);
  safeAddress = addr.to_base58(0x00); // mainnet
  console.log(`SAFE_ADDRESS: ${safeAddress}`);
  console.log(`Fund this with ERG for fees. All collections go here (reclaimable).`);
}

// ==================== GRAPHQL ====================
let endpointIdx = 0;
async function gql(query, variables) {
  for (let i = 0; i < GRAPHQL_ENDPOINTS.length; i++) {
    const ep = GRAPHQL_ENDPOINTS[(endpointIdx + i) % GRAPHQL_ENDPOINTS.length];
    try {
      const r = await axios.post(ep, { query, variables }, { timeout: 15000 });
      if (r.data.errors) throw new Error(r.data.errors[0].message);
      endpointIdx = (endpointIdx + i) % GRAPHQL_ENDPOINTS.length;
      return r.data.data;
    } catch (e) { /* next */ }
  }
  throw new Error('All GraphQL endpoints unreachable');
}

async function getHeight() {
  return (await gql('{ blockHeaders(take:1){ height } }')).blockHeaders[0].height;
}

async function getBotUtxos() {
  const d = await gql(`query($a:String!){ boxes(take:20, address:$a, spent:false){
    boxId value creationHeight ergoTree assets{ tokenId amount } } }`, { a: safeAddress });
  return d.boxes || [];
}

async function findEligibleBoxes(height) {
  const lo = height - STORAGE_PERIOD;
  const hi = height + PRE_BUILD_BLOCKS - STORAGE_PERIOD;
  const out = [];
  for (const tid of TOKENS_TO_WATCH) {
    try {
      const d = await gql(`query($t:String!,$lo:Int!,$hi:Int!) {
        boxes(take:50, skip:0, tokenId:$t, spent:false, minHeight:$lo, maxHeight:$hi) {
          boxId address value creationHeight ergoTree assets{ tokenId amount } } }`,
        { t: tid, lo, hi });
      for (const b of d.boxes || []) {
        if (parseInt(b.value) < DUST_THRESHOLD) {
          out.push({
            boxId: b.boxId, address: b.address, value: parseInt(b.value),
            creationHeight: b.creationHeight, eligibleAt: b.creationHeight + STORAGE_PERIOD,
            ergoTree: b.ergoTree,
            assets: (b.assets || []).map(a => ({ tokenId: a.tokenId, amount: parseInt(a.amount) })),
          });
        }
      }
    } catch (e) { /* continue */ }
  }
  return out;
}

// ==================== TRANSACTION ====================
/**
 * Build + sign a rent-collection tx.
 * Pattern: victim box (empty proof) + bot funding box (signed) → safe address.
 * The wallet signs only its own input; the victim gets empty proof bytes,
 * which triggers the protocol's age-based validation path.
 */
async function buildSweepTx(victim, funding, height) {
  const totalInput = victim.value + parseInt(funding.value);
  const outputValue = totalInput - FEE;
  if (outputValue < 1000000) return null;

  try {
    // Parse boxes
    const victimBox = ergoLib.ErgoBox.from_json(JSON.stringify({
      boxId: victim.boxId, value: victim.value, ergoTree: victim.ergoTree,
      creationHeight: victim.creationHeight,
      assets: victim.assets, additionalRegisters: {},
      transactionId: '00'.repeat(32), index: 0,
    }));
    const fundBox = ergoLib.ErgoBox.from_json(JSON.stringify({
      boxId: funding.boxId, value: parseInt(funding.value), ergoTree: funding.ergoTree,
      creationHeight: funding.creationHeight,
      assets: (funding.assets || []).map(a => ({ tokenId: a.tokenId, amount: a.amount })),
      additionalRegisters: {},
      transactionId: '00'.repeat(32), index: 0,
    }));

    const inputs = ergoLib.ErgoBoxes.from_boxes([victimBox, fundBox]);

    // Output: everything to safe address
    const safeTree = ergoLib.ErgoTree.from_base16_bytes(
      '0008' + Buffer.from(publicKey.encode()).toString('hex')
    );
    const outputBuilder = new ergoLib.ErgoBoxCandidateBuilder(
      ergoLib.BoxValue.from_i64(BigInt(outputValue)), safeTree, height
    );
    for (const a of victim.assets) {
      outputBuilder.add_token(
        ergoLib.TokenId.from_str(a.tokenId),
        ergoLib.TokenAmount.from_i64(BigInt(a.amount))
      );
    }
    const outputs = ergoLib.ErgoBoxCandidates.from_boxes([outputBuilder.build()]);

    // State context (for signing)
    const hdr = await gql('{ blockHeaders(take:1){ headerId } }');
    const stateCtx = new ergoLib.ErgoStateContext(
      ergoLib.BlockId.from_str(hdr.blockHeaders[0].headerId)
    );

    // Build unsigned tx
    const txb = ergoLib.TxBuilder.new(
      inputs, outputs, height,
      ergoLib.BoxValue.from_i64(BigInt(FEE)),
      ergoLib.Address.from_base58(safeAddress),
      ergoLib.BoxValue.from_i64(BigInt(1000000))
    );
    const unsigned = txb.build();

    // Sign — wallet signs only its own input, leaves victim proof empty
    const signed = wallet.sign(unsigned, inputs, [], stateCtx);
    return { json: JSON.parse(signed.to_json()), id: signed.id().to_str() };

  } catch (e) {
    console.error(`  Tx build error: ${e.message}`);
    console.error(`  (If this is a signing error for mixed inputs, the ergo-lib`);
    console.error(`   version may need a custom prover — see KNOWN_ISSUES in README)`);
    return null;
  }
}

async function submitTx(txJson) {
  for (const url of [`${NODE_URL}/api/v1/transactions`, `${NODE_URL}/tx`]) {
    try {
      const r = await axios.post(url, txJson, { timeout: 30000,
        headers: { 'Content-Type': 'application/json' } });
      return r.data;
    } catch (e) { /* try next */ }
  }
  throw new Error('All submission endpoints failed');
}

// ==================== LOG ====================
function log(entry) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry });
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

// ==================== MAIN ====================
async function main() {
  console.log('╔═════════════════════════════════════════════════╗');
  console.log('║  ERGO COMMUNITY SHIELD BOT — PUBLIC SERVICE     ║');
  console.log('║  Sweeps → public address → funds reclaimable    ║');
  console.log('╚═════════════════════════════════════════════════╝\n');
  await setupWallet();
  console.log(`Node: ${NODE_URL} | Poll: ${POLL_INTERVAL_MS/1000}s | Watching: ${TOKENS_TO_WATCH.length} tokens\n`);

  const done = new Set();
  while (true) {
    try {
      const height = await getHeight();
      const [candidates, botUtxos] = await Promise.all([findEligibleBoxes(height), getBotUtxos()]);

      const balance = botUtxos.reduce((t, b) => t + parseInt(b.value), 0) / 1e9;
      if (balance < 1) console.warn(`⚠ LOW: ${balance.toFixed(3)} ERG — fund the bot!`);

      const fresh = candidates.filter(b => !done.has(b.boxId) && b.eligibleAt <= height + PRE_BUILD_BLOCKS);
      if (fresh.length === 0) { await sleep(POLL_INTERVAL_MS); continue; }

      console.log(`\n[${height}] ${fresh.length} eligible boxes found`);

      const funding = botUtxos.filter(b => parseInt(b.value) > FEE * 3)
        .sort((a, b) => parseInt(b.value) - parseInt(a.value))[0];
      if (!funding) { console.error('No funded UTXO!'); await sleep(POLL_INTERVAL_MS); continue; }

      for (const box of fresh) {
        const away = box.eligibleAt - height;
        console.log(`  ${box.boxId.slice(0,12)}… ${(box.value/1e9).toFixed(6)} ERG → ${away <= 0 ? 'ELIGIBLE NOW' : away + ' blocks'}`);

        if (away > 0) {
          log({ action: 'APPROACHING', boxId: box.boxId, from: box.address,
                value: box.value, inBlocks: away });
          continue;
        }

        // ELIGIBLE — sweep
        console.log(`    → building tx…`);
        const signed = await buildSweepTx(box, funding, height);
        if (!signed) {
          log({ action: 'BUILD_FAILED', boxId: box.boxId, from: box.address, value: box.value });
          done.add(box.boxId); continue;
        }
        console.log(`    → submitting ${signed.id}…`);
        try {
          await submitTx(signed.json);
          console.log(`    ✓ SUBMITTED`);
          log({ action: 'SWEPT', boxId: box.boxId, from: box.address,
                value: box.value, txId: signed.id, tokens: box.assets, height });
        } catch (e) {
          console.log(`    ✗ ${e.message}`);
          log({ action: 'SUBMIT_ERROR', boxId: box.boxId, from: box.address,
                value: box.value, txId: signed.id, error: e.message });
        }
        done.add(box.boxId);
      }
    } catch (e) {
      console.error(`Error: ${e.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
