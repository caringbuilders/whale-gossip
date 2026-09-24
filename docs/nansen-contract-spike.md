# Bounded Nansen contract spike

This document records a narrow authenticated probe of `POST /api/v1/tgm/dex-trades`. It is contract evidence for a future private acquisition adapter. It is not a round, complete-window evidence, a public integration, or authorization for bulk retrieval.

## Safety envelope

- The command defaults to dry-run. Live access requires `npm run nansen:spike -- --live`.
- The only allowed URL is `https://api.nansen.ai/api/v1/tgm/dex-trades`.
- The fixed request uses Ethereum WETH, `only_smart_money=false`, no label filters, a one-hour historical interval, ascending `block_timestamp`, page 1, and three records per page.
- All credential, ledger, lock, and raw-response paths are derived from the script module's canonical repository root rather than the current working directory. The key parser reads only `NANSEN_API_KEY` from that repository's `.env.local`; it does not load unrelated values into `process.env`, and a shell variable cannot override the file.
- The durable ignored JSONL ledger reserves before sending and permits at most five actual attempts and five retained credits. Missing or malformed credit-usage headers retain the one-credit reservation.
- Before the first live reservation, the runner exclusively creates `<ledger>.lock` with restrictive permissions and holds its descriptor for the complete run. A competing or crash-left lock fails closed before reservation or fetch. The lock is released only in the normal `finally` path after its descriptor closes.
- One bounded retry is available only for HTTP 408, 429, 500, 502, 503, or 504. Requests are separated by at least 500 ms, and an excessive or malformed `Retry-After` stops the run.
- Fetch uses `redirect: "error"`, so one reservation invokes fetch once and cannot follow a redirect with the API key or body. HTTP 401, 402, and 403 stop the run. Unexpected pricing, malformed successful envelopes, exhausted caps, unsafe paths, unsafe environment-file tracking, and non-allowlisted URLs also stop.
- `.env.local`, the raw response, and the ledger are ignored private artifacts. The ledger contains a request fingerprint and accounting metadata, not the API key, authorization header, raw request body, wallet values, or response body.

Normal `npm test`, lint, type checking, application development, and builds do not invoke the live command or send Nansen requests. Runner tests inject in-memory fetch implementations. The correction suite was also executed with `test/offline-network-guard.mjs` preloaded.

### Crash-left lock recovery

Locks do not expire and the runner never removes a pre-existing lock automatically. From the canonical repository root:

1. Confirm no spike process is running, for example with `ps -ef | rg '[n]ansen-contract-spike'`. Do not remove the lock when any matching process remains.
2. Run `npm run nansen:spike -- --status`. This reads the sanitized ledger accounting summary without loading the key or making a network request. Review attempts, settlements, successes, reported usage, unknown charges, and retained credits locally; do not print or copy the private JSONL file.
3. Only after confirming there is no runner and reconciling the sanitized accounting, remove `data/ledgers/nansen-contract-spike.jsonl.lock` manually. A malformed or uncertain ledger remains a stop condition even after lock removal.

Each clone or worktree has a separate local ledger and lock. Never bypass a lock or budget by running live acquisition from another clone, worktree, or copied repository.

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

- `is_last_page=false` proves that this one-page sample is incomplete. No claim of full lookback, answer-window, or No trade coverage is possible.
- The response has no explicit transaction-leg or event ID. A stable per-leg identifier across pages, retries, corrections, and repeated retrievals remains unresolved. A transaction hash alone cannot safely merge distinct legs.
- Three `BUY` rows do not prove that `action` is token-relative for every swap shape. No `SELL`, multi-leg, tied-time, duplicate, corrected, missing-value, empty-page, or terminal-page case was observed.
- Timestamp precision and within-timestamp ordering, request-boundary inclusivity, pagination stability, maximum historical coverage, and empty terminal behavior remain unverified.
- The sample shows numeric `estimated_value_usd`; it does not establish whether that field is always populated or is the correct threshold value for every swap form.
- Retry, rate-limit, authentication-error, plan-error, insufficient-credit, failed-request charging, and missing-credit-header behavior were covered only by offline control tests, not live responses.
- Redistribution terms and public fixture review remain separate release checks. Raw labels and wallet identities remain private.

The pure scoring rules remain unchanged and provisional at their provider boundary. This probe must not be used to weaken their conservative rejection behavior.

## Offline correction after review

Claude's review of `fa1249f` found redirect forwarding and concurrent reservation blockers and identified missing loop tests. The correction adds redirect rejection, an exclusive run lock, canonical paths, isolated key parsing, no-follow private-file operations, response-header-first accounting, and direct runner regressions. The full review and disposition are recorded in `docs/reviews/fa1249f.md`.

This correction made **zero Nansen or other external calls** and consumed **zero credits**. It preserves the earlier one-attempt/one-credit evidence and the manually reported 1,095-credit pre-spike balance without inferring a current balance. Further pagination is unauthorized pending independent re-review.
