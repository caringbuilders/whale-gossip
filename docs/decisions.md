# Scope and architecture decisions

These decisions summarize `PROPOSAL-v3.md` as the agreed planning baseline. They do not assert implementation or independent validation of external claims. Record later scope changes here before coding them.

## Offline real-candidate acquisition workflow — September 24, 2026

- Keep bulk acquisition in local/server-only modules and a CLI that the public application cannot import. Default dry-run and status remain keyless and network-free; live mode requires the complete explicit flags and a separately authorized per-run allowance.
- Keep the reviewed token universe at canonical WETH9 until more non-stable ERC-20 contracts are verified without guessing. Candidate-specific coverage sends `filters.trader_address` with a wallet obtained from validated discovery. Supplied aggregate evidence says the filter was consistently enforced across 91 coverage pages for one candidate; wider provider behavior and terminal completeness remain unverified.
- Freeze three deterministic, non-overlapping six-hour discovery samples at approximately 36, 26, and 16 days before retrieval. Sample page 1 across all windows, cap every window at two pages and total discovery at six calls, process candidates after each valid page, and always label discovery sampled rather than complete. Coverage work takes priority after the initial spread so candidate-specific work can use the remaining pilot allowance.
- Give every candidate a unique `coverage-${candidateId}` work item and include its wallet in request identity/cache fingerprints. Use the work item's actual requested local bounds as coverage evidence, with provider-inclusive overlap and rules-v4 half-open validation.
- Continue canonical full-row fingerprints as private derived local event IDs. Do not describe them as provider-stable IDs. Candidate coverage rejects exact duplicates, cross-page duplicates, conflicting rows, and repeated matching transaction hashes while provider pagination and leg semantics remain unresolved. Discovery may count duplicates but never creates duplicate candidate work.
- Compile only complete candidate evidence through rules version 4. The acquisition layer establishes provider/page completeness and conservative normalization; `lib/rules.ts` remains the sole scoring implementation.
- Use a new ignored local acquisition ledger and lock with hard limits of 130 attempts and 130 retained/reported credits. Do not reopen, import, or mutate the permanently closed three-attempt spike ledger. Combined reporting adds the documented constant of three successes.
- Freeze acquisition at exactly 100 combined successes: three contract-spike plus 97 acquisition successes. This meets the current Academy page's 100+ wording subject to organizer reconciliation, but does not resolve the older 1,000-call campaign page. The general rule remains that calls should not be made merely to inflate a count. In this deadline-bound run, every coverage call requested a new sequential page, but once completion appeared unlikely the user separately authorized continuation to the chosen Academy stop condition. Later pages retained wallet/token consistency and density evidence while adding limited diversity. Record that exception candidly; it is not a precedent that threshold-seeking calls are inherently useful.
- Store raw data, caches, identities, exact evidence, compilation outcomes, and provenance only in ignored restrictive private paths. Generate a counts-only aggregate report. Real round publication remains a separate explicit human review using an allowlist serializer; acquisition never auto-publishes fixtures.
- Local canonical locking cannot coordinate separate clones or worktrees, so live acquisition from them is forbidden. Hosted/shared coordination remains future work.
- Version adapter, state, schema, cache, manifest, and sanitized report changes together. Fingerprints include those compatibility versions, request purpose, and all response-affecting request fields. Directory-sync atomic JSON writes where supported; an unpersisted reservation cannot authorize fetch.
- Before any coverage page can count as a success or enter cache, validate every row structurally and compare its canonical wallet and token with the candidate request. A mismatch on terminal or nonterminal pagination is `wallet-filter-not-applied`, is settled as an invalid response with conservative accounting, emits only allowlisted aggregate evidence, and stops the run. An empty page may continue pagination but cannot prove provider filter enforcement.
- Until a larger run is reviewed, one live invocation accepts only a digits-only call limit from 1 through 10. A crash-left lock, pending/unknown accounting, missing cache after success, malformed state, or cached validation failure stops automatic continuation. Recovery preserves evidence for review rather than deleting, editing, or replaying it.
- Keep cache diagnosis as an exact-flag, keyless, read-only server CLI mode. Use canonical state only to identify discovery fingerprints, read only the canonical protected cache, reject unknown or malformed inputs, and emit only explicit aggregate count categories. It must not create a lock, write reports, load credentials, or expose examples or private values.
- Version 4 accepts only canonical whole-second UTC (`YYYY-MM-DDTHH:mm:ssZ`) or exact-millisecond UTC (`YYYY-MM-DDTHH:mm:ss.SSSZ`). Canonicalize a whole-second source to the same instant ending in `.000Z` while retaining its `whole-second` source-precision metadata; do not describe that representation as provider-supplied milliseconds. Preserve rules-v4 half-open bounds and tied-earliest ambiguity, and reject every other timestamp shape.
- Reprocess the reviewed six version 3 discovery caches only through the exact keyless `--reprocess-cache` mode. Bind every source page to deterministic version 3 state and a settled ledger attempt, keep source state/cache immutable, take the canonical acquisition lock, and write separate durable version 4 cache/state/provenance. The migration contributes zero attempts, successes, and credits, is idempotent after completion, and fails closed on partial output. It may plan candidate coverage but cannot authorize it, establish completeness, or publish a round.
- No additional discovery or coverage acquisition is authorized after the 100-success freeze. A possible single call needed for the required recorded live-data demonstration is a separate future decision requiring a reviewed command, privacy-safe presentation, an explicit budget, and fresh authorization.

