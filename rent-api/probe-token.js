#!/usr/bin/env node
/**
 * PROBE-TOKEN — validate the valuable-token sweep path WITHOUT broadcasting.
 * =========================================================================
 * Builds a funded-dust storage-rent tx (empty-proof rent input + a signed wallet
 * funding input) for ONE whole-takeable token box, then runs it through the node's
 * /transactions/check (full consensus validation, no broadcast). Proves the signing
 * path (getFundingBox via explorer fallback + wallet.sign_transaction) actually works
 * before a real SigUSD/NETA box crosses. Never submits anything.
 *
 * RUN (on the node host, same .env as the sweeper):
 *   node --env-file=.env probe-token.js <boxId>
 * If no boxId is given, it auto-picks a whole-takeable token box from rent-api.
 */
const ergoLib = require('ergo-lib-wasm-nodejs');

const NODE_URL = (process.env.ERGO_NODE_URL || 'http://127.0.0.1:9053').replace(/\/$/, '');
const RENT_API = (process.env.RENT_API_URL || 'http://127.0.0.1:8480').replace(/\/$/, '');
const EXPLORER = (process.env.EXPLORER_URL || 'https://api.ergoplatform.com').replace(/\/$/, '');
const MNEMONIC = process.env.SWEEP_MNEMONIC || '';
const PRIVKEY = (process.env.SWEEP_PRIVATE_KEY || '').trim().replace(/^0x/, '');
const SAFE_ADDRESS = process.env.SAFE_ADDRESS || '';
const FEE = BigInt(process.env.FEE || 1_100_000);

const FEE_TREE = '1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304';
const EXT_OUTPUT0 = '0300';

async function jget(url, { allow404 = false } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'probe-token/1.0' } });
  if (r.status === 404 && allow404) return null;
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
const getUtxo = (boxId) => jget(`${NODE_URL}/utxo/byId/${boxId}`, { allow404: true });

if (!MNEMONIC && !PRIVKEY) { console.error('Set SWEEP_PRIVATE_KEY or SWEEP_MNEMONIC in .env'); process.exit(1); }
let wallet, myAddress;
if (PRIVKEY) {
  const sk = ergoLib.SecretKey.dlog_from_bytes(Uint8Array.from(Buffer.from(PRIVKEY, 'hex')));
  const ks = new ergoLib.SecretKeys(); ks.add(sk);
  wallet = ergoLib.Wallet.from_secrets(ks);
  myAddress = sk.get_address().to_base58(ergoLib.NetworkPrefix.Mainnet);
} else {
  const seed = ergoLib.Mnemonic.to_seed(MNEMONIC, '');
  const root = ergoLib.ExtSecretKey.derive_master(seed);
  const key = root.derive(ergoLib.DerivationPath.from_string("m/44'/429'/0'/0/0"));
  const ks = new ergoLib.SecretKeys(); ks.add(key.secret_key());
  wallet = ergoLib.Wallet.from_secrets(ks);
  myAddress = key.public_key().to_address().to_base58(ergoLib.NetworkPrefix.Mainnet);
}
const destAddress = SAFE_ADDRESS || myAddress;
function p2pkErgoTree(a58) { return '0008cd' + Buffer.from(ergoLib.Address.from_base58(a58).content_bytes()).toString('hex'); }

