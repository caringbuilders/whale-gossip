# Nansen acquisition design and runbook

This document describes the reviewed boundary for acquiring private real-round candidates. The implementation is present but has **not** been executed live. Normal development, tests, dry-run, status, compilation, and the public application remain network-free.

## Fixed provider boundary

The workflow permits only `POST https://api.nansen.ai/api/v1/tgm/dex-trades`. It validates the exact HTTPS protocol, host, path, lack of query/fragment/credentials, request method, and server-owned body. Every request uses `chain: "ethereum"`, `only_smart_money: false`, ascending `block_timestamp`, and the fixed page size. Redirect following is disabled and every request has an abort timeout.

The reviewed token universe currently contains only canonical Ethereum WETH9 at `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`. That address was already reviewed for the closed contract spike and is recorded in `lib/server/nansen-contract.ts`. WETH is an ERC-20 wrapper rather than native ETH and is not a stablecoin. No other address in the repository has comparable verification evidence, so expanding to three–five non-stable tokens remains pending instead of guessing contracts.

The repository has not validated a wallet-filter request field for this endpoint. Coverage therefore remains token-centric and filters the discovered wallet locally after retrieving the complete token interval. This is conservative but may have low candidate yield or require too many pages. Adding a server-owned wallet filter requires separate contract evidence and review.

## Deterministic acquisition strategy

On the first live run, the workflow freezes a UTC-day anchor in ignored private state. For each reviewed token, discovery covers three adjacent non-overlapping ten-day windows spanning 40 to 10 days before that day. Pages are requested in ascending order and cached under a schema-versioned normalized request fingerprint. A cache hit makes no provider call and is excluded from call-success reporting.

Discovery accepts only runtime-valid Ethereum rows and selects observed trades at or above `$25,000`. It proposes `t0` at the next UTC-day boundary after the qualifying event and keeps only cutoffs 10–40 days before the frozen retrieval day. Discovery pages are candidate evidence only. They are never reused as complete scoring coverage and never compile directly into a round.

Each candidate gets a separate coverage work item for `[t0 - 30 days, t0 + 48 hours)`. Because the provider date filters are documented as inclusive, the request overlaps the local start by one millisecond and includes the local exclusive end. Normalization then reapplies the required half-open inequalities locally. Pages must arrive exactly once in sequence from page 1 through a validated `is_last_page=true`; missing, duplicate, out-of-order, prematurely terminal, nonterminal, malformed, timed-out, or request-mismatched evidence cannot become complete coverage. Events are sorted locally rather than trusting cross-page order.

The provider has not yet demonstrated terminal pagination, stable pages during acquisition, or exact boundary behavior. The implementation enforces its adapter contract; a later review must compare that contract with private live evidence before accepting real rounds.

## Conservative normalization and compilation

Every relied-upon row field is checked at runtime. The adapter requires:

- exact millisecond ISO UTC timestamps that round-trip without precision loss;
- syntactically valid Ethereum trader/token addresses and transaction hashes, normalized to lowercase;
- `BUY` or `SELL`, mapped provisionally to token-relative `buy` or `sell`;
- a finite, nonnegative numeric `estimated_value_usd` that is not signed zero; and
- the requested token address on every returned row.

Nansen did not expose a provider-stable event/leg ID in the bounded spike. Adapter version 1 derives `derived-v1:<sha256>` from the canonical full provider row. This is deterministic local provenance, not a claim that the provider guarantees identity across corrections or retrievals. Exact canonical rows may collapse. Rows with the same transaction, wallet, token, timestamp, and action but different canonical content reject as conflicts. Multiple distinct matching rows sharing one transaction hash reject the candidate as unresolved provider-leg ambiguity. Provider labels may exist in ignored raw/cache files but are not copied into normalized events, candidate summaries, reports, logs, or public output.

Only complete normalized evidence is offered to `compileRound` in `lib/rules.ts`; scoring is not reimplemented in the adapter. Coverage objects explicitly span the rules-v4 lookback and answer window and use the latest successful page retrieval time as `observedAtMs`. An incomplete or rejected normalization has no coverage and cannot produce Buy, Sell, or No trade.

