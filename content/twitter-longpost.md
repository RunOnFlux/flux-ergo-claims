# @runonflux — X Premium long post (revised: calm, constructive)

*Plain text, no markdown rendering on X. Fill [LINK]s. Tone: "interesting analysis + we built the solution."*

---

As part of our roadmap to consolidate parallel assets and build the infrastructure layer for autonomous agents (runonflux.com), we're sunsetting Flux on Ergo.

In the process, we discovered something about how Ergo handles dormant UTXOs that we think the broader crypto community should know about.

First and most importantly: all Flux funds are safe. Every balance is honored 1:1 in native FLUX, claimable inside Fusion. Unclaimed Fusion snapshot balances and mining rewards remain claimable on the Flux main chain. Nothing is lost.

—

WHAT WE DISCOVERED

Ergo implements "storage rent": any box (UTXO) unmoved for 4 years can be spent by anyone if it holds under ~0.15 ERG. The claimant keeps the entire box — tokens, NFTs, everything.

This is documented in the Ergo whitepaper. It's intended design, not a bug.

What surprised us was the scale. We audited the entire chain for 30 days:

— Two automated collector operations claimed 42,433 boxes
— From 5,402 different addresses
— 458 distinct tokens affected, including a stablecoin (SigUSD)
— Median survival once a box becomes claimable: 6 minutes

The mechanism is straightforward. A box with sufficient ERG pays its rent and the remainder returns to the owner. A box without enough ERG is claimed entirely — tokens and all. Wallets typically attach the protocol minimum (0.001 ERG) to token transfers, which means every token box has a four-year timer by default.

—

WHAT WE'RE DOING

— Flux on Ergo winds down. This is roadmap acceleration, not a retreat.
— Snapshot at block 1,878,291: 483,623.36 FLUX across 2,842 addresses claimable 1:1 in Fusion.
— Unclaimed Fusion rewards remain claimable on Flux main chain.
— Zelcore's next release attaches min 1 ERG to every Ergo token transfer + adds clear box-safety warnings.

—

WHAT WE BUILT FOR THE COMMUNITY

We didn't just document the issue — we shipped the fix and free tools for every Ergo user:

→ EIP-0049: Prepaid Storage Rent with Archival and Revival. A complete protocol proposal that eliminates the confiscation branch while preserving rent income and state cleanup. Submitted to the Ergo EIPs repository.

→ ergo.runonflux.com: a free public tool with a live box-safety checker (per-box countdown for any address), a sweep detector (see if an address was ever collected), a coming-due radar, and a known-harvesters registry.

→ Open source: github.com/RunOnFlux/flux-ergo-claims — all evidence, all tools, forkable.

—

A NOTE ON TRANSPARENCY

Ergo has never hidden this mechanism — it's in the whitepaper and their own explainer posts. We're a custody team and we should have accounted for it; that's on us. Our disagreement isn't about transparency. It's about whether "documented" makes a confiscation branch acceptable for token custody.

We thank the Ergo team for their cooperation throughout, and the operators who returned the Flux bridge reserve within 24 hours of collection.

If you hold any tokens on Ergo — on any wallet — keep at least 1 ERG on every token box, and check your boxes at ergo.runonflux.com. Free, no wallet connection needed.

Full technical write-up: https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/
