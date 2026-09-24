# Nansen acquisition design and runbook

This document describes the corrected boundary for acquiring private real-round candidates. The first design was rejected in review before it made any provider calls. The six-call pilot and its version 3 state/cache are preserved private evidence. Adapter/state/schema version 4 adds a narrow timestamp correction and separate derived state/cache. Normal development, tests, dry-run, status, cache diagnosis, cache reprocessing, compilation, and the public application remain network-free.

## Fixed provider boundary

The workflow permits only `POST https://api.nansen.ai/api/v1/tgm/dex-trades`. It validates the exact HTTPS protocol, host, path, lack of query/fragment/credentials, request method, and server-owned body. Every request uses `chain: "ethereum"`, `only_smart_money: false`, ascending `block_timestamp`, and page size 100. Redirect following is disabled and every request has an abort timeout.

The reviewed token universe currently contains only canonical Ethereum WETH9 at `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`. No other address has comparable repository evidence, so expansion to three–five non-stable tokens remains pending.

Candidate coverage adds `filters.trader_address`. The value comes only from a syntactically validated and normalized discovery row; it is never CLI or browser input. Discovery requests omit this filter. Each candidate coverage request includes both the fixed token and its candidate wallet. Supplied aggregate evidence says the filter was consistently enforced across 91 coverage pages for one candidate. Page 91 remained nonterminal, so terminal pagination, complete-window cost, and completeness remain unresolved.

## Bounded discovery sampling

On first live initialization, the workflow freezes a UTC-day retrieval anchor in ignored private state. WETH discovery samples three deterministic, non-overlapping six-hour periods beginning approximately 36, 26, and 16 days before retrieval. Qualifying rows propose next-day UTC cutoffs approximately 35, 25, and 15 days before retrieval, within the proposal's 10–40-day eligibility range.

Discovery is sampling only. Each window is capped at two pages, so a fresh workflow can spend no more than six discovery calls. The scheduler samples page 1 across every window before doing other work. If valid candidates appear, it prioritizes their candidate-specific coverage before optional second discovery pages. It never continues a discovery item beyond page 2, never labels a capped window complete, and stops below the run allowance when no useful work remains. Every valid discovery page is processed immediately; a terminal page is not required to nominate candidates.

Discovery duplicates are counted categorically within a page and cannot create duplicate candidate work. The ignored aggregate report uses a field-by-field allowlist. Per page it records only row and validation counts, categorical rejection reasons, `$25,000+` row count, distinct candidate-fingerprint count, a coarse time-span band, returned pagination metadata, reported credit cost, and a latency band. It excludes addresses, hashes, labels, amounts, exact values, and exact timestamps.

## Candidate-specific coverage

Each candidate gets an independent work ID of `coverage-${candidateId}`, including candidates that share a cutoff. Its wallet-filtered request covers the actual local interval `[t0 - 30 days, t0 + 48 hours)`. The request overlaps the local start by one millisecond and includes the local exclusive end because provider date filters are documented as inclusive; normalization reapplies the half-open bounds locally.

Pages must arrive exactly once and in sequence from page 1 through validated `is_last_page=true`. Missing, duplicate, cross-page duplicate, out-of-order, prematurely terminal, nonterminal, malformed, timed-out, wallet-mismatched, or request-mismatched evidence rejects coverage. Exact duplicate candidate rows are treated as unstable pagination evidence and reject; they are never collapsed into a scorable result. Conflicting rows also reject. Events are sorted locally rather than trusting cross-page order.

Every received coverage page is validated before success accounting or caching. Each row must be structurally valid and its canonical wallet and token must equal the candidate request. A different wallet or token on any terminal or nonterminal page is categorized as `wallet-filter-not-applied`, settles the attempt as `invalid-response`, preserves reported/retained credits, records only safe aggregate coverage-page evidence, and stops the run. Structurally invalid rows use `invalid-coverage-row` with the same fail-closed treatment. An empty terminal page may participate in otherwise complete pagination. An empty nonterminal page continues conservatively and does not prove the provider honored the filter.

