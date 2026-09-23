# Discord Announcement

*Matches the announcement's tone. Post in #announcements, pin it.*

---

⚡ **Flux on Ergo — Sunsetting & Claims**

All Flux funds are safe. Every balance is honored 1:1 in native FLUX inside Fusion. That's the most important thing.

But we need to tell you why we're ending Flux on Ergo — and why we do not consider Ergo safe for token custody at global scale.

---

**⚠️ What's wrong with Ergo**

On Ergo, anyone can claim a box that sits unmoved for 4 years — **without your private key**. If it holds under ~0.15 ERG, they keep everything: ERG, tokens, NFTs.

This is not a hack. It is Ergo working exactly as designed and described in its whitepaper. **That is precisely the problem.**

**📊 The data (30-day audit)**

We audited the entire Ergo chain. In 30 days:
• 42,433 boxes claimed from 5,402 addresses
• 6,300 confiscated outright — tokens, NFTs, stablecoins
• 458 distinct tokens affected (including SigUSD and wrapped assets)
• **Median survival once claimable: 6 minutes**
• In ALL 90,490 boxes that have ever held FLUX: zero survive past 4 years

This is not an edge case. Professional bots with 77,000+ lifetime transactions run this as a business.

**Destruction is a bug; harvesting is an industry.**

**🚫 No other chain does this**

Solana: rent-exempt minimums — undrainable accounts can't exist ✓
Cardano: min-ADA per UTxO ✓
Nervos: state priced in the asset ✓
Ergo: anyone can take your tokens without your key ✗

The design decision that permits this was known and chosen. **It can be unchosen.** Until it is, we do not consider Ergo safe for token custody at global scale.

---

**✅ What this means for Flux holders**

• **All your FLUX is safe** — snapshot at block 1,878,291
• **483,623 FLUX across 2,842 addresses** claimable 1:1
• **Unclaimed Fusion rewards** → claimable on Flux main chain
• **Claims open in Fusion** early October — guide coming before then
• ⚠️ **Don't buy FLUX on Ergo** — post-snapshot tokens carry no claim

**🔍 Check your balance**

→ **https://ergo.runonflux.com**

We also built free tools for the entire Ergo community:
• Box Safety Checker — per-box countdown for any address
• Sweep Detector — check if an address was ever collected
• Coming Due Radar — see approaching eligibility dates
• Known Harvesters Registry — see who's running the bots

**🛠️ We submitted a protocol fix**

EIP-0049: Prepaid Storage Rent with Archival & Revival
→ Eliminates the confiscation branch
→ Preserves rent income and state cleanup
→ No cliff, no timer, no third-party claims
→ https://github.com/ergoplatform/eips/pull/107

📖 **Full article:** https://runonflux.com/four-years-eighteen-minutes-ergo-storage-rent/
All evidence, tools, and code open source:
→ https://github.com/RunOnFlux/flux-ergo-claims

---

**📅 Timeline**

• **Now** — Check your balance at ergo.runonflux.com
• **End of September** — Zelcore update (1 ERG minimum + warnings)
• **Early October** — Claims open inside Fusion

This is roadmap acceleration — consolidating parallel assets, building agent infrastructure. Not a retreat.

Questions → <#support> or <#flux-ergo>