## Product

- Build Whale Gossip before returning to the separate 0600 news/wiki project; keep repository and hosted infrastructure separate.
- Launch on Ethereum with one featured token per round. Predict Buy, Sell, or No trade as the first material action in the next 48 hours. Five rounds yield a score out of five, a local streak, and a copyable challenge/result.
- Use a 30-day lookback, five visible trades of at least $500 strictly before the cutoff, and a $2,500 material threshold in the inclusive-start/exclusive-end answer window. Initial whale admission is one observed $25,000+ lookback trade. Version changes to these assumptions.
- Deterministic rules and evidence-based explanations govern both prepared and fresh rounds. Incomplete or ambiguous data is unscorable. No trade requires complete coverage, not an API failure.
- No runtime AI, accounts, social data, per-player analytics, PnL clues, market-cap buckets, crowd statistics, daily scheduling, or second chain at launch. Seven-day price follow-up is optional later work, disabled until clarified and verified; it would measure market movement, not realized profit.

## Data and architecture

| Boundary | Planned responsibility |
| --- | --- |
| Next.js App Router + TypeScript browser UI | Display public questions, submit guesses, show reveals, retain local streaks |
| Next.js server on Vercel | Select rounds, serialize public fields, grade, normalize provider responses, enforce live controls |
| Supabase | Private rounds/provenance, shared cache, attempt ledger, budgets, request limits, live-deal idempotency |
| Nansen REST | Historical observed activity through server code or an explicitly enabled acquisition script |
| Bundled reviewed fixtures | Keyless play, offline development, and zero-spend fallback |

Use ordinary `tgm/dex-trades` with the fixed token, `only_smart_money=false`, no Smart Money label filters, and no displayed trader labels. Discovery is token sampling; candidate coverage provisionally supplies `filters.trader_address`, whose provider acceptance and enforcement remain unverified. A bounded probe confirmed the basic response shape but never exercised that wallet filter and returned label fields; the adapter must discard label contents from public and fixture output. Direction semantics, wallet-filter behavior, stable leg identity, complete pagination, and redistribution review remain unresolved. Attribute “Powered by Nansen API”. Keep wallet identities and raw responses private; publish reviewed transformed fixtures only.

Separate a pure rules module from server adapters and storage. The synthetic offline game now uses server-rendered allowlisted question props and `POST /api/guess` for guess/reveal. Future real/live work may add question (`/api/round`) and guarded fresh retrieval (`/api/deal`) routes. Planned scripts beyond the closed contract spike cover resumable acquisition, reviewed publishing, and usage reporting.

Cache by endpoint, normalized parameters, and schema version. Freeze source snapshots and version decks/rules so shared challenges remain reproducible. Withhold answers from runtime question payloads; acknowledge that public fixture source is inspectable.

## Cost and resilience

Offline is the default. A 30-credit local spike precedes bulk acquisition; the proposal's total planning ceiling is 1,500 credits, not purchase authorization. Public live mode starts disabled, with proposed limits of 3 deals/minute per hashed IP, 4 credits/deal, and 100 credits/UTC day within the remaining project ceiling.

Reserve credits atomically before requests, count in-flight reservations, settle actual charges conservatively, and reuse deal IDs. Durable controls are mandatory for hosted paid work. Storage failure stops paid acquisition while bundled play remains available. Cached fallback must never be presented as successful fresh retrieval.

## Delivery and evidence

Codex implements small milestones; Claude independently reviews a named commit/diff; Codex resolves accepted findings. Pin dependencies and preserve the lockfile when introduced. Use Node LTS at least 22 and match development/deployment versions.

