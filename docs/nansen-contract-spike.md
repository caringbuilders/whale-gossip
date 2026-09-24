# Bounded Nansen contract spike

This document records a narrow authenticated probe of `POST /api/v1/tgm/dex-trades`. It is contract evidence for a future private acquisition adapter. It is not a round, complete-window evidence, a public integration, or authorization for bulk retrieval.

## Safety envelope

- The command defaults to dry-run. The original page-1 mode requires `npm run nansen:spike -- --live`. The separately bounded pagination mode requires the exact pair `--live --pagination-probe`; either flag alone is insufficient.
- The only allowed URL is `https://api.nansen.ai/api/v1/tgm/dex-trades`.
- The fixed request uses Ethereum WETH, `only_smart_money=false`, no label filters, a one-hour historical interval, ascending `block_timestamp`, and three records per page. The original probe uses page 1; pagination mode can use only pages 2 and 3 with every other request field unchanged.
- All credential, ledger, lock, and raw-response paths are derived from the script module's canonical repository root rather than the current working directory. The key parser reads only `NANSEN_API_KEY` from that repository's `.env.local`; it does not load unrelated values into `process.env`, and a shell variable cannot override the file.
- The durable ignored JSONL ledger reserves before sending and permits at most **three total actual attempts and three retained credits for this milestone**. The one historical page-1 attempt therefore leaves room for no more than two further requests. Missing or malformed credit-usage headers retain the one-credit reservation.
- Before the first live reservation, the runner exclusively creates `<ledger>.lock` with restrictive permissions and holds its descriptor for the complete run. A competing or crash-left lock fails closed before reservation or fetch. The lock is released only in the normal `finally` path after its descriptor closes.
- The original page-1 mode has one bounded retry only for HTTP 408, 429, 500, 502, 503, or 504. Requests are separated by at least 500 ms, and an excessive or malformed `Retry-After` stops the run. Pagination mode has no retry for any outcome.
- Fetch uses `redirect: "error"`, so one reservation invokes fetch once and cannot follow a redirect with the API key or body. HTTP 401, 402, and 403 stop the run. Unexpected pricing, malformed successful envelopes, exhausted caps, unsafe paths, unsafe environment-file tracking, and non-allowlisted URLs also stop.
- `.env.local`, the raw response, and the ledger are ignored private artifacts. The ledger contains a request fingerprint and accounting metadata, not the API key, authorization header, raw request body, wallet values, or response body.

Normal `npm test`, lint, type checking, application development, and builds do not invoke the live command or send Nansen requests. The standard `npm test` script automatically preloads `test/offline-network-guard.mjs`; a sanity test requires dummy fetch and raw-socket calls to be blocked. Runner tests inject in-memory fetch implementations.

## Pagination probe preparation

Pagination mode acquires the same exclusive lock before inspecting accounting. It refuses to reserve or fetch unless the private ledger contains exactly one reservation and matching settlement for the fixed page-1 request, with HTTP 200, successful outcome, reported cost and use of one credit, no unknown charge, and one retained credit. The original page-1 live mode now requires an empty ledger, so it cannot consume the two continuation slots after the historical success.

From that exact state it requests page 2 once. Any redirect, timeout, 429, 5xx, authentication/plan/credit response, malformed or mismatched pagination, raw-write failure, or pricing mismatch stops after that attempt. A valid page 2 with `is_last_page=true` also stops. Only a valid page 2 with `is_last_page=false` permits one page-3 request, after which the script stops regardless of the page-3 pagination flag. Pages 2 and 3 remain contract evidence only: they never establish complete lookback or answer-window coverage.

The preparation commit made zero Nansen or other external calls and consumed zero credits. Claude's approval of the prepared commit is recorded in `docs/reviews/6e4096a.md` with the limits of the supplied evidence.

## Pagination execution — September 24, 2026

The exact approved command was invoked once. It made two new attempts with no retries and stopped after page 3 as designed.

| Evidence | Page 2 | Page 3 |
| --- | ---: | ---: |
| Outcome | success | success |
| HTTP status | 200 | 200 |
| Script-measured latency | 1,103 ms | 494 ms |
| `X-Nansen-Credits-Cost` | 1 | 1 |
| `X-Nansen-Credits-Used` | 1 | 1 |
| Rows | 3 | 3 |
| Returned page / per-page | 2 / 3 | 3 / 3 |
| `is_last_page` | false | false |
| BUY / SELL / other | 2 / 1 / 0 | 2 / 1 / 0 |

Both envelopes were structurally valid with no reported summary issues or request/schema contradiction. Every reviewed field was present in all three rows on each page. Timestamps, transaction hashes, trader addresses, action, token addresses/names, and counter-token addresses/names were strings. Token amounts, counter-token amounts, estimated swap prices, and estimated USD values were numbers. All timestamps were parseable and ascending within their returned page. All three transaction hashes and trader addresses on each page matched Ethereum syntax and were distinct within that page; all token addresses matched Ethereum syntax and the fixed WETH probe token after normalization. All six estimated USD values were finite nonnegative numbers, with no null, other-type, negative, or signed-zero observations.

The reviewed summary did not expose minimum or maximum timestamps, so none are recorded. Exact timestamps and all private values remain only in ignored raw evidence.

The two new attempts produced two successes and reported two credits cost and two credits used. Combined with the historical page-1 call, sanitized status reported three attempts, three settlements, three successes, three reported credits used, zero unknown-charge attempts, and three retained credits. The three observed cost headers also sum to three. No current account balance was queried or inferred.

