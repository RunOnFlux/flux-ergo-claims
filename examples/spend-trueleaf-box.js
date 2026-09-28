#!/usr/bin/env node
/**
 * SPEND A `sigmaProp(true)` (TrueLeaf) BOX — NO SIGNATURE
 * ======================================================
 * A box whose ErgoTree is the constant `true` can be spent by ANYONE with an
 * EMPTY proof — no key, no age requirement. The guarding script `sigmaProp(true)`
 * reduces to `true`, so an empty proof already satisfies it.
 *
 * TrueLeaf ErgoTree (serialized): `10010101`
 *   - `10` header
 *   - the body serializes the constant SigmaProp(TrivialProp(true))
 * You will also see the equivalent short form `0101` from some tooling.
 *
 * Because the box itself pays the fee, we need NO funding/signing input at all.
 * We sign with an empty-key wallet: the prover emits empty proofBytes for the
 * only input, and the node accepts it.
 *
 * RUN: npm install ergo-lib-wasm-nodejs axios
 *      node spend-trueleaf-box.js
 */

const axios = require('axios');
const ergoLib = require('ergo-lib-wasm-nodejs');

const NODE_URL = process.env.NODE_URL || 'https://api.ergoplatform.com';
const FEE = 1_000_000n; // 0.001 ERG

// Where the funds should go once swept out of the TrueLeaf box.
const DEST_ADDRESS = process.env.DEST_ADDRESS || '9f...yourAddressHere';

// The public box you want to spend. Supply the raw box JSON as the node/explorer
// returns it (boxId, value, ergoTree === TrueLeaf, assets, additionalRegisters,
// creationHeight, transactionId, index).
const TARGET_BOX_ID = process.env.TARGET_BOX_ID;

async function main() {
  if (!TARGET_BOX_ID) throw new Error('Set TARGET_BOX_ID to the boxId you want to spend');

  // 1. Fetch the box in the exact shape ergo-lib expects.
  const { data: box } = await axios.get(
    `${NODE_URL}/api/v1/boxes/${TARGET_BOX_ID}`
  );
  if (box.ergoTree !== '10010101' && box.ergoTree !== '0101') {
    console.warn(`WARNING: ergoTree ${box.ergoTree} is not TrueLeaf; this may need a signature.`);
  }

  const height = (await axios.get(`${NODE_URL}/api/v1/networkState`)).data.height;

  const inputBox = ergoLib.ErgoBox.from_json(JSON.stringify(box));
  const inputs = ergoLib.ErgoBoxes.from_boxes([inputBox]);

  // 2. Single output: (box value - fee) to the destination, carrying all tokens.
  const outValue = BigInt(box.value) - FEE;
  if (outValue < 1_000_000n) throw new Error('Box too small to cover fee + min box value');

  const destTree = ergoLib.Address.from_base58(DEST_ADDRESS).to_ergo_tree();
  const outBuilder = new ergoLib.ErgoBoxCandidateBuilder(
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(outValue.toString())),
    destTree,
    height
  );
  for (const a of box.assets || []) {
    outBuilder.add_token(
      ergoLib.TokenId.from_str(a.tokenId),
      ergoLib.TokenAmount.from_i64(ergoLib.I64.from_str(String(a.amount)))
    );
  }
  const outputs = ergoLib.ErgoBoxCandidates.from_boxes([outBuilder.build()]);

  // 3. State context from recent headers (needed by the prover).
  const headers = (await axios.get(`${NODE_URL}/api/v1/blocks/lastHeaders/10`)).data;
  const blockHeaders = ergoLib.BlockHeaders.from_json(headers);
  const preHeader = ergoLib.PreHeader.from_block_header(blockHeaders.get(0));
  const stateCtx = new ergoLib.ErgoStateContext(preHeader, blockHeaders);

  // 4. Build the unsigned tx (fee goes to miners via the standard fee contract).
  const txb = ergoLib.TxBuilder.new(
    new ergoLib.BoxSelection(inputs, new ergoLib.ErgoBoxAssetsDataList()),
    outputs,
    height,
    ergoLib.BoxValue.from_i64(ergoLib.I64.from_str(FEE.toString())),
    ergoLib.Address.from_base58(DEST_ADDRESS)
  );
  const unsigned = txb.build();

  // 5. Sign with an EMPTY-KEY wallet. There is no secret that satisfies TrueLeaf,
  //    so the prover produces EMPTY proofBytes for the input — which is exactly
  //    what `sigmaProp(true)` accepts.
  const emptyWallet = ergoLib.Wallet.from_secrets(new ergoLib.SecretKeys());
  const signed = emptyWallet.sign_transaction(stateCtx, unsigned, inputs, ergoLib.ErgoBoxes.from_boxes([]));

  console.log('Signed tx id:', signed.id().to_str());
  console.log(JSON.stringify(JSON.parse(signed.to_json()), null, 2));

  // 6. Submit:
  // const res = await axios.post(`${NODE_URL}/transactions`, JSON.parse(signed.to_json()));
  // console.log('Submitted:', res.data);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
