# @runonflux — X Premium long post (single post version)

*Plain text, no markdown rendering on X. Fill https://ergo.runonflux.coms. Pair with the personal-account thread.*

---

Last night at 23:00:58 UTC, 94.3% of all FLUX on Ergo left the Flux bridge reserve.

415,000,000 FLUX. Gone in 24 minutes.

No private key was stolen. No signature was forged. The transactions that took it contain no signature at all — because none is required.

This is Ergo's "storage rent." Here's what that means, and what we found when we audited the entire chain afterward.

—

THE MECHANISM

On Ergo, any box (UTXO) that sits unmoved for 4 years can be claimed by ANYONE if it holds under ~0.15 ERG. The claimant keeps the entire box — ERG, tokens, NFTs, everything.

Your wallet's script is never evaluated. P2PK, multisig, smart contract — irrelevant. No key can stop it, because no key is consulted. The spending-proof field in the transaction is literally empty.

And wallets on Ergo attach the protocol minimum — 0.001 ERG — to token transfers by default. Every token box is born with a 4-year fuse. Almost nobody knows.

—

THE TIMELINE

22:54:55 UTC — we snapshot the reserve. Intact.
23:00:58 — 400,000,000 FLUX gone, 10 blocks after becoming claimable.
23:18:50 — the last 15,000,000 gone.

Verify the transactions yourself:
https://ergexplorer.com/transactions/bb3607fa4b3a2764534888b07bb196d60d94460897afc053c0e409fc81c5ca06

—

THE CONTROL EXPERIMENT

The same night, the same collectors swept one of our 1 ERG boxes. It could pay its rent — so the protocol forced 0.90125 ERG back to our own script and let them keep ~0.099.

Same mechanism. Two outcomes. Decided solely by the ERG balance in the box.

Tokens + dust = confiscated. That is the design.

—

WHAT WE FOUND AUDITING THE CHAIN

Last 30 days, just TWO of the professional collector operations:

— 4,399 sweep transactions
— 42,433 boxes claimed
— from 5,402 different addresses
— 6,300 boxes confiscated outright (tokens + 286 ERG)
— ~3,600 ERG skimmed as rent from funded boxes
— 458 different tokens taken, including SigUSD — a stablecoin — wrapped assets, staking keys and NFTs

Median time from a box becoming claimable to being claimed: 6 minutes. 100% claimed within 24 hours.

In our audit of all 90,490 boxes that have ever held FLUX, the number of unspent boxes older than 4 years is zero. Nothing survives the threshold. Nothing.

The largest collector operation alone has executed 77,532 transactions in its lifetime. They pay miners directly through scripts that embed the current block miner's key — we verified the drain block's miner was paid through this plumbing.

Destruction is a bug; harvesting is an industry.

—

WHAT'S COMING

FLUX alone: 786 boxes / 7.63M FLUX go claimable in the next 30 days. 1,418 boxes / 11.69M FLUX in the next 90.

Ecosystem-wide at the observed rate: 130,000–170,000 boxes in three months. Every box created Sep–Dec 2022 is already queued.

If your Ergo wallet holds a box older than ~3 years with under 0.15 ERG — assume it is scheduled.

—

FOR FLUX HOLDERS: YOU ARE COVERED

No user funds were lost. A snapshot at block 1,878,291 — two blocks before the drain — honors every circulating FLUX balance 1:1 in native FLUX, claimable inside Fusion. Claims do not depend on the recovery.

Per the published snapshot: 483,623.36 FLUX across 2,842 addresses is claimable. Check yours: https://ergo.runonflux.com

—

WHAT WE'RE DOING

Flux ends on Ergo. The bridge is terminated permanently.

Zelcore keeps Ergo support — your keys, your chains — but the next release attaches a minimum of 1 ERG to every Ergo token transfer and adds severe plain-language warnings on all Ergo assets.

Full technical write-up and box-level evidence (every vulnerable FLUX box, the complete sweep log, statistics): https://ergo.runonflux.com

—

TO ERGO'S LEADERSHIP, MINERS AND COMMUNITY

Solana enforces rent-exempt minimums — undrainable accounts cannot exist. Cardano mandates minimum ADA per UTXO. Every chain that charges for state solved this without confiscation.

Ship rent-exempt-style minimums — or any rule that makes third-party confiscation impossible — as an emergency protocol change. Every day of delay is ~1,850 more boxes harvested.

Until then, we do not consider Ergo safe for token custody at global scale.

Four years, eighteen minutes. That's all it takes.