The proposal targets ten real reviewed rounds and one complete live flow first, then deck expansion and hardening. Its internal submission target is September 26, 2026 at 23:59 America/New_York. Its 1,050-call plan was based on the then-published 1,000-call requirement and remains historical context. On September 23, the newer official Academy article said 100+ calls, while the campaign landing page still displayed 1,000. Reconcile the current requirement and submitting-account usage before submission. Do not generate wasteful calls to inflate counts.

## Bounded contract spike — September 23, 2026

The local spike is a server/local-only script and support module, not application integration. It defaults to dry-run, hard-allows one endpoint, uses fixed bounded requests, reserves each attempt durably before send, and now permits no more than three total attempts or three retained credits for this contract milestone. Raw responses and the ledger remain in ignored private paths. Normal tests and application commands make no provider request; `npm test` automatically preloads the outbound-network guard.

One explicit live request is sufficient for this milestone unless it fails transiently. The completed probe used one attempt and one provider-reported credit, so no retry or follow-up page was requested. `is_last_page=false` is evidence that the response page was incomplete, not authorization to mark coverage complete or continue acquisition.

After review, the local safety boundary includes an exclusive filesystem lock around the complete live run, canonical repository-root paths, no-follow private-file operations, and `redirect: "error"`. Crash-left locks do not expire automatically. Separate clones and worktrees must not be used to bypass the local ledger because each has independent private state. These controls remain local spike controls, not a substitute for the future shared hosted reservation system.

The prepared pagination probe is a separate mode requiring the exact flags `--live --pagination-probe`. It may start only from the ledger's exact one-attempt historical success state; the original page-1 mode requires an empty ledger and cannot spend continuation slots. Pagination requests page 2 once and page 3 only after a valid nonterminal page 2, with no retries and an unconditional stop after page 3. The historical attempt plus at most two new reservations exhausts the three-attempt ceiling. These pages cannot establish complete scoring coverage, and a separate future acquisition workflow must handle any later pagination.

The approved pagination probe ran once on September 24 and consumed both remaining reservations successfully. Pages 2 and 3 each returned three rows and `is_last_page=false`; the script stopped after page 3. The three-attempt contract-spike milestone is permanently closed. No further contract-spike call is permitted. Future acquisition requires a new reviewed workflow and explicit authorization, with complete-window evidence handled separately from this bounded schema probe.

## Synthetic offline game milestone — September 24, 2026

The offline game uses ten compiled private synthetic rounds and a deterministic five-round selection. Private fixture data stays under `lib/server/`; a pure explicit-allowlist serializer is the only conversion into browser question and reveal payloads. Question props contain relative time, size bands, fictional display identities, and visible pre-cutoff tape only. Answers are looked up by a server-owned round ID after a valid guess.

The `/api/guess` boundary accepts no caller-supplied events, provider endpoints, wallet/token addresses, or request bodies. It is intentionally a small offline demonstration boundary. It prevents accidental initial-payload disclosure but does not provide user authentication, rate limiting, session ownership, or anti-cheat guarantees.

The game uses the accepted rules version 4 without changing scoring or provider-spike code. All fixtures are invented contract tests and UI content; none is a Nansen observation, a reviewed historical round, or evidence of provider completeness. The milestone installs no packages, makes no provider call, and consumes no credits.

## Synthetic-game hardening and public-policy decision — September 24, 2026

Private fixtures now use the framework-supported `server-only` import. The client treats server JSON as unknown, accepts only the complete allowlisted response shape, and ties each response to its submitted round, guess, request ID, and game generation. A ref-based gate closes the immediate double-activation interval before React state rerenders.

Question serialization must be answer-independent by construction and regression test: changing all answer-window events and the resulting answer while keeping pre-cutoff evidence fixed must produce identical question bytes. Fixed expected actions across every played round and guess protect scoring tests from self-confirming mutations.

The current offline release includes `/terms` and `/privacy` with an effective date of September 24, 2026. Both pages, working footer links, the short no-advice notice, accurate collection language, and clear synthetic-data attribution are prerequisites for public deployment. Re-review and update the policies before accounts, analytics, Supabase persistence, production live mode, new hosting/logging practices, or any other collection. No consent banner is introduced because this milestone adds no optional cookies or application analytics.

## Offline skeleton milestone — September 22, 2026

The authorized first application step is a static App Router landing page only. It explains the future game without rounds, results, or simulated live functionality. No API routes, authentication, database clients, or acquisition scripts are introduced. Plain CSS and system fonts keep the page self-contained; Next.js telemetry is disabled in npm scripts.

