#!/usr/bin/env node
/**
 * SPEND A RENT BOX — MANUAL PER-INPUT PROOFS (SIDESTEPS MIXED-INPUT SIGNING)
 * =========================================================================
 * Some ergo-lib-wasm versions refuse to sign a whole transaction when ONE input
 * can't be proven (the storage-rent input). This example never asks the library
 * to sign the tx as a unit. Instead it:
 *
 *   1. builds the unsigned tx,
 *   2. proves EACH input on its own with `sign_transaction_input`,
 *   3. for any input that can't be proven (the rent box), blanks its proofBytes,
 *   4. stitches the final signed-tx JSON by hand and POSTs it to the node.
 *
 * This is the most robust pattern for rent sweeps: the rent input carries an
 * empty proof (accepted by the age rule), the funding input carries a real one.
 *
 *   Input[0] = rent-eligible box -> "" proof (age rule)
 *   Input[1] = your funding box  -> real proof
 *   Output   = everything -> DEST_ADDRESS
 *
 * RUN: npm install ergo-lib-wasm-nodejs axios
 *      SWEEP_MNEMONIC="..." TARGET_BOX_ID="..." node spend-rent-manual-proof.js
 */

const axios = require('axios');
const ergoLib = require('ergo-lib-wasm-nodejs');

const NODE_URL = process.env.NODE_URL || 'https://api.ergoplatform.com';
const STORAGE_PERIOD = 1_051_200;
const FEE = 1_000_000n;
const SUBMIT = process.env.SUBMIT === '1'; // set SUBMIT=1 to actually broadcast

const MNEMONIC = process.env.SWEEP_MNEMONIC;
const TARGET_BOX_ID = process.env.TARGET_BOX_ID;

async function main() {
  if (!MNEMONIC) throw new Error('Set SWEEP_MNEMONIC (owns the funding box)');
  if (!TARGET_BOX_ID) throw new Error('Set TARGET_BOX_ID (the rent-eligible box)');

  // --- Wallet (signs the funding input only) ---
  const seed = ergoLib.Mnemonic.to_seed(MNEMONIC, '');
  const rootSecret = ergoLib.ExtSecretKey.derive_master(seed);
  const secretKey = rootSecret.derive(ergoLib.DerivationPath.from_string("m/44'/429'/0'/0/0"));
  const secretKeys = new ergoLib.SecretKeys();
  secretKeys.add(secretKey.secret_key());
  const wallet = ergoLib.Wallet.from_secrets(secretKeys);
  const myAddress = secretKey.public_key().to_address().to_base58(ergoLib.NetworkPrefix.Mainnet);
  const destAddress = process.env.DEST_ADDRESS || myAddress;

  const height = (await axios.get(`${NODE_URL}/api/v1/networkState`)).data.height;

  // --- Fetch + verify the rent box ---
  const { data: victim } = await axios.get(`${NODE_URL}/api/v1/boxes/${TARGET_BOX_ID}`);
  const age = height - victim.creationHeight;
  if (age < STORAGE_PERIOD) {
    throw new Error(`Not rent-eligible: age ${age} < ${STORAGE_PERIOD} (${STORAGE_PERIOD - age} to go)`);
  }

  // --- Funding box ---
  const { data: mine } = await axios.get(
    `${NODE_URL}/api/v1/boxes/unspent/byAddress/${myAddress}?limit=1`
  );
  const funding = (mine.items || mine)[0];
  if (!funding) throw new Error(`No unspent funding box at ${myAddress}`);

  const boxOrder = [victim, funding];
  const inputs = ergoLib.ErgoBoxes.from_boxes(
    boxOrder.map(b => ergoLib.ErgoBox.from_json(JSON.stringify(b)))
  );
  const dataInputs = ergoLib.ErgoBoxes.from_boxes([]);

  // --- Output ---
  const outValue = BigInt(victim.value) + BigInt(funding.value) - FEE;
  const outBuilder = new ergoLib.ErgoBoxCandidateBuilder(
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(outValue.toString())),
    ergoLib.Address.from_base58(destAddress).to_ergo_tree(),
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

  // --- Unsigned tx ---
  const txb = ergoLib.TxBuilder.new(
    new ergoLib.BoxSelection(inputs, new ergoLib.ErgoBoxAssetsDataList()),
    outputs,
    height,
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(FEE.toString())),
    ergoLib.Address.from_base58(destAddress)
  );
  const unsigned = txb.build();
  const unsignedJson = JSON.parse(unsigned.to_json());

  // --- Prove each input independently; blank the ones we can't prove ---
  const signedInputs = unsignedJson.inputs.map((inp, idx) => {
    try {
      // sign_transaction_input returns an Input carrying the computed proof.
      const signedInput = wallet.sign_transaction_input(
        stateCtx, unsigned, inputs, dataInputs, idx
      );
      const proof = JSON.parse(signedInput.to_json());
      console.log(`input[${idx}] (${boxOrder[idx].boxId.slice(0, 8)}…): proved`);
      return { boxId: inp.boxId, spendingProof: proof.spendingProof };
    } catch (e) {
      // Rent input: no key proves it, but the age rule accepts an empty proof.
      console.log(`input[${idx}] (${boxOrder[idx].boxId.slice(0, 8)}…): EMPTY proof (rent)`);
      return { boxId: inp.boxId, spendingProof: { proofBytes: '', extension: {} } };
    }
  });

  // --- Stitch the final signed-tx JSON by hand ---
  const finalTx = {
    inputs: signedInputs,
    dataInputs: unsignedJson.dataInputs || [],
    outputs: unsignedJson.outputs,
  };

  console.log('\nFinal tx:\n', JSON.stringify(finalTx, null, 2));

  if (SUBMIT) {
    const res = await axios.post(`${NODE_URL}/transactions`, finalTx, {
      headers: { 'Content-Type': 'application/json' },
    });
    console.log('\nSubmitted txId:', res.data);
  } else {
    console.log('\n(dry run — set SUBMIT=1 to broadcast)');
  }
}

main().catch(e => {
  console.error(e.response ? JSON.stringify(e.response.data) : (e.message || e));
  process.exit(1);
});