Coverage supplied to rules version 4 is derived from the work item's successfully retrieved local request bounds. A one-millisecond shortfall at either required boundary is unscorable. A provider terminal flag, discovery page, elapsed delay, or event array alone does not establish complete coverage.

## Conservative normalization and compilation

Every relied-upon row field is checked at runtime. Adapter version 4 accepts exactly `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.SSSZ`. Whole-second input is represented canonically as the same instant ending in `.000Z`, while private metadata retains `whole-second` as the source precision. This does not claim the provider supplied millisecond precision. Offsets, date-only values, other fractional precision, malformed or impossible dates, whitespace, and noncanonical parseable strings remain invalid. The adapter also requires valid Ethereum trader/token addresses and transaction hashes normalized to lowercase; `BUY` or `SELL`; a finite, nonnegative numeric `estimated_value_usd` that is not signed zero; the requested token; and, for coverage, the requested candidate wallet.

Nansen did not expose a provider-stable event/leg ID in the bounded spike. Adapter version 4 continues to derive private `derived-v1:<sha256>` event IDs from the canonical full provider row; the label describes the derivation format, not the adapter version or a provider guarantee. Timestamp canonicalization makes whole-second and exact `.000Z` representations of the same otherwise identical row share an ID. Multiple distinct matching rows sharing one transaction hash reject the candidate as unresolved provider-leg ambiguity. Provider labels may exist in ignored raw/cache files but are not copied into normalized events, candidate summaries, aggregate reports, logs, or public output.

Only complete normalized evidence is offered to `compileRound` in `lib/rules.ts`; scoring is not reimplemented in the adapter. Rejected or incomplete normalization has no coverage and cannot produce Buy, Sell, or No trade.

## Private state and durability

All live artifacts use ignored paths:

- ledger and lock: `data/ledgers/nansen-acquisition.json` and `.lock`;
- preserved version 3 state/cache: `data/private/nansen-acquisition/state.json` and `cache-v3/`;
- version 4 derived state/cache/provenance: `state-v4.json`, `cache-v4/`, and `reprocessing-v4.json` under the same private root;
- raw pages, private candidate manifests, and sanitized aggregate reports remain under `data/private/nansen-acquisition/`, with version 4 outputs named separately.

Private directories require mode `0700`; files require `0600`, current-user ownership, regular-file types, and no symlink traversal. Atomic JSON writes use a restrictive temporary file, rename, and containing-directory `fsync` where supported. A reservation is durably written before fetch; failure to persist or directory-sync it prevents the request. Fingerprints include adapter, state, and schema versions, request purpose, page, date bounds, token, chain, flags, ordering, and candidate wallet filter. Discovery and coverage cannot share a cache identity. Cache hits make zero upstream calls and do not increment attempt, success, discovery-call, or coverage-call counters.

The candidate manifest is private and contains identities and exact evidence. Aggregate coverage-page records contain only row/match/structural counts, a categorical rejection reason, a coarse time-span band, returned pagination, a latency band, and reported cost. The report builder copies those fields explicitly and rejects arbitrary nested properties. The aggregate report remains ignored by default. Acquisition never publishes fixtures. A later explicit review must use the existing public allowlist boundary and leakage tests.

## Budget, failure, and recovery

The closed contract-spike ledger is never opened or modified. Combined-success status starts from the documented constant of three successful spike calls. The acquisition ledger hard-caps new upstream attempts and retained/reported credits at 130. Each request reserves one credit before fetch. Pending attempts and missing usage information retain the reservation. Missing, malformed, or unexpected pricing stops the run. Authentication, authorization, plan, payment, and credit errors stop immediately. HTTP 429 and the bounded transient set may retry once when `Retry-After` is acceptable; every retry uses another durable reservation. Requests are spaced by at least 500 ms.