Neither page 2 nor page 3 reported `is_last_page=true`. Page 3 explicitly reported more pagination while the reviewed script stopped at its milestone boundary. These pages do not prove complete query, 30-day lookback, or 48-hour answer-window coverage. The three-attempt contract-spike milestone is permanently closed. Further provider acquisition requires a new reviewed and explicitly authorized workflow.

### Crash-left lock recovery

Locks do not expire and the runner never removes a pre-existing lock automatically. From the canonical repository root:

1. Confirm no spike process is running, for example with `ps -ef | rg '[n]ansen-contract-spike'`. Do not remove the lock when any matching process remains.
2. Run `npm run nansen:spike -- --status`. This reads the sanitized ledger accounting summary without loading the key or making a network request. Review attempts, settlements, successes, reported usage, unknown charges, and retained credits locally; do not print or copy the private JSONL file.
3. Only after confirming there is no runner and reconciling the sanitized accounting, remove `data/ledgers/nansen-contract-spike.jsonl.lock` manually. A malformed or uncertain ledger remains a stop condition even after lock removal.

Each clone or worktree has a separate local ledger and lock. Never bypass a lock or budget by running live acquisition from another clone, worktree, or copied repository. The no-follow checks and same-inode release check fail closed against observed path replacement, but a process running as the same user can still race the final path check and unlink. Do not manipulate private paths while the runner is active; eliminating that cleanup race requires a stronger OS-level coordination boundary than this local script provides.

## Live observation — September 23, 2026

The reviewed dry run sent no request. The subsequent explicit live run made one actual attempt and then stopped successfully:

| Evidence | Observed result |
| --- | --- |
| HTTP result | 200 |
| Latency measured by the script | 920 ms |
| `X-Nansen-Credits-Cost` | 1 |
| `X-Nansen-Credits-Used` | 1 |
| Attempts / successes | 1 / 1 |
| Retries | 0 |
| Response rows | 3 |
| Pagination | page 1, per-page 3, `is_last_page=false` |

The user reported a pre-task balance of **1,095 credits**. That number is manual account evidence, not an API-derived balance. The task did not query or record a post-task balance, and this record does not infer why the starting balance was five below 1,100.

## Sanitized response contract

The successful JSON envelope contained a `data` array and a `pagination` object with numeric `page` and `per_page` plus boolean `is_last_page`. Every one of the three sampled records contained these fields:

- `block_timestamp`: string, parseable as an ISO timestamp; the page was ascending as requested.
- `transaction_hash`: string; all three matched Ethereum hash syntax and were distinct in this sample.
- `trader_address`: string; all three matched Ethereum address syntax, representing two distinct addresses in this sample.
- `trader_address_label`: string. The endpoint returned labels even though the request used no label filters. The future adapter must discard label contents from public and reviewed fixture output.
- `action`: string; all three sampled values were `BUY`.
- `token_address`: string; all three matched Ethereum address syntax and the requested token after case normalization.
- `token_name`: string.
- `token_amount`: number.
- `traded_token_address`: string.
- `traded_token_name`: string.
- `traded_token_amount`: number.
- `estimated_swap_price_usd`: number.
- `estimated_value_usd`: number; none of the three values was null, nonnumeric, or negative.

This proves only the observed shape of one page. The tracked summary intentionally omits raw addresses, hashes, label text, names, timestamps, and exact USD values. The full response remains under `data/private/nansen-contract-spike/`; the accounting ledger remains under `data/ledgers/`. Both paths are ignored.

## What remains unknown

- `is_last_page=false` on all three observed pages proves that the bounded sample is still incomplete. No claim of full query, lookback, answer-window, or No trade coverage is possible.
- The response has no explicit transaction-leg or event ID. A stable per-leg identifier across pages, retries, corrections, and repeated retrievals remains unresolved. A transaction hash alone cannot safely merge distinct legs.
- `BUY` and `SELL` rows were observed, but they do not prove that `action` is token-relative for every swap shape. No verified multi-leg, tied-time, duplicate, corrected, missing-value, empty-page, or terminal-page case was observed.
- Timestamp precision and within-timestamp ordering, request-boundary inclusivity, pagination stability, maximum historical coverage, and empty terminal behavior remain unverified.
- All nine sampled rows show numeric `estimated_value_usd`; this does not establish whether that field is always populated or is the correct threshold value for every swap form.
- Retry, rate-limit, authentication-error, plan-error, insufficient-credit, failed-request charging, and missing-credit-header behavior were covered only by offline control tests, not live responses.
- Redistribution terms and public fixture review remain separate release checks. Raw labels and wallet identities remain private.

The pure scoring rules remain unchanged and provisional at their provider boundary. This probe must not be used to weaken their conservative rejection behavior.

## Offline correction after review

Claude's review of `fa1249f` found redirect forwarding and concurrent reservation blockers and identified missing loop tests. The correction adds redirect rejection, an exclusive run lock, canonical paths, isolated key parsing, no-follow private-file operations, response-header-first accounting, and direct runner regressions. The full review and disposition are recorded in `docs/reviews/fa1249f.md`.

This correction made **zero Nansen or other external calls** and consumed **zero credits**. It preserved the earlier one-attempt/one-credit evidence and the manually reported 1,095-credit pre-spike balance without inferring a current balance. Claude's re-review accepted the two original blockers but found that the redirect regression asserted inside a callback whose error the runner intentionally catches. The pagination preparation moved that assertion outside the callback and added the bounded behavior above. The later approved execution is recorded separately and does not change the correction commit's offline evidence.
