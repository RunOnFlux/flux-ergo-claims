# Four Years, Eighteen Minutes: Inside Ergo's Storage-Rent Harvest

*By [NAME], [TITLE] — Zelcore / Flux. Originally published on Medium and on the Flux and Zelcore blogs.
(Media note: swap "I" → "we" for the corporate blog versions. All figures are independently verifiable
on-chain; evidence files and methodology are linked at the end.)*

---

At 23:00:58 UTC on September 21, 2026, a transaction nobody at our company signed — that nobody *could*
have signed — took 400,000,000 FLUX out of the Flux bridge reserve on Ergo. Eighteen minutes later, a
second one took the remaining 15,000,000.

First, the part that matters to Flux holders: **no user funds were lost, no private key was compromised,
and every FLUX balance captured at our snapshot block is honored 1:1 in native FLUX, claimable inside
Fusion.** This is not a story about a breach of Flux. It is a story about what we found when we pulled
the thread on *how* those transactions were possible: a protocol rule that transfers dormant assets to
strangers without a key, and an automated industry operating it at a scale that, as far as we can tell,
nobody has documented — until now.

## The mechanism, precisely

Ergo is a UTXO chain. Balances live in "boxes," each with an ERG value, optional tokens, and a guarding
script. Two protocol rules matter here:

1. **The storage period.** A box that has not moved for 1,051,200 blocks (four years, at Ergo's ~2-minute
   blocks) can be spent by *anyone*. The guarding script — P2PK, multisig, any contract — is never
   evaluated. The spending-proof field in the transaction is literally empty. No key exists that could
   stop it, because no key is consulted.

2. **The rent.** The collector charges a storage fee of roughly 0.1 ERG per four-year period. Two branches:
   - **Box can pay** (≥ ~0.15 ERG): the protocol forces an output back to the *owner's* script, minus the
     rent. You lose ~0.099 ERG per period to someone who chose to "refresh" your box for you.
   - **Box cannot pay**: the claimant keeps **the entire box — ERG, tokens, NFTs, everything.**

Wallet software on Ergo routinely attaches the protocol minimum, 0.001 ERG, to token transfers. Every
such box is in the second branch. Every token transfer creates a box with a four-year fuse on it, and
almost nobody knows.

## The anatomy of the taking

Our bridge reserve sat in two boxes created August 30, 2022, holding 400M and 15M FLUX with 0.001 ERG
each. Rent eligibility is height-based: box creation + 1,051,200. The big box became claimable at height
1,878,283. It was claimed at height 1,878,293 — **ten blocks, roughly twenty minutes, after becoming
legal.**

