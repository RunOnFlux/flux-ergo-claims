# Ergo Storage Rent — Twitter Thread

*Matches the announcement's tone: direct, factual, uncompromising about the design.*
*Flux holders are covered. Ergo's design is broken. Both are true.*

---

**TWEET 1 (hook — all funds safe + we don't consider Ergo safe)**

All Flux funds are safe. Every balance is honored 1:1 in Fusion.

But we do not consider Ergo safe for token custody at global scale.

Full analysis: https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/

Key findings in this thread 🧵

**TWEET 2 (the design flaw — direct, no softening)**

On Ergo, anyone can claim a box that sits unmoved for 4 years — without your private key.

If it holds under ~0.15 ERG, they keep everything: ERG, tokens, NFTs.

This is not a hack. It is Ergo working exactly as designed.

That is precisely the problem.

**TWEET 3 (the receipts — hard data, no hedging)**

We audited 30 days of on-chain data:

42,433 boxes claimed from 5,402 addresses
6,300 confiscated outright — tokens, NFTs, stablecoins
458 distinct tokens affected
Median survival once claimable: 6 minutes

This is not an edge case. This is industrial.

**TWEET 4 (nothing survives — the starkest data point)**

In our audit of ALL 90,490 boxes that have ever held FLUX on Ergo, the number of unspent boxes older than 4 years is ZERO.

Nothing survives the threshold.

100% of eligible boxes are claimed within 24 hours. The median is 6 minutes.

**TWEET 5 (no other chain does this — the comparison)**

We know of no other major blockchain where a third party can take custody of your tokens without your private key.

Solana: rent-exempt minimums ✓
Cardano: min-ADA per UTxO ✓
Nervos: state priced in asset ✓
Ethereum: gas on writes ✓
Ergo: anyone can take your tokens ✗

**TWEET 6 (the economy — "harvesting is an industry")**

This rule doesn't just destroy value — it funds an economy:

Professional sweeping bots
Fee infrastructure
Direct miner payouts

The largest operation has 77,532 lifetime transactions.

Destruction is a bug; harvesting is an industry.

**TWEET 7 (what we're doing — Flux roadmap + Zelcore)**

Our response:

— Flux ends on Ergo (roadmap acceleration: consolidating parallel assets for agent infrastructure)
— Snapshot at block 1,878,291: every balance honored 1:1 in Fusion
— Unclaimed Fusion rewards → claimable on Flux main chain
— Zelcore update: min 1 ERG on Ergo sends + severe warnings on all Ergo assets

**TWEET 8 (the fix — we shipped it)**

We didn't just document the problem. We submitted the fix:

→ EIP-0049: Prepaid Storage Rent with Archival & Revival
  Eliminates the confiscation branch. Preserves rent income. No cliff.
  github.com/ergoplatform/eips/pull/107

→ ergo.runonflux.com: free safety tools for every Ergo user
  Box checker, sweep detector, coming-due radar, harvesters registry

→ Full write-up: https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/

**TWEET 9 (the position — the user's favorite line)**

The design decision that permits this was known and chosen.

It can be unchosen.

Until it is, we do not consider Ergo safe for token custody at global scale — for our users, or for anyone's.

**TWEET 10 (action + close)**

If you hold any tokens on Ergo:
1. Check your boxes: ergo.runonflux.com
2. Keep ≥1 ERG on every token box
3. Consolidate anything older than 3 years

Flux claims open in Fusion in early October. Everything is safe.

Full analysis: https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/
Check your Ergo boxes: https://ergo.runonflux.com

---

## Standalone one-tweets

**A.** On Ergo, your tokens can be taken by anyone without your private key. Not a hack — it's how the chain works. 42,433 boxes claimed from 5,402 addresses in 30 days.

Full analysis: https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/
Check your address: ergo.runonflux.com

**B.** Every major blockchain prevents third parties from taking your tokens:
Solana ✓ Cardano ✓ Nervos ✓ Ethereum ✓ Ergo ✗

Median survival once claimable: 6 minutes. Nothing survives.
Free checker: ergo.runonflux.com

**C.** Destruction is a bug; harvesting is an industry.

On Ergo, professional bots claim dormant token boxes every ~90 seconds. 458 different tokens affected in 30 days. We built free tools + submitted a protocol fix.

ergo.runonflux.com | github.com/RunOnFlux/flux-ergo-claims

**D.** We submitted EIP-0049 to Ergo: a complete redesign of storage rent that eliminates asset confiscation. The design was chosen. It can be unchosen.

github.com/ergoplatform/eips/pull/107

---

## Posting notes

- **Tone**: matches the announcement — direct, factual, uncompromising
- **Flux = safe. Ergo = broken design.** Both stated clearly, never mixed.
- Key phrases that must survive editing: "That is precisely the problem." / "Destruction is a bug; harvesting is an industry." / "It can be unchosen."
- Let the data speak. Say "industrial," "unacceptable for custody," "no other chain does this" — not "broken"
- The 42,433 chain-wide number is the headline, not the 415M Flux-specific one
- Tweet 5 (comparison) is the screenshot-bait — make sure it renders
- Tweet 9 is the closer — it's the announcement's thesis statement
