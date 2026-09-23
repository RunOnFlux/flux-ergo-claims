# Flux ends on Ergo; Zelcore adds severe storage-rent warnings

September 22, 2026

> **ERGO CHAIN WARNING — if you hold any asset on Ergo, read this first.**
>
> All funds are safe on Flux and parallel-asset chains thanks to Fusion. On Ergo, however, anyone can claim a box that sits unmoved for four years, without your private key. If it holds less than ~0.15 ERG, the claimant keeps everything in it — ERG, tokens, NFTs, all of it. This is not an exploit or a hack: it is Ergo's "storage rent," designed, documented, and defended by the chain's leadership — and it is running right now at industrial scale: roughly 1,850 boxes belonging to some 500 addresses harvested per day, with the median box claimed within 18 minutes of becoming eligible. If you hold assets on Ergo: consolidate aging boxes and keep at least 1 ERG on every token box, or move funds off the chain. Check your boxes at [ergo.runonflux.com](https://ergo.runonflux.com) — free, live, no wallet connection needed.

At 22:57 UTC yesterday, the Flux bridge reserve on Ergo held 415,000,000 FLUX, 94.3% of all Flux on the chain. Three minutes and twenty-seven seconds later, it held nothing. No private key was stolen. No signature was forged. No bug was exploited. Ergo's protocol simply permits strangers to take dormant funds — and ten blocks after our reserve became eligible, automated collectors did.

**The facts.** On Ergo, anyone can claim any unspent box that sits unmoved for four years, without the owner's key, if it holds too little ERG to cover the ~0.1 ERG storage fee. The claimant keeps the entire box, tokens included. Our boxes carried 0.001 ERG — the protocol minimum, the same minimum ordinary wallets attach every day. The transactions that drained the reserve contain no signature at all, because none is required:

- [`bb3607fa…`](https://ergexplorer.com/transactions/bb3607fa4b3a2764534888b07bb196d60d94460897afc053c0e409fc81c5ca06)
- [`bafedb4a…`](https://ergexplorer.com/transactions/bafedb4ae36a8f403b80627af96b42d0b7ad9e1a49ae9f0629a55d45ac75aac2)

This is not a hack. It is Ergo working exactly as designed and described in its whitepaper. **That is precisely the problem.** To be clear: Ergo has never hidden this mechanism — it is documented in the whitepaper and in the chain's own explainer, and we take our share of responsibility for not accounting for it. Our disagreement is not about transparency. It is about whether a chain should permit the confiscation of dormant assets at all. We know of no other major blockchain where a third party can take custody of your tokens without your private key. Chains that charge for state solved this correctly — Solana enforces rent-exempt minimum balances, so no account can ever be created that someone else can drain. On Ergo, default wallet behavior attaches a four-year fuse to every token box, and almost nobody knows it. We didn't — and we run one of the industry's largest multi-asset wallets. And the rule does not merely destroy value; it funds an economy: professional sweeping bots, fee infrastructure, direct miner payouts. We watched it operate on our own reserve, ten blocks after it became legal. **Destruction is a bug; harvesting is an industry.**

**One week of receipts — this is not an isolated incident.** Since our reserve was taken, we audited the Ergo chain. In the seven days from September 15–22, 2026, just two professional collector operations executed 1,245 sweep transactions and claimed **12,986 boxes from 3,675 different addresses** — 3,089 of them confiscated outright, including tokens and 114 ERG. Roughly 1,000 ERG in rent was levied on the funded remainder, and the protocol returns the balances to owner scripts minus that fee. The tokens taken include wrapped assets, a stablecoin (SigUSD), staking keys, NFTs, and community tokens. Of the boxes we observed reaching eligibility, **100% were claimed within 24 hours — the median box survived 18 minutes**. In our audit of all 90,490 boxes that have ever held FLUX, not a single unspent box older than the four-year threshold exists. The largest collector operation alone has executed 77,532 transactions in its lifetime. The harvest is automated, industrial, and runs every day — against every dormant box on the chain, one four-year birthday at a time. Full technical write-up: [https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/](https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/).
Evidence and tools: [ergo.runonflux.com](https://ergo.runonflux.com).

## Flux ends on Ergo — claims inside Fusion

- The Flux–Ergo bridge is terminated permanently. This aligns with our published roadmap ([runonflux.com](https://runonflux.com)) of consolidating parallel assets and becoming the infrastructure layer on which agents deploy — this decision simply expedites that timeline. From October onward, dormant FLUX boxes become claimable by strangers (7.6M FLUX becomes eligible within 30 days alone); we will not hold users' funds on a chain with a built-in timer, period.
- The snapshot is **block 1,878,291** — two blocks before the drain, at 22:54:55 UTC on September 21, 2026. Every FLUX balance in that snapshot is honored 1:1.
- Claims are made **inside Fusion** — no external sites. If something claims to be a Flux–Ergo claim portal outside Fusion, it is a scam.
- The claim window opens in early October; a complete guide will be published before it opens.
- **Unclaimed Fusion snapshot balances and mining rewards will remain claimable on the Flux main chain** — no action needed, nothing is lost.
- The operators of the collection scripts have returned the bridge reserve in full within 24 hours — verified on-chain on September 22 (txs `6885dd25…`, `04ea4144…`, `b8b51db2…`) — and we have granted them a **100,000 FLUX (main chain) critical bug bounty** for the responsible disclosure and return. Our thanks to them and the Ergo Team for doing the right thing and notifying us immediately. A protocol-legal action, recognized by everyone involved — collectors included — as a critical defect, is the strongest confirmation of the problem.
- **The snapshot has already passed.** FLUX acquired on Ergo after 22:54:55 UTC yesterday carries no claim. Do not buy any FLUX on the Ergo chain. Per the published snapshot, **483,623.36 FLUX across 2,842 addresses is user-claimable** — check your balance at [ergo.runonflux.com](https://ergo.runonflux.com).

## Changes to Ergo support in Zelcore

Zelcore is not going anywhere; our users' access to their own assets is non-negotiable, on every chain, always. But Ergo support in Zelcore changes with our next release, shipping at the end of September:

- Every Ergo token transfer from Zelcore attaches a **minimum of 1 ERG** — decades of storage coverage instead of a four-year fuse.
- **Severe warnings** appear wherever Ergo assets are held, received, or sent, in plain words: *on Ergo, a box idle for four years with too little ERG can be claimed by anyone, without your private key.*
- We further consider Zelcore flagging Ergo boxes older than three years and offering one-tap consolidation.

To every Ergo holder on any wallet: consolidate aging boxes, keep at least 1 ERG on every token box, and treat the four-year mark as the hard deadline it is.

Our criticism is of a design, not of people. We thank the Ergo team for notifying us and working with us closely throughout — we hope to keep that relationship and keep working together to make Ergo and the wider crypto space safer.

## Act now — this is an emergency, not an upgrade discussion

We are calling publicly, today, on Ergo's leadership, core developers, miners, and community:

- **Ship rent-exempt-style minimum balances — or any rule that makes third-party confiscation of a box impossible — as an emergency protocol change.** Not at the next scheduled hard fork. Now.
- **Until it ships, publish the list of dormant boxes approaching eligibility and notify holders**, the way any responsible custodian of user funds would. Right now, roughly 1,850 boxes belonging to some 500 addresses are being harvested per day — and miners and professional collectors are paid by the rule itself to do it.
- **Acknowledge the scale.** The documentation calls this garbage collection. What we documented in a single week — nearly 13,000 boxes taken from 3,675 addresses, 100% of them claimed within 24 hours of eligibility — is not garbage collection. It is automated, industrial confiscation of other people's assets, funded by the protocol's own incentives.

To that end, **we have submitted [EIP-0049: Prepaid Storage Rent with Archival and Revival](https://github.com/ergoplatform/eips/pull/107)** — a complete protocol proposal that eliminates the confiscation branch while preserving rent income and state cleanup. Boxes deplete rent continuously per block; exhausted boxes enter an archived state the owner can revive at any time. No cliff. No confiscation. No third party can ever claim another's assets.

We have also built and published the tools the chain lacks at [ergo.runonflux.com](https://ergo.runonflux.com): a live box-safety checker, a sweep detector, a coming-due radar, a known-harvesters registry, and a community shield bot — all open source at [github.com/RunOnFlux/flux-ergo-claims](https://github.com/RunOnFlux/flux-ergo-claims), built for every Ergo user, not just Flux holders.

The design decision that permits this was known and chosen. It can be unchosen. Until it is, we do not consider Ergo safe for token custody at global scale — for our users, or for anyone's.

— The Flux & Zelcore team