- [400,000,000 FLUX taken — tx bb3607fa…](https://ergexplorer.com/transactions/bb3607fa4b3a2764534888b07bb196d60d94460897afc053c0e409fc81c5ca06)
- [15,000,000 FLUX taken — tx bafedb4a…](https://ergexplorer.com/transactions/bafedb4ae36a8f403b80627af96b42d0b7ad9e1a49ae9f0629a55d45ac75aac2)

Inspect them. `spendingProof: null` on our boxes. The only *signed* input belongs to the collector,
funding the transaction from their own wallet.

One thing deserves saying plainly: Ergo has never hidden this mechanism. It is in the whitepaper, in the
chain's own educational material, and in wallet documentation. We are a professional custody team and
we failed to account for it — that failure is ours, and we own it. The disagreement that remains is not
about transparency. It is about whether "documented" makes a confiscation branch acceptable for token
custody — and on that, the numbers in this article are our answer.

The same night produced a perfect control experiment. The bridge also held a 1 ERG box from the same
2022 vintage. Because it could pay its rent, the collector's sweep was forced to return 0.90125 ERG *to
our own script*, keeping ~0.099 ERG. Same mechanism, same night, same collectors — two outcomes decided
solely by the ERG balance in the box.

## The harvest is an industry

This is not a hobbyist finding a forgotten box. Documented in the transactions themselves:

- **Professional operators.** Two collector addresses executed the sweep of our reserve and split it
  50/50. The larger operation has **77,532 lifetime transactions**; the other, 29,547.
- **Fee infrastructure.** These transactions pay no standard miner fee. They route payments through a
  script that substitutes the *current block miner's public key* into the output — direct miner payouts
  for including confiscation transactions. We verified the drain block's miner key matches the timelock
  key the fee boxes consolidate into. Miners are paid participants in the harvest.
- **Latency engineering.** Across 30 days of observed sweeps, the **median time between a box becoming
  claimable and being claimed was about six minutes.** In the most recent week, 100% of eligible boxes
  were claimed within 24 hours. Nothing survives the threshold. In our audit of all 90,490 boxes that
  have ever held FLUX, the count of unspent boxes older than four years is **zero.**

## The receipts: one week, one month

Walking the two principal collectors' transaction histories:

| Metric | Last 7 days | Last 30 days |
|---|---:|---:|
| Sweep transactions | 1,245 | 4,399 |
| Boxes claimed | 12,986 | **42,433** |
| Victim addresses | 3,675 | **5,402** |
| Boxes confiscated outright (dust, whole box incl. tokens) | 3,089 | **6,300** |
| — ERG inside those confiscated boxes | 114 ERG | 286 ERG |
| Funded boxes rent-bled (returned minus ~0.099 ERG) | ~9,900 | ~36,100 |
| — rent skimmed from them | ~990 ERG | ~3,600 ERG |
| Distinct tokens among victims | 100+ | **458** |

About 8 million ERG passed *through* swept boxes in the 30-day window — but by protocol rule, the funded
remainder is returned to owner scripts; it is not lost. We verified this at box level twice: the bridge's
own 1 ERG box (1.0000 → 0.90125 returned), and a collector-A transaction (`69f06c7f…`) where a 1.0470 ERG
victim box came back as 0.9483 ERG to the owner's exact script, 0.0988 kept as rent.

**What about ERG itself?** The rule does not distinguish ERG from tokens — it distinguishes *funded* from
*underfunded* boxes. A dust box holding only ERG is confiscated whole (286 ERG across 30 days). A funded
ERG box loses ~0.099 ERG per four-year period, at a stranger's initiative, not the owner's — and Ergo's
own documentation notes a 1 ERG box survives roughly 32 years of rent before being fully consumed. The
primary victim class is tokens in dust boxes, because that is what default wallet behavior creates:
3,257 token boxes confiscated outright in 30 days, spanning 458 tokens — wrapped assets (WT_ERG, WT_ADA),
the **SigUSD stablecoin**, staking keys, NFT collections, and community tokens. Our 415M FLUX was
exactly this branch.

98.8% of the 30-day victims were boxes created in **August 2022** — the chain's 2022-era activity is now
marching through its four-year anniversaries, box by box, day by day.

## What is coming: the next one and three months

**For FLUX specifically** (from a complete enumeration of every box that has ever held the token):

| Window | Boxes going claimable | FLUX at risk | Addresses |
|---|---:|---:|---:|
| Next 30 days | 786 | **7,632,296** | 588 |
| Next 90 days | 1,418 | **11,694,506** | 1,000 |
| Through 2028 | 3,747 | 18,397,132 | 2,488 |

99.97% of that FLUX sits in dust boxes — whole-box claimable by strangers. (14 boxes / 11.5M FLUX in the
90-day window are bridge-controlled deposits; we are consolidating those ourselves before their dates.)

**For the Ergo ecosystem**, the same arithmetic applies to every token. At the observed rate of
1,400–1,850 boxes per day, on the order of **130,000–170,000 boxes will be claimed in the next three
months**, and every one of them becomes available to the fastest bot at the exact block it turns four.
The vintage created September–December 2022 is already queued. If your Ergo wallet shows a box older
than about three years carrying less than 0.15 ERG, assume it is scheduled.

## No other chain does this

Chains that charge for state solved this without confiscation. Solana enforces rent-exempt minimums —
accounts that could be drained by others cannot exist. Cardano mandates minimum ADA per UTXO at creation.
Nervos prices state in the asset itself. Ethereum debated rent for years and never shipped it rather than
ship *this*. Ergo's documentation describes storage rent as garbage collection. **Destruction is a bug;
harvesting is an industry** — and the confiscation branch is funded by the protocol's own incentive
design.

## What we are doing

- **Flux ends on Ergo.** The bridge is terminated. Our roadmap already scheduled reworking parallel
  assets and consolidating asset chains — this expedites it: from October, dormant boxes become claimable
  by strangers (7.6M FLUX within 30 days), and we will not hold users' funds on a chain with a built-in
  timer on them. A snapshot at block 1,878,291 (22:54:55 UTC, September
  21, 2026 — two blocks before the drain) honors every circulating FLUX balance 1:1, claimable inside
  Fusion. Roughly 483,623.36 FLUX across 2,842 addresses is user-claimable per the published snapshot
  (balance checker: https://ergo.runonflux.com); claims do not depend on the recovery of the bridge
  reserve. The operators returned it in full within 24 hours — the bulk of it back at the bridge roughly eight hours after the drain — and we granted a 100,000 FLUX
  critical bug bounty for the responsible disclosure and return. A taking that is protocol-legal, yet is
  recognized by every side — the collectors included — as a critical defect, is the design problem
  stated plainly.
- **Zelcore stays on Ergo — loudly changed.** From our next release: a minimum of 1 ERG attached to every
  Ergo token transfer (decades of rent coverage), and severe plain-language warnings wherever Ergo assets
  appear.
- **We are publishing everything.** Box-level CSVs of the vulnerable Flux boxes, the full sweep log, and
  the statistics pack: https://github.com/RunOnFlux/flux-ergo-claims.

## What you should do

If you hold anything on Ergo, in any wallet: consolidate aging boxes into funded ones, keep at least
1 ERG on every token box, and treat the four-year mark as the hard deadline it is. If you custody other
people's Ergo assets, audit your boxes against `creationHeight + 1,051,200` today, not at the next
incident.

And to Ergo's leadership, miners, and community: this can be unchosen. Rent-exempt-style minimums — or
any rule that makes third-party confiscation impossible — could ship as an emergency change. Every day
of delay is another ~1,850 boxes. Until it ships, we do not consider Ergo safe for token custody at
global scale. Not for our users. Not for anyone's.

---

### Evidence & methodology

- Drain transactions: [bb3607fa…](https://ergexplorer.com/transactions/bb3607fa4b3a2764534888b07bb196d60d94460897afc053c0e409fc81c5ca06),
  [bafedb4a…](https://ergexplorer.com/transactions/bafedb4ae36a8f403b80627af96b42d0b7ad9e1a49ae9f0629a55d45ac75aac2)
- Snapshot block 1,878,291 (ID `6c088a23…`, 22:54:55 UTC); drain block 1,878,293 (23:00:58 UTC)
- Data: complete enumeration of all 90,490 boxes ever holding FLUX (api.ergoplatform.com, box-level);
  30-day transaction walk of the two principal collector addresses (4,399 sweep transactions);
  height→date via anchored linear interpolation (±hours). Miner-fee plumbing verified by matching the
  drain block's `powSolutions.pk` to the fee-box timelock key. Funded-box preservation verified at box
  level on txs `cae23424…` (bridge 1 ERG → 0.90125 returned) and `69f06c7f…` (1.0470 → 0.9483 returned,
  0.0988 rent).
- Files: `ergo-flux-vulnerable-boxes.csv` (3,747 rows), `ergo-rent-sweep-log.csv` (12,986 rows / 7 days),
  `ergo-storage-rent-evidence-stats.md`
