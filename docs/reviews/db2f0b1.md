# Deterministic scoring review disposition

## Review target

- Commit reviewed: `db2f0b11eb3527cbb518acd8312138e8645be229`
- Commit subject: `feat: add deterministic round rules and synthetic tests`
- Review source: the Claude findings supplied for this correction task
- Disposition: corrections implemented locally; Claude re-review is pending

## Supplied findings

The review identified two blocking behaviors and related coverage gaps:

1. Coverage evidence was not runtime-checked to require status exactly `complete`; unknown or malformed discriminants could be treated as sufficient.
2. Multi-leg ambiguity detection considered individually material legs only, so individually subthreshold legs in a potentially material transaction could silently produce No trade or allow a later event to decide the answer.
3. Missing regression boundaries included exact-cutoff tape isolation, one-millisecond coverage gaps, invalid runtime fields, conflicts outside the scoring window, transaction-leg variants, and permutation-stable failures.
4. The runtime boundary trusted TypeScript types and could throw on malformed JSON-shaped input.
5. Identifier handling did not validate Ethereum address syntax or prevent case-only missed matches.
6. Duplicate conflicts were checked only after time-window filtering.
7. Documentation did not assign the proposal's initial 10–40-day cutoff-selection requirement or clearly separate acquisition eligibility from the 48-hour scoring contract.
8. Documentation did not state that compiled rounds are private or specify the sensitive fields a future public serializer must omit.
9. Failure selection was not guaranteed to be deterministic when several invalid events were present.

## Reproduction by Codex

Before changing the implementation, local offline probes against the reviewed commit reproduced the central behaviors:

- an answer-window coverage object with status `mystery` and sufficient range fields compiled as scorable No trade;
- two `$1,300` legs sharing a transaction hash compiled as No trade;
- the same ambiguous split transaction before a later `$3,000` Buy allowed the later Buy to decide the answer;
- case-only token and wallet differences caused a matching material event to be missed and produced No trade;
- conflicting records with the same event ID outside the required time windows were ignored;
- missing coverage and a non-string featured token could throw instead of returning an unscorable result.

These probes used synthetic local inputs. No external data or provider call was involved.

## Disposition

- **Addressed:** coverage parsing now accepts only the exact `complete` status with valid, noncontradictory ranges. Missing, malformed, unknown, explicitly incomplete, insufficient, and unfinished evidence has a typed failure.
- **Addressed:** ambiguity grouping includes every relevant featured-token answer-window leg after exact deduplication. A combined amount can trigger rejection but never supplies a scored value or direction.
- **Addressed:** malformed JSON-shaped inputs are runtime-validated and return typed unscorable results.
- **Addressed:** Ethereum addresses are syntax-checked and compared in lowercase; synthetic fixtures use valid address syntax.
- **Addressed:** duplicate conflicts across matching events are detected before time filtering.
- **Addressed:** invalid-event and invalid-value selection uses stable priority and sorting, with permutation regressions.
- **Addressed:** version 2 tests cover the requested cutoff, coverage, invalid-field, duplicate, ambiguity, and order boundaries.
- **Addressed in documentation:** the acquisition workflow will enforce the initial 10–40-day cutoff range; elapsed time alone does not establish completeness.
- **Addressed in documentation:** compiled rounds are private, and the future public serializer must omit wallet identity, transaction hashes, internal event IDs, answers, and outcome evidence.

## Deferred provider-dependent questions

No provider semantics were invented to close the findings. The adapter still needs bounded validation of token-relative direction, address and chain formats, timestamp precision, stable per-leg identity, transaction grouping, USD allocation, pagination termination, and coverage evidence. The combined-leg ambiguity trigger remains deliberately conservative until those questions are answered.

The public serializer and leakage tests are also deferred because this milestone does not add UI, API routes, persistence, or acquisition code.

## Verification status

Codex ran the offline rules tests (`npm test`, 26/26), lint (`npm run lint`, zero warnings), TypeScript checks (`npm run typecheck`), and `git diff --check`; all passed before the correction commit. No production build was run.

Claude has not independently repeated these correction checks, and this record does not declare the re-review complete.
