# Deterministic rules contract

`lib/rules.ts` is a pure offline rules module. Its normalized event interface is **provisional** until actual Nansen token DEX responses and provider semantics are validated. The module performs no network, database, environment-variable, or UI work.

## Window and threshold conventions

- The 30-day lookback is `[t0 - 30 days, t0)`. Its start is inclusive; `t0` is excluded.
- The answer window is `[t0, t0 + 48 hours)`. `t0` is included; the 48-hour endpoint is excluded.
- Visible-tape and dollar thresholds are inclusive: `$500`, `$2,500`, and `$25,000` qualify exactly.
- Events are matched by exact normalized chain, token, and wallet identifiers. The adapter must canonicalize identifiers before compilation.
- All timestamps are integer Unix epoch milliseconds. This represents fixed UTC instants without local-time parsing.
- The visible tape is returned chronologically and contains the last five qualifying pre-cutoff events. It contains no answer-window events.

## Completeness and conservative rejection

The compiler requires explicit coverage evidence for both windows. Event arrays cannot prove that an empty range is complete. Each complete coverage record must span its entire required half-open interval, and `observedAtMs` must be at or after the answer-window end. Missing pages, failed retrieval, range gaps, or an unfinished answer window make the round unscorable before an answer is selected.

A null, non-finite, or negative USD value on a matching event inside either required window is conservatively relevant and makes the round unscorable. This may reject some events a future validated schema could safely exclude, but it cannot silently create No trade or change the visible tape. Invalid matching timestamps are also rejected because their window cannot be established.

Repeated records are deduplicated only when they have the same stable event/leg ID and identical normalized fields. A reused ID with conflicting fields is rejected. Different event IDs remain distinct even when they share a transaction hash. If the earliest material answer belongs to a transaction with multiple material legs, or separate earliest material events share the same timestamp, the round is unscorable rather than advancing to a later event.

## Future acquisition-adapter guarantees

Before real events may enter this module, the acquisition adapter must:

1. Verify that the provider endpoint returns token-relative Buy/Sell direction and map it to lowercase `buy` or `sell`.
2. Canonicalize Ethereum, featured-token, and wallet identifiers consistently.
3. Convert timestamps to integer UTC epoch milliseconds without losing ordering precision.
4. Produce a stable unique `eventId` for each transaction leg and retain the transaction hash; pagination duplicates must reuse the same ID while distinct legs must not.
5. Normalize estimated USD values without replacing missing or invalid values with zero.
6. Exhaust pagination for both required windows, retain retrieval failures, and issue explicit coverage evidence only after checking the requested ranges.
7. Set `observedAtMs` from a trustworthy retrieval clock and never mark an unfinished historical answer window complete.
8. Preserve immutable source/provenance metadata outside this pure module so a compiled round can later be audited and versioned.

The synthetic test events exercise this internal contract only. They are not verified historical rounds, provider fixtures, or evidence of a live integration.