## Private state and publication boundary

All live artifacts use separate ignored paths:

- ledger and lock: `data/ledgers/nansen-acquisition.json` and `.lock`;
- resumable state, cache, and raw pages: `data/private/nansen-acquisition/`;
- private candidate manifest: `data/private/nansen-acquisition/candidate-manifest.json`;
- sanitized counts-only report: `data/private/nansen-acquisition/aggregate-report.json`.

Private directories require mode `0700`; files require `0600`, current-user ownership, regular-file types, and no symlink traversal. The candidate manifest records stable candidate ID, token, private wallet, proposed cutoff, source request IDs/pages, retrieval time, coverage, compiler result or rejection, and rules/adapter versions. Raw rows, exact trades, provider labels, wallets, hashes, answers, and provenance stay ignored and private.

The aggregate report contains counts only: discovery and coverage calls, rows, candidates, rejection counts, scorable action counts, attempts, successes, and credits. It is sanitized but remains in the ignored private workspace by default. The workflow never commits or publishes real fixtures. A later explicit review/publish step must use an allowlist boundary consistent with the existing serializer and omit wallet addresses, hashes, source IDs, exact timestamps, exact values, answers before guessing, and outcome evidence. Relative times and size bands reduce trivial lookup but do not guarantee anonymity.

## Budget, accounting, and resumption

The closed contract-spike ledger is never opened or modified. Combined-success status starts from the documented constant of three successful spike calls.

The acquisition ledger has hard limits of 130 new upstream attempts and 130 retained/reported credits. Each request reserves one credit durably before fetch. Pending attempts and missing usage information retain the reservation. A successful response must report exactly one credit cost and one credit used; missing, malformed, or unexpected pricing stops the run. Authentication, authorization, plan, payment, and credit errors stop immediately. HTTP 429 and the bounded transient status set may retry once when `Retry-After` is acceptable; every retry is a new reserved attempt. Requests are spaced by at least 500 ms, approximately two per second. Raw-write failure retains already observed status and credit evidence.

The internal target is 120 total successful calls: 3 closed spike successes plus at most 117 useful acquisition successes. This supplies a margin over the updated Academy wording of **100+ calls** while avoiding calls made only to inflate usage. The older campaign page still says **1,000**, so eligibility remains unresolved. Cache hits, dry runs, failures, and planned requests do not count as successful qualifying calls.

The manually observed dashboard balance after the spike was **1,092 credits**. It is historical manual evidence, not a balance inferred by this workflow. The implementation does not query a balance endpoint.

An exclusive canonical lock covers the entire live run. State and request caches make normal stops resumable. A crash-left lock fails closed and requires manual inspection; it is not automatically deleted. Changing the working directory does not relocate canonical state. Separate clones and worktrees cannot coordinate this local ledger and are forbidden for live acquisition.

## Commands

Default dry-run is sanitized, keyless, network-free, and non-mutating:

```bash
npm run nansen:acquire
```

Keyless status reads only the new acquisition ledger:

```bash
npm run nansen:acquire -- --status
```

After independent review and a new explicit authorization, the first bounded pilot command is exactly:

```bash
npm run nansen:acquire -- --live --max-new-calls 10 --target-total-success 120
```

Do not run that live command from another clone/worktree, with a residual lock, or without reviewing the private path metadata and remaining allowance. The per-run limit must fit within both remaining global attempts and retained credits. A later run uses the same explicit flags and a newly authorized bound; credential presence alone is not authorization.

## Evidence and unresolved provider questions

This implementation milestone used synthetic provider responses and temporary roots only. It made zero Nansen calls, used zero credits, did not read the canonical key, and did not inspect the real spike ledger, raw responses, or acquisition artifacts.

Provider direction remains observed but provisional. Stable leg identity, multi-leg representation, corrections across retrievals, USD semantics, inclusive boundaries, terminal pagination, cross-page stability, candidate yield, and whether token-centric coverage fits the budget remain unresolved. No real candidate is accepted, exported, or published until private live evidence is reviewed against these assumptions.
