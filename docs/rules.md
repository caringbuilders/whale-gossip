# Deterministic rules contract

`lib/rules.ts` is a pure offline rules module. A bounded Nansen page confirmed several source field names and basic types, but its normalized event interface remains **provisional** until direction, stable leg identity, pagination, boundary, and completeness semantics are validated. The module performs no network, database, environment-variable, or UI work.

Rule behavior is versioned. Version 4 retains the version 3 normalization and coverage rules and rejects numeric negative zero as an invalid USD value.

## Window and threshold conventions

- The 30-day lookback is `[t0 - 30 days, t0)`. Its start is inclusive; `t0` is excluded.
- The answer window is `[t0, t0 + 48 hours)`. `t0` is included; the 48-hour endpoint is excluded.
- Visible-tape and dollar thresholds are inclusive: `$500`, `$2,500`, and `$25,000` qualify exactly.
- The visible tape is the last five qualifying pre-cutoff events, returned chronologically. It never contains an event at or after `t0`.
- Admission is one featured-token trade of at least `$25,000` during the lookback. Admission is an acquisition eligibility rule; it does not change which event determines the 48-hour answer.
- The first individually validated featured-token event worth at least `$2,500` in the answer window determines Buy or Sell. A completely observed window with no such event determines No trade.
- All timestamps are safe-integer Unix epoch milliseconds representing fixed UTC instants.

The proposal also requires initial cutoffs to be 10–40 days before retrieval. A future acquisition workflow must enforce that eligibility constraint when selecting a candidate and record retrieval time as provenance. The pure compiler receives a fixed `t0`; it verifies only the 30-day lookback and 48-hour scoring contract. Waiting ten days does not prove pagination, successful retrieval, or coverage completeness.

## Runtime input and identifier handling

`compileRound` accepts `unknown` and validates JSON-shaped input at runtime. Missing or malformed top-level fields, coverage objects, events, timestamps, actions, values, and identifiers return a typed unscorable result rather than throwing.

The round token and wallet, and every event token and wallet, must be syntactically valid Ethereum addresses: `0x` followed by 40 hexadecimal characters. Addresses are lowercased for internal comparison and output so case-only differences cannot silently hide matching events. This is syntax validation and deterministic normalization only. It does not validate checksum casing, contract existence, address type, or Nansen's actual response format. The acquisition adapter remains responsible for validating provider fields and retaining the original source representation in private provenance.

The chain identifier remains exactly `ethereum`. Every supplied event must also use exactly `ethereum`; an event marked `Ethereum`, `eth`, another chain, or an empty value is invalid input even when its token or wallet would otherwise be irrelevant. The future acquisition adapter must supply only normalized Ethereum events. Provider chain aliases and casing have not been validated.

Every transaction hash must be `0x` followed by exactly 64 hexadecimal characters. Valid hashes are lowercased before duplicate comparison and transaction grouping. Missing, whitespace-only, shortened, nonhex, or otherwise malformed hashes are invalid. Three sampled provider rows used this syntax, but that observation does not validate that a transaction exists or establish how provider rows map to transaction legs.

## Completeness and conservative rejection

Coverage is mandatory for the lookback and answer window. Each segment must have status exactly `complete`, a valid half-open range covering the full required interval, and no contradictory failure fields. Missing, malformed, unknown, explicitly incomplete, insufficient, or contradictory evidence is unscorable. `observedAtMs` must be a safe integer at or after the answer-window end, and neither claimed coverage end may be later than `observedAtMs`. An event array, an empty result, elapsed time, or a ten-day-old cutoff cannot establish completeness.

A null, non-finite, negative, or numeric negative-zero USD value on a matching event inside either required window is conservatively relevant and makes the round unscorable. Negative zero is detected with `Object.is(usdValue, -0)` because ordinary less-than comparison treats it like zero. This may reject some events a future validated schema could safely exclude, but it cannot silently create No trade or change the visible tape.

