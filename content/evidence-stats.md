# Ergo Storage Rent — Evidence Pack Statistics

Generated: 2026-09-22 · Source: api.ergoplatform.com (on-chain, independently verifiable)
Companion files: `ergo-flux-vulnerable-boxes.csv`, `ergo-rent-sweep-log.csv`

## Headline findings

1. **Nothing survives eligibility.** Of 3,747 unspent FLUX boxes created 2022–2024, **zero** were older
   than the 4-year storage-rent threshold at audit time. In the observed 30-day sweep sample, the
   **median box was claimed 0.1 hours (≈6 minutes) after becoming claimable; 100% within 24 hours**
   (7-day subset: median 0.3 h, max 4.1 h, 100% ≤ 24 h).
2. **The harvest is industrial.** In 30 days (Aug 22 – Sep 22, 2026), two collector operators executed
   **4,399 sweep transactions claiming 42,433 boxes belonging to 5,402 different addresses**. 6,300 dust
   boxes (<0.15 ERG) were **confiscated outright — 286 ERG plus all tokens**, across **458 distinct
   tokens** including wrapped assets (WT_ERG, WT_ADA), the SigUSD stablecoin, staking keys, NFTs and
   community tokens. ~36,100 funded boxes were **rent-bled (~0.099 ERG each, ~3,600 ERG total)** with
   the remainder returned to owner scripts by protocol rule. One operator's address has **77,532
   lifetime transactions**; the other 29,547. 98.8% of 30-day victims were boxes created in August 2022.
3. **Confiscation requires no key.** Every victim input in every sweep transaction carries an empty
   spending proof (`spendingProof: null`). Owner scripts are never evaluated. No signature exists to
   forge, no key to leak — the protocol authorizes the taking by box age and ERG balance alone.

## ERG vs tokens — what is actually lost (30 days, two operators)

The rent rule distinguishes **funded vs underfunded boxes**, not ERG vs tokens:

| Outcome | 7 days | 30 days |
|---|---:|---:|
| Dust boxes (<0.15 ERG) confiscated **whole** — ERG + tokens | 3,089 boxes | 6,300 boxes |
| — ERG confiscated in those boxes | 114 ERG | **286 ERG** |
| — token-carrying boxes among them | 1,964 | **3,257** |
| Funded boxes (≥0.15 ERG): rent skimmed, remainder **returned to owner script** | ~9,900 boxes | ~36,100 boxes |
| — rent skimmed (~0.099 ERG/box) | ~990 ERG | **~3,600 ERG** |

Funded-box preservation is protocol-enforced and verified at box level twice: the Flux bridge's 1 ERG box
(1.0000 → 0.90125 returned, tx `cae23424…`) and a collector-A sweep (`69f06c7f…`: 1.0470 → 0.9483
returned to the owner's exact script, 0.0988 kept). Approximately 8M ERG passed through swept boxes in
the 30-day window; **all but the 286 ERG confiscations and ~3,600 ERG rent was returned.** Ergo's own
documentation notes a 1 ERG box is fully consumed by rent after roughly 32 idle years.

## Sweep volume: 7 days vs 30 days (two principal operators)

| Metric | Last 7 days | Last 30 days |
|---|---:|---:|
| Sweep transactions | 1,245 | 4,399 |
| Boxes claimed | 12,986 | 42,433 |
| Unique victim addresses | 3,675 | 5,402 |
| Dust boxes confiscated outright | 3,089 | 6,300 |
| Funded boxes rent-bled (returned minus rent) | ~9,900 | ~36,100 |
| Distinct tokens among victims | 100+ | 458 |

Observed claim rate: ~1,414 boxes/day (30-day average), accelerating to ~1,850/day in the last week.

## FLUX exposure detail (unspent boxes created ≤ 2024-12-31)

| Eligibility window | Boxes | FLUX at risk | Addresses | of which dust (whole-box claimable) |
|---|---:|---:|---:|---|
| Next 30 days (by 2026-10-22) | 786 | 7,632,296 | 588 | 786 boxes / 7,632,296 FLUX |
| Next 90 days (by 2026-12-22) | 1,418 | 11,694,506 | 1,000 | 1,312 boxes / 11,694,373 FLUX |
| Rest of 2026 | 1,442 | 11,695,414 | — | 1,333 / 11,695,280 |
| 2027 | 1,384 | 5,649,159 | — | 1,362 / 5,648,816 |
| 2028 | 921 | 1,052,559 | — | 891 / 1,047,964 |
| **Total** | **3,747** | **18,397,132** | **2,488** | **3,586 / 18,392,060** |

- 3,472 of 3,747 boxes (99.97% of FLUX) are dust-funded — whole-box claimable by strangers.
- **The Flux bridge's own deposit address holds 18,000,000 FLUX in 40 unswept dust boxes (0.040 ERG
  total)**; 14 boxes / 11.5M FLUX go claimable within 90 days (first: 2.5M on ~2026-10-17). Being
  consolidated by Zelcore ahead of their dates.
- All other holders: ~397k FLUX across ~3,700 boxes; largest non-bridge holder 45,843 FLUX (136 boxes).

## Ecosystem projection (next 3 months)

Every Ergo box created September–December 2022 becomes rent-eligible September–December 2026. At the
observed claim rate (1,400–1,850 boxes/day, with 100% of eligible boxes claimed within 24 h),
**~130,000–170,000 boxes will be claimed chain-wide in the next 90 days.** Any box older than ~3 years
holding <0.15 ERG should be considered scheduled.

## Method & caveats

- FLUX box data: complete enumeration of all 90,490 boxes ever holding the token, filtered to unspent
  boxes with creation height ≤ 1,432,698 (≈ 2024-12-31). Sweep data: transaction walk of the two
  principal collector addresses covering 30 days (4,399 sweep txs; lifetime coverage is larger —
  77,532 + 29,547 txs — so 30-day figures are a lower bound on operator activity).
- Height→date conversion is linear interpolation between anchored blocks (± hours).
- Rent ≈ 0.099 ERG per box per 4-year period (observed on two txs; ergo documentation cites ~0.13–0.14
  for larger boxes). Rent figures for funded boxes are per-box estimates, not tx-level accounting.
- Rent rule: a box unmoved for 1,051,200 blocks (4 years) may be spent by anyone; if it cannot pay rent
  plus minimum box value (~0.15 ERG combined), the claimant keeps the entire box. Threshold advances
  ~708 blocks/day.
