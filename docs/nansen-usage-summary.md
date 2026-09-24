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

The discovery calls identified one private candidate. Every coverage call requested the next sequential page needed for the proposed 32-day candidate window; the requests were not identical repeats. Early pages established consistent `trader_address` enforcement and extremely dense activity. Once completion appeared unlikely within the available budget, the user separately authorized continued sequential coverage until the chosen Academy 100-call stop condition.

Later pages continued to demonstrate wallet/token consistency and extreme page density, but added limited diversity beyond that evidence. This summary does not claim that all 91 pages were equally necessary, uniquely informative, or sufficient for useful completed coverage.

Coverage page 91 was still nonterminal. The relevant pagination was not exhausted, so coverage remained incomplete. No real round compiled, no real answer became publishable, and the public five-round game continues to use explicitly synthetic deterministic fixtures. Reaching an API-call threshold does not prove eligibility, complete coverage, or a real round.

## Provider-contract findings

- The observed discovery timestamps used whole-second UTC precision. Adapter version 4 accepts that narrow canonical shape, retains the source precision, and represents the same instant internally with `.000Z` without claiming provider-supplied milliseconds.
- The supplied coverage evidence consistently matched the requested wallet filter across 91 pages.
- Pagination density was much greater than the bounded workflow could complete: page 91 remained nonterminal.
- There were no reported acquisition failures, unknown-charge attempts, or categorized failure reasons.

Direction semantics, stable leg identity, terminal pagination behavior, complete-window cost, redistribution review, and publishable-round validation remain unresolved.

## Credit reconciliation

The original pre-spike dashboard balance was **1,095 credits**. Three spike credits explain the historical post-spike balance: **1,095 − 3 = 1,092**.

A separate later pre-discovery reading also displayed **1,095 credits**, although the expected post-spike balance was 1,092. That later reading remains unexplained and transient; it is not evidence of additional use or replenishment. The post-discovery reading of **1,086** equals **1,092 − 6**.

Final reconciliation remains **1,092 post-spike − 97 acquisition credits = 995**.

## Privacy boundary

Raw responses and wallet identity remain private. This public summary omits request and candidate identifiers, addresses, hashes, labels, raw rows, request bodies, exact trade timestamps, and exact trade values. The public application receives only allowlisted synthetic gameplay fields and makes no Nansen request during ordinary play.