All event records are structurally validated before scoring. When several invalid events exist, failure selection uses a fixed field priority and stable event-ID ordering. Relevant invalid USD failures use chronological ordering followed by stable event ID. This makes the selected reason independent of input order.

## Duplicates and ambiguous transactions

Repeated records are deduplicated only when they have the same stable event/leg ID and identical normalized fields. A reused ID with conflicting fields is rejected. Duplicate conflicts are checked across all events matching the round's chain, token, and wallet before time-window filtering, so moving a conflicting pair outside the scoring interval cannot hide it. Different event IDs remain distinct even when they share a transaction hash.

Transaction grouping considers every validated featured-token leg in the answer window after exact deduplication, including legs individually below `$2,500`. A transaction with multiple legs whose nonnegative USD values sum to at least `$2,500` is treated only as a **potentially material ambiguity**:

- if no individually material event exists, any such ambiguity in the answer window is unscorable;
- if an individually material event exists, an ambiguity at or before that first event is unscorable;
- an ambiguity after the already determined first material event does not change the answer;
- separate individually material events tied at the earliest timestamp are unscorable.

The combined leg amount is a conservative ambiguity trigger only. It is not a verified trade value, a netting rule, an instruction to combine swaps, or a new way to score Buy or Sell. Actual provider leg structure, transaction direction, aggregation semantics, and stable identifiers remain unresolved.

## Private compilation boundary

A scorable compilation is private internal data. It contains wallet identity, source event IDs and transaction hashes, the answer, and outcome evidence. It must never be returned directly as the public question.

A future public question serializer must use an explicit allowlist and omit at least:

- wallet identity and any raw provider labels;
- transaction hashes and internal event IDs;
- the answer and all outcome evidence;
- exact event, cutoff, lookback-start, and answer-window timestamps;
- exact USD values;
- private provenance and raw acquisition records.

Public clues must express event timing relatively and trade size through reviewed bands rather than exact timestamps or USD amounts. These transformations reduce trivial transaction lookup but do not guarantee wallet anonymity: a distinctive sequence of public clues may still be identifiable when compared with public chain data. The serializer and its answer-leakage tests do not exist yet.

## Future acquisition-adapter guarantees

The bounded spike observed one incomplete page and does not satisfy this boundary. Before real events may enter this module, the acquisition adapter and candidate-selection workflow must:

1. Enforce the proposal's initial 10–40-day cutoff-selection range using recorded retrieval time, separately from the rules compiler.
2. Verify that the provider endpoint returns token-relative Buy/Sell direction and map it to lowercase `buy` or `sell`.
3. Validate and canonicalize Ethereum, featured-token, wallet, chain, and transaction identifiers consistently while retaining original private provenance; pass only events whose normalized chain is exactly `ethereum`.
4. Convert timestamps to safe-integer UTC epoch milliseconds without losing ordering precision.
5. Produce a stable unique `eventId` for each transaction leg and retain the transaction hash; pagination duplicates must reuse the same ID while distinct legs must not.
6. Normalize estimated USD values without replacing missing or invalid values with zero and without inventing aggregation or netting semantics.
7. Exhaust pagination for both required windows, retain page-level failures, and issue `complete` coverage only after checking the requested ranges and successful termination.
8. Set `observedAtMs` from a trustworthy retrieval clock and never mark an unfinished historical answer window complete.
9. Preserve immutable source/provenance metadata outside this pure module so a compiled round can later be audited and versioned.

The synthetic test events exercise this internal contract only. They are not verified historical rounds, provider fixtures, evidence of a live integration, or evidence of provider completeness.

Duplicate conflicts are deliberately checked only among events matching the compiled round's normalized token and wallet. Whether one provider event ID can conflict across unrelated wallets or tokens remains a low-priority provider question; broadening that rejection boundary without response-schema evidence could conflate unrelated identifier namespaces.
