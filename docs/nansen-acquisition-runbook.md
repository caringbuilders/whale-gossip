# Nansen acquisition design and runbook

This document describes the corrected boundary for acquiring private real-round candidates. The first design was rejected in review before it made any provider calls. Adapter/state/schema version 2 is implemented and tested only with synthetic responses and temporary private roots. Normal development, tests, dry-run, status, compilation, and the public application remain network-free.

## Fixed provider boundary

The workflow permits only `POST https://api.nansen.ai/api/v1/tgm/dex-trades`. It validates the exact HTTPS protocol, host, path, lack of query/fragment/credentials, request method, and server-owned body. Every request uses `chain: "ethereum"`, `only_smart_money: false`, ascending `block_timestamp`, and page size 100. Redirect following is disabled and every request has an abort timeout.

The reviewed token universe currently contains only canonical Ethereum WETH9 at `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`. No other address has comparable repository evidence, so expansion to three–five non-stable tokens remains pending.

The endpoint schema identified in the supplied review permits candidate coverage to add `filters.trader_address`. The value comes only from a syntactically validated and normalized discovery row; it is never CLI or browser input. Discovery requests omit this filter. Each candidate coverage request includes both the fixed token and its candidate wallet. This request shape is repository-reviewed but has not been sent to Nansen, so its live behavior, selectivity, pagination, and completeness semantics remain unverified.

## Bounded discovery sampling

On first live initialization, the workflow freezes a UTC-day retrieval anchor in ignored private state. WETH discovery samples three deterministic, non-overlapping six-hour periods beginning approximately 36, 26, and 16 days before retrieval. Qualifying rows propose next-day UTC cutoffs approximately 35, 25, and 15 days before retrieval, within the proposal's 10–40-day eligibility range.

Discovery is sampling only. Each window is capped at two pages, so a fresh workflow can spend no more than six discovery calls. The scheduler samples page 1 across every window before doing other work. If valid candidates appear, it prioritizes their candidate-specific coverage before optional second discovery pages. It never continues a discovery item beyond page 2, never labels a capped window complete, and stops below the run allowance when no useful work remains. Every valid discovery page is processed immediately; a terminal page is not required to nominate candidates.

Discovery duplicates are counted categorically within a page and cannot create duplicate candidate work. The ignored aggregate report uses a field-by-field allowlist. Per page it records only row and validation counts, categorical rejection reasons, `$25,000+` row count, distinct candidate-fingerprint count, a coarse time-span band, returned pagination metadata, reported credit cost, and a latency band. It excludes addresses, hashes, labels, amounts, exact values, and exact timestamps.

## Candidate-specific coverage

Each candidate gets an independent work ID of `coverage-${candidateId}`, including candidates that share a cutoff. Its wallet-filtered request covers the actual local interval `[t0 - 30 days, t0 + 48 hours)`. The request overlaps the local start by one millisecond and includes the local exclusive end because provider date filters are documented as inclusive; normalization reapplies the half-open bounds locally.

Pages must arrive exactly once and in sequence from page 1 through validated `is_last_page=true`. Missing, duplicate, cross-page duplicate, out-of-order, prematurely terminal, nonterminal, malformed, timed-out, wallet-mismatched, or request-mismatched evidence rejects coverage. Exact duplicate candidate rows are treated as unstable pagination evidence and reject; they are never collapsed into a scorable result. Conflicting rows also reject. Events are sorted locally rather than trusting cross-page order.

Coverage supplied to rules version 4 is derived from the work item's successfully retrieved local request bounds. A one-millisecond shortfall at either required boundary is unscorable. A provider terminal flag, discovery page, elapsed delay, or event array alone does not establish complete coverage.

## Conservative normalization and compilation

Every relied-upon row field is checked at runtime. The adapter requires exact millisecond ISO UTC timestamps; valid Ethereum trader/token addresses and transaction hashes normalized to lowercase; `BUY` or `SELL`; a finite, nonnegative numeric `estimated_value_usd` that is not signed zero; the requested token; and, for coverage, the requested candidate wallet.

Nansen did not expose a provider-stable event/leg ID in the bounded spike. Adapter version 2 continues to derive private `derived-v1:<sha256>` event IDs from the canonical full provider row; the label describes the derivation format, not the adapter version or a provider guarantee. Multiple distinct matching rows sharing one transaction hash reject the candidate as unresolved provider-leg ambiguity. Provider labels may exist in ignored raw/cache files but are not copied into normalized events, candidate summaries, aggregate reports, logs, or public output.