Scaffold files were added individually to preserve existing project documents. Node 24.21.0 is recorded in `.nvmrc`, the package engine requires Node 24, and exact direct dependency versions plus the npm lockfile define the installation. This advances the implementation in smaller steps without changing the product scope.

## Deterministic scoring milestone — September 22, 2026

The rules layer is a pure TypeScript module that accepts provisional normalized events plus explicit coverage evidence. It does not infer completeness from an event array and does not import framework, network, environment, storage, or UI code. The normalized shape uses exact canonical identifiers, integer UTC epoch milliseconds, token-relative lowercase actions, stable per-leg event IDs, transaction hashes, and nullable USD estimates. These are internal assumptions pending provider validation, not claims about the Nansen response schema.

Both the 30-day lookback and 48-hour answer window use half-open intervals. Exact dollar thresholds qualify. The returned tape is the last five qualifying pre-cutoff events in chronological order. Admission is evaluated across all validated matching lookback events, not only the displayed five.

Incomplete or failed coverage, an unfinished answer window, matching invalid values, conflicting duplicate IDs, insufficient tape, absent admission, an ambiguous first transaction with distinct material legs, and tied earliest material events are unscorable. Identical stable-ID records with identical fields are deduplicated. Different stable IDs are never collapsed merely because they share a transaction hash.

Conservative rejection takes precedence over creating a convenient answer. This first rules version rejects any matching null, non-finite, or negative USD value inside a required window because it could affect the tape, admission, or answer. Revisions after real schema validation must be versioned and backed by boundary tests.

The test suite uses Node's test API through the minimal `tsx` runner. All fixtures are explicitly synthetic and cannot count toward real-round acceptance or live verification.

## Scoring review correction — September 23, 2026

Rules version 2 replaces version 1 for future compiled rounds. Runtime input is checked independently of TypeScript declarations, and malformed JSON-shaped input returns a typed unscorable result. Coverage segments must use the exact `complete` discriminant and valid covering ranges; unknown, malformed, contradictory, explicitly incomplete, insufficient, or unfinished evidence cannot produce an answer.

Ethereum token and wallet addresses require `0x` plus 40 hexadecimal characters and are compared in lowercase. This resolves case-only mismatches deterministically. It is an internal syntax and comparison rule, not verification of checksums, contracts, wallet types, or provider address formats.

Duplicate conflicts among matching events are checked before scoring-window filtering. Exact duplicate legs are removed by stable event ID and identical normalized fields. For ambiguity detection, all remaining answer-window legs are grouped by transaction. Multiple legs whose nonnegative values combine to at least `$2,500` trigger conservative ambiguity handling even when every leg is individually subthreshold. The sum is not used as a scored trade, direction net, or provider-semantic claim. An ambiguity blocks at or before the first individually material event, and anywhere in the answer window when no individual material event exists. Later ambiguity cannot alter an already established first event.

Candidate acquisition and pure scoring have separate responsibilities. The future acquisition workflow enforces the proposal's initial cutoff selection of 10–40 days before retrieval and establishes pagination evidence. The compiler applies the 30-day lookback and 48-hour answer window to a supplied `t0`. Neither a ten-day delay nor an event array establishes complete provider coverage.

Compiled rounds are private records. The future public question serializer must use an allowlist that omits wallet identity, transaction hashes, internal event IDs, the answer, and outcome evidence. Provider normalization, public serialization, and their integration tests remain future milestones.

## Scoring normalization hardening — September 23, 2026

Rules version 3 requires every supplied event to use the exact normalized chain `ethereum`. Transaction hashes must have Ethereum syntax (`0x` plus 64 hexadecimal characters) and are lowercased before exact-duplicate checks and transaction grouping. These checks establish deterministic internal syntax only; transaction existence, provider formatting, and leg semantics remain unverified.

Coverage evidence is contradictory when either claimed segment end is later than `observedAtMs`. Missing and nonnumeric observation times remain malformed coverage. These conditions cannot produce Buy, Sell, or No trade.

Public question serialization remains future work. Its allowlist must omit wallet identity, source identifiers, answers, outcome evidence, exact USD values, and exact event/window timestamps. Public clues will use relative times and reviewed size bands. This reduces direct transaction lookup but cannot promise anonymity against public chain analysis.

Duplicate-ID conflicts remain scoped to events matching the compiled round's token and wallet. Conflicts across unrelated identities stay deferred until provider identifier namespaces are validated; rejecting them now could conflate unrelated records.