async function getFundingBox(minValue) {
  try {
    const r = await fetch(`${NODE_URL}/blockchain/box/unspent/byAddress?limit=20&sortDirection=desc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'probe-token/1.0' }, body: JSON.stringify(myAddress),
    });
    if (r.ok) { const j = await r.json(); const items = j.items || j || []; const b = items.find(x => BigInt(x.value) >= minValue); if (b) return { box: b, via: 'node extra-index' }; }
  } catch {}
  try {
    const j = await jget(`${EXPLORER}/api/v1/boxes/unspent/byAddress/${myAddress}?limit=50&sortDirection=desc`, { allow404: true });
    const items = (j && j.items) || [];
    const cand = items.find(x => BigInt(x.value) >= minValue);
    if (cand) { const nb = await getUtxo(cand.boxId); if (nb && BigInt(nb.value) >= minValue) return { box: nb, via: 'explorer→/utxo/byId' }; }
  } catch (e) { console.log('  explorer fallback error:', e.message); }
  return { box: null, via: null };
}

async function main() {
  console.log(`probe-token · node ${NODE_URL} · wallet/dest ${destAddress}`);
  const info = await jget(`${NODE_URL}/info`);
  const height = info.fullHeight;
  console.log(`fullHeight ${height}`);

  // 1) funding box
  const need = FEE + 2_000_000n;
  const { box: funding, via } = await getFundingBox(need);
  if (!funding) { console.error(`✗ FUNDING: no wallet box >= ${Number(need) / 1e9} ERG found (via node OR explorer). Fund ${myAddress} or check connectivity.`); process.exit(1); }
  console.log(`✓ FUNDING: ${funding.boxId.slice(0, 16)}… ${(Number(funding.value) / 1e9).toFixed(4)} ERG (via ${via})`);

  // 2) target token box
  let boxId = process.argv[2];
  if (!boxId) {
    const d = await jget(`${RENT_API}/rent/boxes?status=collectable&limit=1000`).catch(() => null);
    const rows = (d && d.rows) || [];
    const t = rows.find(r => r.tokenCount > 0 && r.drainable && r.valueNano <= Number(FEE)); // whole-takeable token dust
    if (!t) { console.error('✗ no whole-takeable token box in rent-api right now — pass a boxId explicitly'); process.exit(1); }
    boxId = t.boxId;
  }
  const box = await getUtxo(boxId);
  if (!box) { console.error(`✗ target ${boxId.slice(0, 16)}… not in UTXO set (spent?)`); process.exit(1); }
  console.log(`✓ TARGET: ${boxId.slice(0, 16)}… ${(Number(box.value) / 1e9).toFixed(4)} ERG · ${(box.assets || []).length} token(s)`);

  // 3) build funded-dust tx (rent input empty-proof + signed funding input)
  const outValue = BigInt(box.value) + BigInt(funding.value) - FEE;
  const tokMap = new Map();
  for (const b of [box, funding]) for (const a of (b.assets || [])) tokMap.set(a.tokenId, (tokMap.get(a.tokenId) || 0n) + BigInt(a.amount));
  const outputs = [
    { value: Number(outValue), ergoTree: p2pkErgoTree(destAddress), creationHeight: height, assets: [...tokMap].map(([tokenId, amount]) => ({ tokenId, amount: Number(amount) })), additionalRegisters: {} },
    { value: Number(FEE), ergoTree: FEE_TREE, creationHeight: height, assets: [], additionalRegisters: {} },
  ];
  const unsignedJson = { inputs: [{ boxId: box.boxId, extension: { '127': EXT_OUTPUT0 } }, { boxId: funding.boxId, extension: {} }], dataInputs: [], outputs };

  let signed;
  try {
    const unsigned = ergoLib.UnsignedTransaction.from_json(JSON.stringify(unsignedJson));
    const boxesToSpend = ergoLib.ErgoBoxes.from_boxes_json([box, funding]);
    const dataBoxes = ergoLib.ErgoBoxes.empty();
    const headers = await jget(`${NODE_URL}/blocks/lastHeaders/10`);
    const bh = ergoLib.BlockHeaders.from_json(headers);
    const stateCtx = new ergoLib.ErgoStateContext(ergoLib.PreHeader.from_block_header(bh.get(0)), bh, ergoLib.Parameters.default_parameters());
    signed = wallet.sign_transaction(stateCtx, unsigned, boxesToSpend, dataBoxes);
    console.log('✓ SIGN: wallet.sign_transaction succeeded');
  } catch (e) { console.error('✗ SIGN failed:', e.message); process.exit(1); }

  // 4) consensus check — no broadcast
  const finalTx = JSON.parse(signed.to_json());
  const r = await fetch(`${NODE_URL}/transactions/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finalTx) });
  const body = (await r.text()).replace(/"/g, '');
  console.log(r.ok ? `\n✅ VALID — /check accepted: ${body}\n(The token path works end-to-end. Nothing was broadcast.)`
                   : `\n❌ INVALID — /check rejected: ${body}`);
}
main().catch(e => { console.error('probe error:', e.message); process.exit(1); });
