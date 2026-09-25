# Nansen API usage summary

This public summary records aggregate evidence supplied after the bounded Whale Gossip acquisition run. It contains counts only and does not establish a complete or publishable historical round.

## Usage totals

| Evidence | Count |
| --- | ---: |
| Contract-spike successes | 3 |
| Acquisition attempts | 98 |
| Settled acquisition attempts | 98 |
| Acquisition successes | 98 |
| Discovery calls | 6 |
| Candidate-specific coverage calls | 92 |
| Combined successful calls | 101 |
| Reported acquisition credits | 98 |
| Retained acquisition credits | 98 |
| Unknown-charge attempts | 0 |
| Failure reasons | 0 |
| `invalid-coverage-row` failures | 0 |
| `wallet-filter-not-applied` failures | 0 |
| Private candidates | 1 |

The discovery calls identified one private candidate. Every coverage call requested the next sequential page needed for the proposed 32-day candidate window; the requests were not identical repeats. Early pages established consistent `trader_address` enforcement and extremely dense activity. Once completion appeared unlikely within the available budget, the user separately authorized continued sequential coverage until the chosen Academy 100-call stop condition. Exactly one additional user-authorized call requested page 92 for the submission recording, bounded by `--max-new-calls 1`.

Later pages continued to demonstrate wallet/token consistency and extreme page density, but added limited diversity beyond that evidence. This summary does not claim that all 92 pages were equally necessary, uniquely informative, or sufficient for useful completed coverage.

Coverage page 92 was still nonterminal. The relevant pagination was not exhausted, so coverage remained incomplete. No real round compiled, no real answer became publishable, and the public five-round game continues to use explicitly synthetic deterministic fixtures. Reaching an API-call threshold does not prove eligibility, complete coverage, or a real round.

## Final live-recording call

The privacy-safe recording call returned an allowlisted summary only: `rowCount: 100`, `walletMatchCount: 100`, `tokenMatchCount: 100`, `structurallyValidRowCount: 100`, `structurallyInvalidRowCount: 0`, `rejectionReason: null`, `timeSpanBand: 1-to-6-hours`, `page: 92`, `perPage: 100`, `isLastPage: false`, `reportedCreditCost: 1`, `latencyBand: 1-to-3-seconds`, and `stoppedBecause: per-run-limit`. The recording was captured successfully and shows that summary followed by the explicitly synthetic public game. The public game itself does not serve live Nansen data.

## Provider-contract findings

- The observed discovery timestamps used whole-second UTC precision. Adapter version 4 accepts that narrow canonical shape, retains the source precision, and represents the same instant internally with `.000Z` without claiming provider-supplied milliseconds.
- The supplied coverage evidence consistently matched the requested wallet filter across 92 pages.
- Pagination density was much greater than the bounded workflow could complete: page 92 remained nonterminal.
- There were no reported acquisition failures, unknown-charge attempts, or categorized failure reasons.

Direction semantics, stable leg identity, terminal pagination behavior, complete-window cost, redistribution review, and publishable-round validation remain unresolved.

## Credit reconciliation

The original pre-spike dashboard balance was **1,095 credits**. Three spike credits explain the historical post-spike balance: **1,095 − 3 = 1,092**.

A separate later pre-discovery reading also displayed **1,095 credits**, although the expected post-spike balance was 1,092. That later reading remains unexplained and transient; it is not evidence of additional use or replenishment. The post-discovery reading of **1,086** equals **1,092 − 6**.

The preceding acquisition run still reconciles as **1,092 post-spike − 97 acquisition credits = 995**.

After the final one-credit recording call, the dashboard displayed **1,004 credits**, a net increase of nine from 995. This does not reconcile with the call. The 1,004 reading is retained only as an unexplained manual observation; it does not alter the 98-credit acquisition ledger, establish a grant, reconstruct account-balance history, or prove dashboard reconciliation.

## Official requirement discrepancy

The [campaign landing page](https://nansen.ai/campaigns/meridian-buildathon) still says “Make 1,000 API calls.” The newer, detailed [Nansen Academy FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27), shown as updated one day before this final evidence checkpoint, says “Log 100+ API calls between Sep 14th–27th.” These official sources conflict. Whale Gossip records 101 successful calls and proceeds under the newer, detailed FAQ; only Nansen can definitively reconcile the discrepancy.

## Privacy boundary

Raw responses and wallet identity remain private. This public summary omits request and candidate identifiers, addresses, hashes, labels, raw rows, request bodies, exact trade timestamps, and exact trade values. The public application receives only allowlisted synthetic gameplay fields and makes no Nansen request during ordinary play.
