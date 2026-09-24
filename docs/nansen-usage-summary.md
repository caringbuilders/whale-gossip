# Nansen API usage summary

This public summary records aggregate evidence supplied after the bounded Whale Gossip acquisition run. It contains counts only and does not establish a complete or publishable historical round.

## Usage totals

| Evidence | Count |
| --- | ---: |
| Contract-spike successes | 3 |
| Acquisition attempts | 97 |
| Acquisition successes | 97 |
| Discovery calls | 6 |
| Candidate-specific coverage calls | 91 |
| Combined successful calls | 100 |
| Reported acquisition credits | 97 |
| Retained acquisition credits | 97 |
| Unknown-charge attempts | 0 |
| Failure reasons | 0 |
| Private candidates | 1 |

The discovery calls identified one private candidate. Candidate-specific acquisition then tested whether wallet-filtered history could provide the complete evidence required by Whale Gossip's deterministic rules. The supplied evidence says the wallet filter was consistently enforced across all 91 coverage pages, making the run useful contract and pagination evidence.

Coverage page 91 was still nonterminal. The relevant pagination was not exhausted, so coverage remained incomplete. No real round compiled, no real answer became publishable, and the public five-round game continues to use explicitly synthetic deterministic fixtures. Reaching an API-call threshold does not prove eligibility, complete coverage, or a real round.

## Provider-contract findings

- The observed discovery timestamps used whole-second UTC precision. Adapter version 4 accepts that narrow canonical shape, retains the source precision, and represents the same instant internally with `.000Z` without claiming provider-supplied milliseconds.
- The supplied coverage evidence consistently matched the requested wallet filter across 91 pages.
- Pagination density was much greater than the bounded workflow could complete: page 91 remained nonterminal.
- There were no reported acquisition failures, unknown-charge attempts, or categorized failure reasons.

Direction semantics, stable leg identity, terminal pagination behavior, complete-window cost, redistribution review, and publishable-round validation remain unresolved.

## Credit reconciliation

The historical post-spike dashboard balance was **1,092 credits** and the supplied final balance was **995 credits**. The difference is exactly **97 credits**, matching the 97 reported acquisition credits.

A transient earlier dashboard reading of **1,095 credits** remains unexplained. It is not treated as evidence of extra usage, replenishment, or a different current balance.

## Privacy boundary

Raw responses and wallet identity remain private. This public summary omits request and candidate identifiers, addresses, hashes, labels, raw rows, request bodies, exact trade timestamps, and exact trade values. The public application receives only allowlisted synthetic gameplay fields and makes no Nansen request during ordinary play.
