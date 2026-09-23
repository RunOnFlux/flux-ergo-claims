# Ergo Storage Rent — Twitter Thread

*Post from official accounts (and personal, if you're doing both). Numbers cross-check the article,
announcement, and evidence files. Fill https://github.com/RunOnFlux/flux-ergo-claimss before posting. No emojis kept it clean; add per house style.*

---

**TWEET 1 (hook)**

Last night, 94.3% of all FLUX on Ergo left our bridge reserve — in 24 minutes.

No key was stolen. No signature forged. The transactions contain no signature at all.

All funds are safe on Flux and PA chains thanks to Fusion. Every Ergo balance honored 1:1.

What we found auditing WHY: bigger than Flux. Thread.

**TWEET 2 (timeline)**

22:54:55 UTC — we snapshot the reserve. Intact.
23:00:58 — 400,000,000 FLUX gone. 10 blocks after becoming claimable.
23:18:50 — the last 15,000,000 gone.

Total elapsed: 24 minutes.

Verify the tx yourself:
https://ergexplorer.com/transactions/bb3607fa4b3a2764534888b07bb196d60d94460897afc053c0e409fc81c5ca06

**TWEET 3 (mechanism)**

How can a tx spend your coins with no signature?

On Ergo, a box unmoved for 1,051,200 blocks (4 years) can be spent by ANYONE. The owner's script is never evaluated. spendingProof: null.

P2PK, multisig, smart contract — nothing stops it. Under ~0.15 ERG, the claimant keeps everything in the box.

**TWEET 4 (control experiment — the rule in one example)**

Same night, same collectors swept one of our 1 ERG boxes. It could pay rent — so the protocol forced 0.90125 ERG back to our own script and let them keep ~0.099.

Same mechanism. Two outcomes. Decided solely by the ERG balance in the box.

Tokens + dust = confiscated. That's the design.

**TWEET 5 (industry)**

This is an industry.

The two operations that took our reserve run 77,532 and 29,547 lifetime transactions.

They pay miners directly — scripts that embed the current block miner's pubkey. We matched the drain block's miner key to their fee boxes.

The harvest has fee infrastructure. Miners are paid participants.

**TWEET 6 (30-day receipts)**

We audited the chain. Last 30 days, just these two operators:

— 4,399 sweep transactions
— 42,433 boxes claimed
— from 5,402 different addresses
— 6,300 boxes confiscated outright (tokens + 286 ERG)
— ~3,600 ERG rent skimmed from funded boxes
— 458 different tokens. Including SigUSD. A stablecoin.

Box-level CSVs: https://github.com/RunOnFlux/flux-ergo-claims

**TWEET 7 (latency)**

Median time from a box becoming claimable to being claimed: SIX MINUTES (30-day median).

100% claimed within 24 hours.

In our audit of all 90,490 boxes that ever held FLUX, the number of unspent boxes older than four years is zero.

Nothing survives the threshold. Nothing.

**TWEET 8 (what's coming)**

What's queued:

FLUX: next 30 days — 786 boxes / 7.63M FLUX go claimable. Next 90 days — 1,418 boxes / 11.69M FLUX.

Ecosystem-wide at the observed rate: 130,000–170,000 boxes in three months.

If your Ergo wallet holds a box older than ~3 years with <0.15 ERG — it is already scheduled.

**TWEET 9 (comparison)**

Every chain that charges for state solved this without confiscation:

Solana: rent-exempt minimums — undrainable accounts cannot exist.
Cardano: min-ADA per UTXO enforced at creation.
Nervos: state priced in the asset itself.

Ergo: strangers take your tokens without your key.

Destruction is a bug; harvesting is an industry.

**TWEET 10 (what we're doing)**

Our response:

— Flux ends on Ergo. Bridge terminated. Snapshot at block 1,878,291: every balance honored 1:1 in Fusion. 483,623.36 FLUX across 2,842 addresses claimable.
— Unclaimed Fusion snapshot balances & mining rewards remain claimable on Flux main chain. Nothing lost.
— White-hats returned the FULL reserve within 24h. 100k FLUX critical bug bounty granted.
— This aligns with our roadmap: consolidating parallel assets, becoming infrastructure for agents.

Protocol-legal. Universally called a critical defect. That is the design.
— Zelcore keeps Ergo support: next release attaches min 1 ERG to every token send + severe warnings on all Ergo assets.

**TWEET 11 (demand)**

To Ergo's leadership, miners, and community:

Ship rent-exempt-style minimums — or any rule that makes third-party confiscation impossible — as an emergency protocol change.

Every day of delay is ~1,850 more boxes harvested.

Until then, we do not consider Ergo safe for token custody at global scale.

**TWEET 12 (close)**

Full technical write-up: how it works, the forensics, the receipts, the exposure tables.

Box-level evidence anyone can verify: every vulnerable FLUX box, the complete sweep log, statistics pack.

Four years, eighteen minutes. That's all it takes.

https://github.com/RunOnFlux/flux-ergo-claims

---

## Standalone one-tweets (quote-tweet ammo, support accounts)

**A.** On Ergo, your tokens can be taken without your private key after 4 years of box inactivity. Not a hack — intended design. Last 30 days: 42,433 boxes claimed from 5,402 addresses; median survival once claimable: 6 minutes. Evidence: https://github.com/RunOnFlux/flux-ergo-claims

**B.** We ran one of the largest multi-asset wallets in the industry and didn't know Ergo boxes expire. If we didn't know, who does? Check your Ergo boxes today: anything older than ~3 years with <0.15 ERG is on a clock. Keep 1+ ERG on every token box.

**C.** 100% of rent-eligible boxes on Ergo get claimed within 24 hours. The median is 6 minutes. This isn't garbage collection — it's an automated confiscation industry, and miners are paid to include the transactions. Full audit: https://github.com/RunOnFlux/flux-ergo-claims

---

## Posting notes

- **ERG accuracy (important):** never say "8M ERG lost." The verified split for the 30-day window:
  286 ERG confiscated outright (dust boxes) + ~3,600 ERG rent skimmed from funded boxes; the rest of the
  ERG that passed through sweeps was returned to owner scripts by protocol rule (verified at box level on
  txs cae23424… and 69f06c7f…). The big loss class is TOKENS in dust boxes.
- Keep the claim discipline: "miners and collectors are paid by the rule" is on-chain verified; do not
  claim the Ergo organization profits from sweeps — one unverifiable accusation and the whole evidence
  pack gets dismissed.
- Tweet 2's link goes to the 400M tx; attach the 15M tx (bafedb4a…) as a reply for completeness.
- Pin the thread, then quote-tweet it from secondary accounts with the standalone bangers.
- https://github.com/RunOnFlux/flux-ergo-claims targets: article for the main thread; evidence CSV pack where noted.
