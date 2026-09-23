const axios = require('axios');
const path = require('path');
const fs = require('fs');
const BigNumber = require('bignumber.js');

function writeToFileSync(filepath, args) {
  const flag = 'w';
  const fd = fs.openSync(filepath, flag);
  fs.writeSync(fd, args);
  fs.closeSync(fd);
}

let i = 0;

async function fetchBoxesForTokenSend(tokenId, url = 'https://graphql.erg.zelcore.io', maxHeight = 0, previousBoxes = [], skip = 0) {
  const query = `query boxes($take: Int, $skip: Int, $tokenId: String, $spent: Boolean, $maxHeight: Int) {
    boxes(take: $take, skip: $skip, tokenId: $tokenId, spent: $spent, maxHeight: $maxHeight) {
      boxId
      address
      assets {
        tokenId
        amount
      }
    }
  }`;
  const variables = {
    spent: false,
    skip,
    take: 50, // that is maximum
    tokenId,
    maxHeight, // THIS IS SNAPSHOT HEIGHT
  };
  const data = { query, variables };
  const boxesResp = await axios.post(url, data);
  const { boxes } = boxesResp.data.data;
  const allBoxes = previousBoxes.concat(boxes);
  i += 1;
  
  process.stdout.write(`Fetching UTXOS ${i}`);
  if (boxes.length < 50) { // well nothing to fetch
    return allBoxes;
  }
  // fetch more boxes
  return fetchBoxesForTokenSend(tokenId, url, maxHeight, allBoxes, skip + 50);
}

async function start(tokenAddress, maxHeight) {
  const utxosWithAsset = await fetchBoxesForTokenSend(tokenAddress, undefined, maxHeight);
  const holders = [];
  let total = 0;
  utxosWithAsset.forEach((utxo) => {
    const correctAsset = utxo.assets.find((asset) => asset.tokenId === tokenAddress);
    const boxAssetBN = new BigNumber(correctAsset.amount.toString());
    const holderExists = holders.find((holder) => holder.address === utxo.address);
    if (holderExists) {
      holderExists.amount = (new BigNumber(holderExists.amount).plus(boxAssetBN)).toString();
    } else {
      const holder = {
        address: utxo.address,
        amount: correctAsset.amount.toString(),
      };
      holders.push(holder);
    }
    total += (Number(correctAsset.amount.toString()) / 1e8);
  });
  console.log(`Total UTXO ${utxosWithAsset.length}`);
  const homeDirPath = path.join(__dirname, './export/');
  const filepath = `${homeDirPath}ergolist.json`;
  console.log(`Done Ergo - ${holders.length} records found. Exported at ${filepath}. Total Flux-ERG: ${total.toLocaleString()} (${total})`);
  writeToFileSync(filepath, JSON.stringify(holders, null, 2));
}

module.exports = { start };