Only complete normalized evidence is offered to `compileRound` in `lib/rules.ts`; scoring is not reimplemented in the adapter. Rejected or incomplete normalization has no coverage and cannot produce Buy, Sell, or No trade.

## Private state and durability

All live artifacts use ignored paths:

- ledger and lock: `data/ledgers/nansen-acquisition.json` and `.lock`;
- resumable state, versioned request cache, and raw pages: `data/private/nansen-acquisition/`;
- private candidate manifest: `data/private/nansen-acquisition/candidate-manifest.json`;
- sanitized aggregate report: `data/private/nansen-acquisition/aggregate-report.json`.

Private directories require mode `0700`; files require `0600`, current-user ownership, regular-file types, and no symlink traversal. Atomic JSON writes use a restrictive temporary file, rename, and containing-directory `fsync` where supported. A reservation is durably written before fetch; failure to persist or directory-sync it prevents the request. Fingerprints include adapter, state, and schema versions, request purpose, page, date bounds, token, chain, flags, ordering, and candidate wallet filter. Discovery and coverage cannot share a cache identity. Cache hits make zero upstream calls and do not increment attempt, success, discovery-call, or coverage-call counters.

The candidate manifest is private and contains identities and exact evidence. The aggregate report is sanitized but remains ignored by default. Acquisition never publishes fixtures. A later explicit review must use the existing public allowlist boundary and leakage tests.

## Budget, failure, and recovery

The closed contract-spike ledger is never opened or modified. Combined-success status starts from the documented constant of three successful spike calls. The acquisition ledger hard-caps new upstream attempts and retained/reported credits at 130. Each request reserves one credit before fetch. Pending attempts and missing usage information retain the reservation. Missing, malformed, or unexpected pricing stops the run. Authentication, authorization, plan, payment, and credit errors stop immediately. HTTP 429 and the bounded transient set may retry once when `Retry-After` is acceptable; every retry uses another durable reservation. Requests are spaced by at least 500 ms.

Until a larger batch is separately reviewed, one live invocation accepts only a digits-only `--max-new-calls` value from 1 through 10. Decimal, exponential, signed, whitespace-padded, zero-padded, zero, and values above ten are rejected. The global 130 limits remain ceilings, but one current run cannot reach them. The internal target is 120 successful calls: three closed spike successes plus at most 117 useful acquisition successes. The updated Academy wording says **100+ calls**, while the older campaign page says **1,000**; eligibility remains unresolved. Calls are never made merely to reach a number.

The manually observed dashboard balance after the spike was **1,092 credits**. It is historical user-observed evidence, not a balance inferred or queried by this workflow.

An exclusive canonical acquisition lock covers a live run. A crash-left lock, a pending/unknown attempt, a successful attempt missing its cache, malformed private state, or cached row-validation failure stops automatic continuation. Settled persistent provider failures also stop the current run; a later invocation will refuse to repeat the same uncertain request without reviewed recovery evidence.

Safe recovery is evidence-preserving: stop all acquisition processes; do not delete the lock, ledger, state, cache, or raw response; inspect only approved metadata and keyless sanitized status; reconcile the attempt and reported account usage through an independent review; then create a specific reviewed recovery procedure or tool. Never edit accounting or replay an uncertain request by hand. Separate clones and worktrees cannot coordinate this local ledger and are forbidden for live acquisition.

## Commands

Default dry-run is sanitized, keyless, network-free, and non-mutating:

```bash
npm run nansen:acquire
```

Keyless status reads only the new acquisition ledger:

```bash
npm run nansen:acquire -- --status
```

After independent review and new explicit authorization, the first bounded pilot command is exactly:

```bash
npm run nansen:acquire -- --live --max-new-calls 10 --target-total-success 120
```

That command has not been run and is not authorized by credential presence. Before authorization, review canonical private-path metadata, the absence or disposition of any lock/pending attempt, remaining allowances, and the corrected commit. Do not run it from another clone or worktree.

## Evidence and unresolved provider questions

This correction used synthetic responses and temporary dummy roots only. It made zero Nansen or other external application calls, used zero credits, did not read the canonical credential, and did not inspect real ledgers, acquisition state, caches, locks, manifests, or raw responses.

Still unresolved: live acceptance of `filters.trader_address`; direction semantics; stable row and leg identity; multi-leg representation; corrections across retrievals; USD semantics; inclusive date-boundary behavior; terminal pagination and cross-page stability; discovery density and candidate yield; full-window cost; and whether reviewed real rounds may be redistributed. No real candidate is accepted, exported, or published until private pilot evidence is reviewed against these assumptions.
