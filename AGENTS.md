# Whale Gossip project instructions

## Authority and scope

Read `PROPOSAL-v3.md` and `docs/status.md` before working. The proposal defines product scope; this file defines repository guardrails. Follow the user's current bounded task, not the proposal's implementation brief as an automatic authorization to build. Record scope changes in `docs/decisions.md` before coding them.

Keep Whale Gossip separate from the 0600 news/wiki project, with its own repository and infrastructure. Do not modify 0600. Work one small milestone at a time; preserve existing work.

The MVP is an Ethereum historical wallet game: one featured token, Buy/Sell/No trade, five rounds, one point per correct answer, a local streak, and a shareable score/challenge. The eventual first playable milestone requires ten reviewed real rounds and a complete live fetch → guess → reveal flow. Runtime AI, portfolio PnL clues, market-cap buckets, crowd statistics, daily scheduling, and a second chain are outside launch scope. Seven-day price follow-up stays disabled pending public-use clarification and calculation verification. Do not add AI infrastructure.

## Scoring and data integrity

- Use a fixed UTC cutoff `t0`, initially 10–40 days before retrieval. Look back 30 days; show the last five validated token trades of at least $500 strictly before `t0`.
- Score the first validated trade of at least $2,500 in `[t0, t0 + 48 hours)`, with direction relative to the featured token. Fetch both actions.
- No trade means no trade of $2.5k+ in this token in the fully observed window. Exhaust pagination; failures, missing coverage, relevant invalid USD values, and ambiguous earliest events make a candidate unscorable, never No trade.
- Deduplicate identical records without collapsing distinct swap legs merely because they share a transaction hash. Reject ambiguous multi-leg/tied earliest events rather than skipping to a convenient answer.
- Initial whale admission: an observed trade of at least $25,000 in the token during the lookback. Select using pre-cutoff evidence, never later profit or desired answers. Version any threshold change.
- Keep clues strictly pre-cutoff. Explanations are deterministic observations, not claims about intent, profit, or predictive skill. Disclose curated selection; never fabricate actions for balance.
- Freeze provenance and source snapshots; record rules/deck versions, cutoff, window end, retrieval time, and completeness. A refresh creates a new version rather than silently changing a challenge.

## Offline defaults and public/private boundaries

Normal development, tests, keyless play, and compilation must make zero Nansen requests. Synthetic fixtures must be explicitly labelled and cannot count as real/live evidence. Live acquisition requires an explicit live mode and a bounded budget; credential availability alone does not authorize calls.

Planned architecture: Next.js App Router + TypeScript on Vercel, server-only Nansen REST access, Supabase private persistence, and a read-only bundled fixture adapter. Use a supported Node LTS of at least 22, matched across development and deployment; pin installed versions and retain the lockfile when implementation begins.

Launch data uses ordinary `tgm/dex-trades`, `only_smart_money=false`, no Smart Money filters, and no displayed trader labels. Keep the endpoint allowlist narrow; premium labels, address search, agent/trading endpoints, and unsupported optional datasets are excluded. Verify contracts and actual response semantics before compiling real rounds. Display “Powered by Nansen API”. Publish only reviewed fixture exports with attribution and versioned provenance.

Keep provider credentials, privileged database keys, wallet identities, and raw responses out of the public repository, browser, client props, logs, and error messages. Mark secret-bearing modules server-only. Never put secrets in `NEXT_PUBLIC_` variables. When environment files are introduced, commit only a placeholder `.env.example` and ignore real `.env`/`.env.local` files; do not blanket-ignore the example. Do not print secrets while checking configuration.

Return public question fields only before a guess; grade and reveal on the server. Use round-specific pseudonyms, not wallet addresses or raw labels. Public fixture answers are inspectable in source: casual scoring is not cheat-proof. Use private tables, RLS, and reviewed grants/function privileges with no browser-role access.

## Bounded spending and failure behavior

- Local contract spike: maximum 30 credits by default with a durable single-process ledger. Bulk acquisition uses explicit bounded batches. Never silently increase limits.
- The proposal's 1,500-credit project ceiling is a planning maximum, not authorization to purchase credits, subscribe, or spend it. Verify actual balance and pricing before live work.
- Public live mode starts disabled. Initial limits after verification: 3 deals/minute per hashed IP, 4 credits/deal, and 100 credits/UTC day within the remaining project ceiling.
- Reserve cost atomically before outbound requests, counting in-flight reservations across scripts and deployments. Import the initial local ledger once by stable attempt ID into the shared ledger.
- Reserve a deal allocation once; calls and retries consume it without double reservation. Record every actual attempt uniquely, settle reported `X-Nansen-Credits-Used`, release known unused capacity, and retain unknown charges conservatively. Missing cost headers never mean zero.
- Repeated deal identifiers reuse the existing result/status. Accept only server-owned candidates, never arbitrary browser-supplied provider requests.
- Stop paid work on failed reservations, unavailable durable logging/storage, exhausted caps, unexpected pricing, authentication errors, or credit errors. In-memory counters cannot replace durable controls.
- Start near two requests/second; honor `Retry-After`, bound retries, and retain potentially charged reservations until reconciled. Keep database transactions short and network requests outside them.
- During storage failure, bundled rounds and grading for their IDs may continue. Private live rounds without loadable answers return retry/unavailable; all new deployed paid acquisition stops.

## Verification and review

Report only checks actually run and their results. Distinguish planned, implemented, offline-tested, authenticated, and deployed evidence. Cached fallback is labelled cached; retrieval time is separate from historical activity time. Never claim a live flow from fixtures or a loading animation.

Verify meaningful scoring boundaries, coverage failures, look-ahead leakage, public answer/secret boundaries, reproducibility, concurrency caps, retry/idempotency, storage failure, and zero-request offline behavior as relevant work is implemented. Before public release, inspect built client payloads, scan for secrets, verify a fresh deployed guess/reveal flow, and reconcile real usage with the provider. Planned calls, cache hits, and browser clicks are not qualifying upstream calls; synthetic data does not satisfy real-round acceptance.

Codex implements bounded milestones. Claude reviews a named commit or diff and does not independently edit the active checkout. Handoffs include changed behavior, actual checks/results, remaining risks, and a commit identifier if one exists. Do not invent a commit or verified deployment. Resolve accepted blocking findings before advancing; keep `docs/status.md` current.
