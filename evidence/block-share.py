#!/usr/bin/env python3
"""
Ergo block-production share — which miner reward addresses produced recent blocks.

Method:
  Walks the most recent N blocks via the public explorer (/api/v1/blocks, newest first) and
  attributes each block to the miner reward address the explorer reports for it. Shares are
  computed over the whole window and over consecutive 2,000-block windows, so a sustained
  majority can be told apart from a short streak.

Usage:
  python3 -I block-share.py --blocks 10000 --to 1890489 --csv ergo-block-producers.csv
  (--to pins the window's last height so the result is reproducible; default is the current tip)
"""

import argparse
import collections
import csv
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

EXPLORER = 'https://api.ergoplatform.com/api/v1/blocks'
PAGE = 500


def page(offset):
    url = f'{EXPLORER}?offset={offset}&limit={PAGE}&sortBy=height&sortDirection=desc'
    err = None
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'block-share/1.0'})
            return json.load(urllib.request.urlopen(req, timeout=60))['items']
        except Exception as e:  # retry transient explorer errors
            err = e
    raise err


def shares(blocks, top=4):
    counts = collections.Counter(b['miner'] for b in blocks)
    return [(m, n, 100 * n / len(blocks)) for m, n in counts.most_common(top)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--blocks', type=int, default=10000)
    ap.add_argument('--to', type=int, default=None, help='last height of the window (default: tip)')
    ap.add_argument('--window', type=int, default=2000)
    ap.add_argument('--csv', default='ergo-block-producers.csv')
    args = ap.parse_args()

    tip = page(0)[0]['height']
    start = tip - args.to if args.to else 0
    with ThreadPoolExecutor(6) as ex:
        pages = list(ex.map(page, range(start, start + args.blocks + PAGE, PAGE)))
    blocks = sorted(
        ({'height': b['height'], 'timestamp': b['timestamp'], 'id': b['id'],
          'miner': (b.get('miner') or {}).get('address', '?')}
         for p in pages for b in p if not args.to or b['height'] <= args.to),
        key=lambda b: b['height'])[-args.blocks:]

    with open(args.csv, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['height', 'timestamp', 'id', 'miner'])
        w.writeheader()
        w.writerows(blocks)

    print(f'{len(blocks)} blocks, heights {blocks[0]["height"]}-{blocks[-1]["height"]}')
    for m, n, pct in shares(blocks):
        print(f'  {pct:5.1f}%  {n:6d}  {m}')
    top2 = sum(n for _, n, _ in shares(blocks, 2))
    print(f'  top two: {100 * top2 / len(blocks):.1f}%')
    for i in range(0, len(blocks), args.window):
        w_blocks = blocks[i:i + args.window]
        m, _, pct = shares(w_blocks, 1)[0]
        print(f'  window {w_blocks[0]["height"]}-{w_blocks[-1]["height"]}: top {pct:.1f}% (...{m[-8:]})')


if __name__ == '__main__':
    main()
