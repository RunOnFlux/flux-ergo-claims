#!/usr/bin/env node
/**
 * SPEND A STORAGE-RENT BOX — NO SIGNATURE FROM THE OWNER
 * =====================================================
 * Any box older than STORAGE_PERIOD (1,051,200 blocks ≈ 4 years) can be spent
 * by ANYONE under Ergo's storage-rent rule, regardless of its guarding script.
 * The protocol's age check replaces the sigma proof, so the rent input carries
 * EMPTY proofBytes.
 *
 * Unlike a TrueLeaf box, a rent spend still needs ONE real signed input to:
 *   - carry a valid proof so the tx isn't "all empty", and
 *   - (optionally) top up value if you keep the box alive.
 * Here we do the simplest thing: sweep the whole box to a destination and let a
 * small funding box pay the fee.
 *
 * Pattern (matches ../bot/shield.js and mainnet tx bb3607fa):
 *   Input[0] = rent-eligible box   -> EMPTY proof (age rule)
 *   Input[1] = your funding box     -> SIGNED
 *   Output   = everything -> DEST_ADDRESS
 *
 * RUN: npm install ergo-lib-wasm-nodejs axios
 *      SWEEP_MNEMONIC="..." TARGET_BOX_ID="..." node spend-storage-rent-box.js
 */

const axios = require('axios');
const ergoLib = require('ergo-lib-wasm-nodejs');

const NODE_URL = process.env.NODE_URL || 'https://api.ergoplatform.com';
const STORAGE_PERIOD = 1_051_200; // blocks until a box becomes rent-eligible
const FEE = 1_000_000n;

const MNEMONIC = process.env.SWEEP_MNEMONIC;      // wallet that owns a funding box
const TARGET_BOX_ID = process.env.TARGET_BOX_ID;  // the rent-eligible box

async function main() {
  if (!MNEMONIC) throw new Error('Set SWEEP_MNEMONIC (owns the funding box that pays the fee)');
  if (!TARGET_BOX_ID) throw new Error('Set TARGET_BOX_ID (the rent-eligible box)');

  // --- Wallet from mnemonic: this signs ONLY the funding input ---
  const seed = ergoLib.Mnemonic.to_seed(MNEMONIC, '');
  const rootSecret = ergoLib.ExtSecretKey.derive_master(seed);
  // m/44'/429'/0'/0/0 — the standard first Ergo address
  const path = ergoLib.DerivationPath.from_string("m/44'/429'/0'/0/0");
  const secretKey = rootSecret.derive(path);
  const secretKeys = new ergoLib.SecretKeys();
  secretKeys.add(secretKey.secret_key());
  const wallet = ergoLib.Wallet.from_secrets(secretKeys);
  const myAddress = secretKey.public_key().to_address();
  const destAddress = process.env.DEST_ADDRESS || myAddress.to_base58(ergoLib.NetworkPrefix.Mainnet);

  const height = (await axios.get(`${NODE_URL}/api/v1/networkState`)).data.height;

  // --- Fetch the rent-eligible box and verify it is actually old enough ---
  const { data: victim } = await axios.get(`${NODE_URL}/api/v1/boxes/${TARGET_BOX_ID}`);
  const age = height - victim.creationHeight;
  if (age < STORAGE_PERIOD) {
    throw new Error(`Box not rent-eligible yet: age ${age} < ${STORAGE_PERIOD} (${STORAGE_PERIOD - age} blocks to go)`);
  }
  console.log(`Box is ${age} blocks old — rent-eligible by ${age - STORAGE_PERIOD} blocks.`);

  // --- Find one unspent funding box owned by the wallet to pay the fee ---
  const { data: myBoxes } = await axios.get(
    `${NODE_URL}/api/v1/boxes/unspent/byAddress/${destAddress}?limit=1`
  );
  const funding = (myBoxes.items || myBoxes)[0];
  if (!funding) throw new Error(`No unspent box at ${destAddress} to fund the fee`);

  const victimBox = ergoLib.ErgoBox.from_json(JSON.stringify(victim));
  const fundBox = ergoLib.ErgoBox.from_json(JSON.stringify(funding));
  const inputs = ergoLib.ErgoBoxes.from_boxes([victimBox, fundBox]);

  // --- Output: victim value + funding value - fee, all tokens, to destination ---
  const outValue = BigInt(victim.value) + BigInt(funding.value) - FEE;
  const destTree = ergoLib.Address.from_base58(destAddress).to_ergo_tree();
  const outBuilder = new ergoLib.ErgoBoxCandidateBuilder(
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(outValue.toString())),
    destTree,
    height
  );
  for (const a of [...(victim.assets || []), ...(funding.assets || [])]) {
    outBuilder.add_token(
      ergoLib.TokenId.from_str(a.tokenId),
      ergoLib.TokenAmount.from_i64(ergoLib.I64.from_str(String(a.amount)))
    );
  }
  const outputs = ergoLib.ErgoBoxCandidates.from_boxes([outBuilder.build()]);

  // --- State context ---
  const headers = (await axios.get(`${NODE_URL}/api/v1/blocks/lastHeaders/10`)).data;
  const blockHeaders = ergoLib.BlockHeaders.from_json(headers);
  const preHeader = ergoLib.PreHeader.from_block_header(blockHeaders.get(0));
  const stateCtx = new ergoLib.ErgoStateContext(preHeader, blockHeaders);

  // --- Build + sign. The wallet holds the key for the FUNDING input only.
  //     ergo-lib emits EMPTY proofBytes for the rent input; the node's age
  //     rule validates it without a signature. ---
  const txb = ergoLib.TxBuilder.new(
    new ergoLib.BoxSelection(inputs, new ergoLib.ErgoBoxAssetsDataList()),
    outputs,
    height,
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(FEE.toString())),
    ergoLib.Address.from_base58(destAddress)
  );
  const unsigned = txb.build();
  const signed = wallet.sign_transaction(stateCtx, unsigned, inputs, ergoLib.ErgoBoxes.from_boxes([]));

  console.log('Signed tx id:', signed.id().to_str());
  const txJson = JSON.parse(signed.to_json());
  console.log('rent input proofBytes:', txJson.inputs[0].spendingProof.proofBytes, '(empty = no signature)');

  // Submit:
  // const res = await axios.post(`${NODE_URL}/transactions`, txJson);
  // console.log('Submitted:', res.data);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