One reviewed live invocation accepts only a digits-only `--max-new-calls` value from 1 through 10. Decimal, exponential, signed, whitespace-padded, zero-padded, zero, and values above ten are rejected. The workflow is now frozen after 97 acquisition successes, for exactly 100 combined with the three closed spike successes. The updated Academy wording says **100+ calls**, while the older campaign page says **1,000**; organizer reconciliation remains unresolved.

The operating principle remains that calls should not be made merely to inflate a count. Every coverage call in this run requested a new sequential page for the proposed 32-day window, not an identical repeat. Early pages established consistent wallet-filter behavior and extreme density. After completion appeared unlikely within the available budget, the user separately authorized continued sequential coverage to the chosen Academy stop condition under deadline pressure. Later pages continued wallet/token consistency and density evidence but added limited diversity. No further discovery or coverage call is authorized.

The original pre-spike **1,095-credit** balance reconciles to the historical post-spike **1,092** after three spike credits. A separate later pre-discovery reading also displayed **1,095** when **1,092** was expected; that later reading alone remains unexplained/transient. The post-discovery **1,086** equals 1,092 minus six discovery credits. The final **995** equals 1,092 minus 97 acquisition credits.

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

The completed one-time offline reprocessing command was:

```bash
npm run nansen:acquire -- --reprocess-cache
```

It reads no credential and makes no network request. It takes the canonical acquisition lock, verifies exactly six known version 3 discovery caches against deterministic state and settled ledger attempts, preserves them, and writes separate durable version 4 derivatives with private provenance. A completed result is idempotent; partial or unexpected version 4 output requires manual review and is never overwritten or replayed automatically.

The historical live command shape was:

```bash
npm run nansen:acquire -- --live --max-new-calls 10 --target-total-success 120
```

Do not run that command: acquisition is frozen at exactly 100 combined successes. Credential presence and incomplete cached coverage do not authorize continuation. A possible single call for the required recorded live-data demonstration must use a new reviewed and explicitly authorized workflow; it must not resume the incomplete coverage sequence automatically. Do not run live acquisition from another clone or worktree.

## Evidence and unresolved provider questions

The canonical offline reprocessing ran once after synthetic tests. Its allowlisted report recorded six cache pages and 600 rows: 600 valid, zero invalid, 600 whole-second, zero exact-millisecond, one qualifying row, one distinct candidate, zero categorical rejections, and one planned coverage work item. It recorded zero network attempts, zero new ledger attempts, zero new successes, and zero new credits. Keyless status remained six attempts, six successes, six reported credits, six retained credits, zero coverage attempts, and nine combined successes. The command parsed protected cache/state internally but emitted no raw rows, identities, hashes, labels, exact timestamps, exact values, candidate IDs, or request bodies. It did not read the canonical credential or alter the ledger or version 3 evidence.

After reprocessing, the user separately authorized acquisition under the unchanged reviewed code. It continued to the supplied final aggregate totals: 97 acquisition attempts and successes, comprising six discovery and 91 candidate-specific coverage calls, with 97 reported and retained credits, no unknown charges, and no failures. Together with the three contract-spike successes, combined successes equal exactly 100. Claude did not independently approve each later 10-call run.

The supplied evidence says `filters.trader_address` was consistently enforced across all 91 coverage pages. Page 91 remained nonterminal. Complete coverage was not obtained, no real round compiled or became publishable, and the public game remains synthetic. Acquisition is frozen and no further discovery or coverage request is authorized.

Still unresolved: whether `filters.trader_address` behaves consistently beyond the supplied candidate; direction semantics; stable row and leg identity; multi-leg representation; corrections across retrievals; USD semantics; inclusive date-boundary behavior; terminal pagination and cross-page stability; discovery density and candidate yield; full-window cost; and whether reviewed real rounds may be redistributed. No real candidate is accepted, exported, or published until complete private evidence is reviewed against these assumptions.
