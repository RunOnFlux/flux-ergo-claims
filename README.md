# flux-ergo-claims

Everything required to publish and operate the Flux-on-Ergo exit: comms package, the block-1,878,291
holder snapshot (official tool + independent cross-validation), and the public balance-checker website.

## Final numbers (locked)

| Figure | Value |
|---|---:|
| Snapshot block | **1,878,291** (2026-09-21 22:54:55 UTC, ID `6c088a23…`) |
| Snapshot boxes / addresses | 4,775 / 2,847 |
| Total FLUX in snapshot | 24,997,505.71 |
| Bridge reserve (excluded, being consolidated) | 18,250,000.00 |
| Flux team wallets (excluded) | 6,263,882.35 (4 wallets) |
| **User-claimable** | **483,623.36 FLUX across 2,842 addresses** |
| Total supply reconciliation | 415M drained (returning) + 24.997M snapshot + ~2.7K dust = 440M ✓ |

Reference check: internal estimate 484,805.78 vs published 483,623.36 → 0.24% delta
(per-address diff available via `snapshot/snapshot-balances.csv`).

## Layout

- `content/` — publishable copy: `announcement.md` (official), `article.md` (Medium + Flux/Zelcore
  blogs; swap "I"→"we" for blog versions), `twitter-thread.md` (12-tweet thread + standalone posts),
  `twitter-longpost.md` (@runonflux premium single post), `evidence-stats.md` (statistics pack).
- `snapshot/` — `ergolist.json` (raw output of the official RunOnFlux holder-snapshot tool at
  maxHeight=1,878,291), `claims-balances.json` (exclusions applied, Fusion-ingestion schema),
  `snapshot-balances.csv` (per-address, with exclusion flags), `erg-patched.js` + `run.js`
  (the official script with three fixes — see below), `flux-ergo-snapshot.py` (independent
  full-chain audit script used for cross-validation).
- `site/` — the public tool. Four tabs: **FLUX CLAIM** (snapshot checker), **BOX SAFETY** (live per-address
  rent-risk check with per-box countdowns), **HAVE I BEEN SWEPT?** (live sweep-history check: detects boxes
  spent with no proof bytes — when, what was inside, tx links), and the story. Static, no build step, no
  tracking. Live tabs query Zelcore's public Ergo GraphQL nodes (`graphql.erg-1.zelcore.io`, with
  `graphql.erg.zelcore.io` failover) directly from the browser — both send `Access-Control-Allow-Origin: *`.
- `bot/` — the **Community Shield Bot** (`shield.js`) and the **known harvesters registry** (`known-bots.json`).
  The shield bot is designed to monitor for boxes approaching rent eligibility, collect them BEFORE
  commercial harvesters, and hold them at a public, reclaimable address. The registry lists every
  known bot/collector address from the 30-day audit — public for community verification.
  The bot is a skeleton: monitoring and logging are functional; transaction signing requires
  `ergo-lib-wasm-nodejs` and key configuration (see the script header for setup instructions).
- `evidence/` — box-level CSVs: all vulnerable FLUX boxes, the October exposure window, the
  30-day storage-rent sweep log (12,986 victim boxes), a sample of swept addresses with their prior
  activity, and every unspent RSN box with its estimated rent and claimable date.

## Snapshot provenance & verification

1. Produced with the official `RunOnFlux/holder-snapshot` `erg.js` against
   `https://graphql.erg.zelcore.io`, patched to actually pass `maxHeight=1,878,291`
   (the committed version defaults it to 0 → snapshots CURRENT state; running it unpatched today
   would credit the drained 415M to the collectors' addresses). Also fixed: crash on piped
   output (`clearLine`), crash when `export/` is missing. Consider a PR upstream.
2. Cross-validated by an independent full-chain audit (`flux-ergo-snapshot.py`, complete
   enumeration of all 90,490 boxes that ever held FLUX via api.ergoplatform.com): the official
   tool output is a strict superset of the audit; agreement within 0.001% (~238 FLUX of
   resumable-walk gaps in the audit, all small user balances — official output is authoritative).
3. Exclusions (bridge reserve, 4 team/treasury wallets) confirmed by the Flux team on 2026-09-22.
   Address `9fSC7pwR…` (45,032.98 FLUX) was NOT recognized as team-owned and remains user-claimable.
4. Soundness: unspent-now + created ≤ 1,878,291 ⟹ held at snapshot (any spend would have destroyed
   the box). Supply conservation proves zero user FLUX moved between the snapshot height and the
   drain beyond the documented bridge transactions.

## Deployment & domain

Recommended domain: **`ergo.runonflux.com`** (alternatives: `claims.runonflux.com`, `safe.runonflux.com`).
DNS: point the subdomain (CNAME or A) at whichever static host serves this repo, and add a `CNAME` file
containing the domain to `site/` if using GitHub Pages. Any static host works — the site is plain HTML +
JS + JSON. Test locally: `python3 -m http.server` from `site/`.

Known limitations: live tabs scan up to ~400 recent transactions per address (very busy addresses may
time out — both public nodes rate-limit under heavy load); height→date conversion is interpolated (±hours);
the tool never touches private keys and reads public chain data only.

## Publish checklist

- [ ] Fill `[LINK]` placeholders in all content files (article URL, evidence pack, checker URL)
- [ ] Confirm claim window opening date ("early October") with engineering
- [ ] Zelcore release with 1 ERG minimum + Ergo warnings ships end of September
- [ ] INTERNAL (do not publish): consolidate the bridge's 40 dust boxes before 2026-10-17
      (8.5M FLUX goes rent-eligible in October; first big box ~Oct 17)
- [x] White-hat return: VERIFIED on-chain 2026-09-22 (txs 6885dd25 / 04ea4144 / b8b51db2, ~414.9M FLUX back at the bridge). Bounty: 100k FLUX (main chain), classified CRITICAL.
- [ ] INTERNAL: bridge now holds ~433M FLUX (414.9M returned + 18.25M old dust boxes). Consolidate/burn per sunset plan — old dust boxes still due from 2026-10-17.
- [ ] Deploy `site/` and link it from the announcement
