#!/usr/bin/env python3
"""
Flux-on-Ergo snapshot tool — captures per-address FLUX balances at a given block height.

Method (sound by construction):
  A box was held at height H  <=>  box.creationHeight <= H  AND  box unspent at H.
  The Ergo explorer API lists boxes by creation height and marks current spend status:
    - unspent-now  + created <= H  =>  held at H (a spend would have destroyed the box)
    - spent-now    =>  spend time unknown from the listing alone; resolved via the
      post-snapshot transaction list (--post-tx), each tx's inputs count as HELD at H.
  Boxes created after H are excluded automatically.

Usage:
  python3 flux-ergo-snapshot.py --height 1878291 --out ./out
  Optional:
    --token <id>          (default: FLUX)
    --exclude-address A   (repeatable; e.g. the bridge reserve — not user-claimable)
    --post-tx TXID        (repeatable; txs after H whose inputs were held at H)
    --workers 8

Outputs: snapshot_boxes.json, snapshot.json (by address), snapshot-balances.csv

LP positions: Spectrum LP tokens co-held in user boxes are captured in `assets`.
To value LP claims: LP_flux = user_lp_tokens * pool_flux / lp_total_supply, using the
pool box (script address holding FLUX) at the same height. Pool boxes appear in the
snapshot with their script addresses — tag them via --exclude-address if they should
not be directly claimable.
"""
import argparse, csv, json, os, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

API = "https://api.ergoplatform.com/api/v1"
FLUX = "e8b20745ee9d18817305f32eb21015831a48f02d40980de6e849f886dca7f807"


def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(1.0 * (i + 1))
    return None


def walk_all_boxes(token, workers):
    """Yield every box ever holding `token` (API sorts by creation height asc)."""
    d = get(f"{API}/boxes/byTokenId/{token}?limit=100&offset=0")
    total = d["total"]
    print(f"total boxes ever holding token: {total}")
    pages = list(range(0, (total // 100 + 1) * 100, 100))

    def fetch(off):
        page = get(f"{API}/boxes/byTokenId/{token}?limit=100&offset={off}")
        if not page:
            return []
        out = []
        for b in page.get("items", []):
            out.append({
                "boxId": b["boxId"], "address": b.get("address", "?"),
                "value": b["value"], "h": b["creationHeight"],
                "spentTx": b.get("spentTransactionId"),
                "assets": [{"id": a["tokenId"], "amount": a["amount"]} for a in b.get("assets", [])],
            })
        return out

    boxes = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(fetch, o) for o in pages]
        for i, fut in enumerate(as_completed(futs)):
            boxes.extend(fut.result())
            if (i + 1) % 100 == 0:
                print(f"  walked {(i + 1) * 100}/{total}")
    return boxes


def post_held_boxes(post_txs):
    """Inputs of transactions confirmed AFTER the snapshot still count as held at H."""
    held = {}
    for txid in post_txs:
        tx = get(f"{API}/transactions/{txid}")
        if not tx:
            print(f"  WARN: could not resolve post-tx {txid}")
            continue
        for i in tx["inputs"]:
            fl = next((a["amount"] for a in i.get("assets", []) if a.get("tokenId") == FLUX), 0)
            if fl:
                held[i["boxId"]] = {"address": i.get("address", "?"), "value": i["value"],
                                    "h": i.get("outputCreatedAt", 0), "flux": fl}
    return held


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--height", type=int, required=True)
    ap.add_argument("--token", default=FLUX)
    ap.add_argument("--out", default="./out")
    ap.add_argument("--exclude-address", action="append", default=[])
    ap.add_argument("--post-tx", action="append", default=[])
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    boxes = walk_all_boxes(args.token, args.workers)
    with open(f"{args.out}/snapshot_boxes.json", "w") as f:
        json.dump(boxes, f)

    snap = {}
    for b in boxes:
        if b["h"] > args.height:
            continue
        if b["spentTx"] is None:  # unspent now => unspent at H
            fl = next((a["amount"] for a in b["assets"] if a["id"] == args.token), 0)
            snap[b["boxId"]] = {**b, "flux": fl}
    for boxId, v in post_held_boxes(args.post_tx).items():
        snap.setdefault(boxId, v)

    by_addr = defaultdict(list)
    for b in snap.values():
        by_addr[b["address"]].append(b)

    rows = []
    for a, bs in by_addr.items():
        if a in args.exclude_address:
            continue
        rows.append((a, sum(b["flux"] for b in bs) / 1e8, len(bs)))
    rows.sort(key=lambda r: -r[1])

    with open(f"{args.out}/snapshot-balances.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["address", "flux_at_snapshot", "box_count"])
        w.writerows(rows)
    with open(f"{args.out}/snapshot.json", "w") as f:
        json.dump({"height": args.height,
                   "addresses": {a: {"flux": fl, "boxes": n} for a, fl, n in rows}}, f, indent=1)

    total = sum(r[1] for r in rows)
    print(f"\nsnapshot @ {args.height}: {len(rows)} addresses, {total:,.8f} tokens (after exclusions)")


if __name__ == "__main__":
    main()
