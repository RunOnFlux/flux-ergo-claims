# EIP-DRAFT: Eliminating Storage-Rent Asset Confiscation

## Title
Remove the whole-box confiscation branch from storage rent; enforce rent-exempt minimum box values.

## Category
Protocol / Hard Fork

## Motivation

On September 21, 2026, 415,000,000 FLUX (94.3% of a token's supply) was taken from a project's
bridge reserve via Ergo's storage-rent mechanism. No private key was compromised. No signature
was forged. The transaction contained no proof bytes — because none are required.

A 30-day audit (September 2026) documented:
- **42,433 boxes** claimed from **5,402 addresses** by just two operators
- **6,300 boxes confiscated outright** — ERG, tokens, NFTs, everything
- **458 distinct tokens** affected, including a stablecoin (SigUSD) and wrapped assets
- **Median survival once claimable: 6 minutes** — nothing survives the threshold
- Professional operators with **77,532 lifetime transactions** run this as a business

The problem is NOT the rent concept (charging for state storage is legitimate and necessary).
The problem is the **confiscation branch**: when a box cannot pay its rent, the claimant keeps
the entire box contents — including tokens and NFTs that have nothing to do with storage costs.

This creates a systemic risk for token issuance on Ergo: any token held in a box that falls
below the rent threshold is on a timer to confiscation, regardless of its value.

## Specification

### Change 1: Remove the token confiscation branch (EMERGENCY)

**Current behavior** (rent collection rule):
```
if box.age >= STORAGE_PERIOD:
    if box.value >= RENT_FEE + MIN_BOX_VALUE:
        # Funded: rent deducted, remainder returned to owner's script
        output = box.copy(value = box.value - RENT_FEE)  # same ergoTree, same tokens
    else:
        # Underfunded: ENTIRE BOX claimed by collector (ERG + tokens + NFTs)
        output = collector_address  # everything gone
```

**Proposed behavior**:
```
if box.age >= STORAGE_PERIOD:
    # Always: rent deducted from ERG, remainder returned to owner's script
    # Tokens are NEVER confiscated. Period.

    rent_actual = min(box.value, RENT_FEE)
    remaining_erg = box.value - rent_actual

    if remaining_erg >= MIN_BOX_VALUE:
        output = box.copy(value = remaining_erg)  # same ergoTree, same tokens
    else:
        # ERG is consumed by rent, but tokens MUST be preserved
        output = box.copy(value = MIN_BOX_VALUE_FROM_COLLECTOR, tokens = box.tokens)
        # The collector pays the minimum box value to preserve the tokens
        # OR: tokens go to a protocol-level escrow the owner can claim from
```

**Impact**: Eliminates all asset confiscation. Rent collectors still profit from the ERG rent
fee, but tokens, NFTs, and other assets remain under the owner's control. The bridge reserve
scenario becomes impossible.

**Rationale**: Storage rent is a fee for state storage — it should be paid in ERG (the chain's
native fee currency), not in whatever tokens happen to be in the box. A parking meter charges
dollars, not the groceries in your trunk.

### Change 2: Rent-exempt minimum box values (SHORT-TERM)

Add a transaction validation rule: **every output box must have value >= RENT_EXEMPT_MINIMUM**.

```
RENT_EXEMPT_MINIMUM = 10 * RENT_FEE_PER_PERIOD
                    = 10 * 0.1 ERG
                    = 1.0 ERG
```

This means every box created after the fork has enough ERG to cover **40 years** of storage
rent before reaching zero. Wallets and dApps cannot create doomed boxes.

**Grandfathering**: Existing boxes below the threshold are NOT immediately invalid. They follow
Change 1 rules (tokens protected, rent-bled only). This avoids breaking existing UTXOs.

**Impact on wallets**: Wallet software must attach ≥ 1 ERG to every output. This is the same
approach Solana took (and the Ergo community has acknowledged is the correct comparison).

### Change 3: Prepaid lifetime rent (LONG-TERM, OPTIONAL)

Instead of recurring rent deduction, boxes are created with a prepaid storage budget:

```
creation: box.rent_budget = box.value * RENT_RATE
storage:  box.rent_budget decreases per block (not per 4-year period)
expiry:   when rent_budget = 0, box enters "archived" state
archived: box is pruned from active UTXO set but remains in blockchain history
revival:  owner can revive by providing a Merkle proof + paying current rent
```

This eliminates the cliff entirely — there's no moment when a box becomes claimable by others.
The box simply becomes archived if neglected. The owner always has the option to revive.

**Impact**: This is the most user-friendly design but requires significant engineering
(UTXO pruning, revival proofs, archival node support). Recommend as a long-term goal.

## Comparison to Other Chains

| Chain | Approach | Can third parties take your tokens? |
|---|---|---|
| Solana | Rent-exempt minimums (mandatory) | **No** — accounts below minimum can't be created |
| Cardano | Min-ADA per UTxO (at creation) | **No** — minimum enforced at tx output |
| Nervos | State storage priced in CKBytes | **No** — the asset IS the storage |
| Ethereum | Gas on writes; statelessness roadmap | **No** — EIP-4444 for history, not state confiscation |
| **Ergo (current)** | Storage rent + confiscation branch | **YES** — underfunded boxes taken entirely |
| **Ergo (proposed)** | Rent-bleed only + exempt minimums | **No** — tokens never confiscatable |

## Implementation Notes

### Change 1 (token protection)
- Modifies the transaction validator's rent-collection path
- Located in `ErgoTransactionValidator.scala` (or equivalent)
- The rule: when processing a rent-collection input, verify that an output exists with the
  same `propositionBytes` and all tokens from the input (minus the ERG rent)
- This is a validation rule, not a script change — no new opcodes needed

### Change 2 (rent-exempt minimums)
- Modifies transaction output validation
- Rule: `output.value >= RENT_EXEMPT_MINIMUM` for all outputs
- Wallets and dApps need to update their box-building code
- Simple to implement, well-precedented (Solana, Cardano)

### Fork mechanics
- Both changes require a hard fork
- Activation height should be chosen to give wallet developers 3+ months notice
- Consider a two-phase activation: Change 1 first (protects existing boxes),
  Change 2 at a later height (constrains new box creation)

## Political Framing

This proposal does NOT eliminate storage rent. It:
1. Preserves the rent mechanism (storage costs are still paid)
2. Preserves the 4-year cycle (rent is still collected on schedule)
3. Preserves miner/collector incentives (rent fees still paid)
4. Only removes the ability to confiscate non-ERG assets

The argument is not "rent is bad" — it's that **rent should be paid in ERG, not in whatever
tokens happen to be stored alongside it**. A storage unit operator charges rent in dollars;
they don't seize your furniture if you're late.

## Test Cases

```
Test 1: Funded box, 4 years old, 1 ERG + 100 TOKEN_A
  Input:  rent collection triggered
  Output: 0.9 ERG + 100 TOKEN_A → original owner's script
  Rent:   0.1 ERG → collector

Test 2: Underfunded box, 4 years old, 0.001 ERG + 1,000,000 TOKEN_B
  Input:  rent collection triggered
  Output: 0.001 ERG + 1,000,000 TOKEN_B → original owner's script (tokens preserved)
  Rent:   0 ERG (box had nothing to take; collector gets nothing)
  Note:   The collector may choose NOT to collect this box (no profit) — that's fine.
          The box simply continues to exist. If the owner never touches it, it sits there.
          State bloat is the trade-off for asset safety.

Test 3: New transaction creating a box with 0.5 ERG (below exempt minimum)
  Input:  transaction submitted
  Output: REJECTED — "output value below rent-exempt minimum"
  Fix:    sender must attach ≥ 1.0 ERG

Test 4: Box with 0.05 ERG + NFT, 4 years old
  Input:  rent collection triggered
  Output: 0.05 ERG + NFT → original owner's script (NFT preserved)
  Rent:   0 ERG collected (box too poor to pay)
  Note:   NFT is safe. Box continues to exist with its NFT.
```

## FAQ

**Q: Doesn't this break the garbage-collection incentive?**
A: No — rent is still collected from funded boxes. Underfunded boxes with tokens simply
   continue to exist (taking up state) rather than being confiscated. This is the same
   trade-off every other major chain has made.

**Q: Won't this create zombie UTXOs?**
A: Some, yes — boxes with tokens but no ERG, never touched. The UTXO set grows slightly.
   This is bounded by the number of token-holding dust boxes (from our audit: ~3,586 boxes
   for FLUX alone, ~6,300 across all tokens in 30 days). The alternative — confiscating
   people's assets — is worse than a modest state growth.

**Q: How does this compare to Solana's approach?**
A: Solana requires a minimum balance at account creation. We propose the same (Change 2)
   plus protection for existing boxes (Change 1). Solana didn't have the confiscation
   branch to remove; Ergo does, which is why we need both changes.

**Q: Is this "changing the terms of the chain"?**
A: Every hard fork changes something. The question is whether the change makes the chain
   more or less suitable for its purpose. We argue that eliminating asset confiscation
   makes Ergo MORE suitable for its stated goal of being a platform for financial contracts
   and token issuance — not less.

## References

- Ergo storage rent whitepaper section
- Ergo Explainer: Storage Rent (2022-02-18)
- Solana rent-exempt minimums documentation
- Cardano minimum-ADA-per-UTxO documentation
- Flux/Zelcore 30-day Ergo audit (September 2026) — evidence pack in this repository
- Drain transactions: bb3607fa, bafedb4a (verified on-chain, no signatures)
