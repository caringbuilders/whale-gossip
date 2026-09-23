# Environment knowledge and open validation questions

## Observed locally on September 22, 2026

| Item | Evidence |
| --- | --- |
| Project directory | `/home/aitooluse/work/hackathons/whale-gossip` |
| Shell / session timezone | Environment context reports Bash / America/New_York |
| OS / architecture | `uname -srm`: Linux `6.18.33.2-microsoft-standard-WSL2 x86_64` |
| Node | `node --version`: `v24.21.0` |
| npm | `npm --version`: `11.19.0` |
| Git executable | `git --version`: `2.53.0` |
| Git checkout | Initially absent; an empty `.git` directory and no parent repository were found. Initialized locally with `git init -b main`; foundation checkpoint preparation verified |
| Git identity / remotes | User-supplied name and email configured locally; origin is `https://github.com/caringbuilders/whale-gossip.git` |
| Initial project files | Proposal and its `:Zone.Identifier` sidecar; requested documentation did not exist |

The proposal specifies Windows with WSL2/Ubuntu and VS Code, GitHub as canonical source, and Codespaces as fallback. The kernel supports the WSL2 observation; the Linux distribution, editor, and fallback availability were not checked. The foundation commit was pushed to origin in the preceding milestone; local `main` tracks `origin/main`. GitHub authentication was verified then without displaying credentials. No Nansen credentials were read or tested. Node support status and deployment runtime parity have not been independently validated.

## Nansen questions requiring a bounded live contract check

- Which verified Ethereum token contracts and historical periods provide sufficient qualifying trades and candidate variety?
- Do actual token DEX response fields match the proposed token-relative BUY/SELL interpretation, trader-address filter, timestamps, and USD estimates?
- How do date boundaries, sorting, page sizes, pagination termination, and history availability work in actual responses? Can full lookback and answer-window coverage be demonstrated?
- Which stable fields distinguish duplicate records from distinct swap legs? How should tied timestamps and multi-leg transactions be detected for rejection?
- How are missing or invalid USD estimates represented, and can their possible effect on the first material action be determined?
- What credit balance is actually available? What does each allowed request/page/retry cost, and is `X-Nansen-Credits-Used` present on successful and failed responses?
- What rate-limit and `Retry-After` behavior is observed? How are timeouts or uncertain charges reconciled with account usage?
- Does a fresh, complete round fit the proposed four-credit deal cap and ten-second deployed target? Neither is an observed result.
- Which attempts count toward competition eligibility? Reconcile successful calls and the competition window with the submitting account; planned requests and cache hits do not count as observed usage.

## Public-use and external questions

The proposal reports that ordinary token DEX data is allowed with attribution, while Smart Money DEX data and address labels are prohibited from redistribution. That report has not been independently revalidated here. Before release, verify current terms and that the reviewed transformed fixture export complies. Hiding addresses, using pseudonyms, or delaying data is not itself permission.

`profiler/dex-trades` and `tgm/token-ohlcv` public display and fixture-distribution treatment remain unresolved in the proposal; keep those optional paths disabled. The proposal contains an unsent clarification draft, not a sent request or provider approval.

Recheck official competition rules, call eligibility, deadlines, submission links, grants, pricing, and account usage before relying on them. The proposal's source links are references, not evidence that this session visited or validated them.

## Future infrastructure verification

The local author identity is configured for project checkpoints. The GitHub remote is connected, and local `main` tracks `origin/main`. Later verify Vercel/Supabase project linkage, secret storage, private table grants/RLS/function privileges, shared budget reservations under concurrency, idempotency, and fail-closed storage behavior. No hosted resources or controls have been verified by this documentation setup.

Private acquisition artifacts belong under ignored `data/` paths (for example `data/private/`, `data/raw/`, `data/cache/`, and `data/ledgers/`) or `private/`. Only `data/sample-deck.json` and `data/fixtures/` are allowed through the data ignore rule, and require explicit review before staging. Ignore rules do not inspect content or protect files force-added to Git.

## Offline application environment

Node 24.21.0 and npm 11.19.0 were rechecked for the skeleton. No environment file or credential is needed. `.env.example` contains comments only. `npm run dev` serves loopback at http://localhost:3000; `npm run build` and `npm start` provide a local production check. Package installation requires network access; application source has no external data retrieval code.

No `agent-browser` executable, connected browser tool, Chromium/Firefox executable at standard checked paths, or default Playwright browser cache was found. Visual verification remains pending.

Installed versions: Next.js 16.3.6, React/React DOM 19.3.0, TypeScript 6.0.3, ESLint 9.39.5. ESLint 9 is deprecated but currently matches bundled lint-plugin peer requirements; TypeScript 7 is unsupported by the installed lint tooling. The production build required execution outside the sandbox for Next.js to capture its TypeScript subprocess output. Standalone type checking passed inside the sandbox. npm reported an unapproved `unrs-resolver` postinstall script; no approval was needed for the checks that passed.

The [official Next.js installation documentation](https://nextjs.org/docs/app/getting-started/installation) and npm package metadata were consulted during setup. No provider data endpoints were queried.

## AI Playbook lesson — transfer later

**Marked for later transfer to the shared AI Playbook.** Review a named commit or immutable diff so the implementation under review is unambiguous. In the review record, separate checks the reviewer independently performed from checks reported in the implementation handoff but not repeated. Phrase evidence at its actual level: HTML/static inspection can establish that source contains no external references or application fetch calls, but it cannot establish runtime network behavior without a browser network capture.

Avoid running `next build` against the same `.next` directory while `next dev` is running. Both processes write framework artifacts there, so concurrent use can produce misleading failures or corrupt the verification state. Stop the development server before a production build, or use separate working directories/build directories when concurrent execution is unavoidable.

## Deterministic rules knowledge

The offline rules contract is documented in `docs/rules.md` and implemented in `lib/rules.ts`. It consumes explicit coverage evidence for the lookback and answer window because an event list, including an empty list, cannot prove complete pagination. `tsx` 4.23.15 is the only test-runner addition; the tests otherwise use the Node test and strict-assert APIs.

The first sandboxed `npm test` invocation did not execute tests because `tsx` was denied permission to create `/tmp/tsx-1000/14.pipe`. Running the same offline command outside the sandbox passed 19 tests. This is an execution-environment limitation, not a scoring-rule failure. npm reported unapproved install scripts for `unrs-resolver` and `esbuild`; neither was approved, and tests, lint, and type checking passed without enabling them.

Provider questions still requiring validation before real acquisition:

- Does token DEX direction reliably describe Buy/Sell relative to the requested featured token for every relevant swap shape?
- Which provider fields form a stable unique transaction-leg ID across pagination, retries, and retrieval times? Can distinct legs share every available identifier except array position?
- What timestamp precision and tie behavior does the endpoint provide, and do all legs of one transaction carry the same timestamp?
- Which USD field is appropriate for the thresholds, and how are null, missing, non-finite, estimated, or partially priced values represented?
- How can an adapter prove that every relevant page in both half-open windows was retrieved, including endpoint caps, empty terminal pages, timeouts, and retries?
- Are request date boundaries inclusive, and can the adapter request sufficient overlap to reapply `[start, end)` inequalities locally without gaps?
- Can the provider return corrected or conflicting records under one stable identifier, and which provenance fields must be retained for audit?

Until those questions are answered with bounded live evidence, the normalized event type and all synthetic fixtures remain provisional. They are not verified historical data.

## Scoring review correction knowledge — September 23, 2026

The review of `db2f0b11eb3527cbb518acd8312138e8645be229` exposed a useful runtime-boundary lesson: a TypeScript discriminated union does not validate JSON-shaped input. Version 1 accepted an unknown coverage status if range fields looked sufficient and could throw on malformed values. Runtime parsing must validate the discriminant and every consumed field before rules logic runs, with typed fail-closed results.

Ethereum addresses are now syntax-checked and lowercased for comparison. This prevents case-only missed matches, but it does not establish EIP-55 checksum validity, contract existence, whether an address is a wallet or token, or the exact format returned by Nansen. The future adapter must validate those semantics and preserve original values in private provenance.

Multi-leg transaction handling remains intentionally conservative. Combining nonnegative leg values is only a signal that a transaction could cross the material threshold and therefore needs rejection when it could affect the answer. It does not validate aggregation, Buy/Sell netting, USD allocation across legs, or provider transaction structure. These questions remain open for the bounded provider contract check.

The proposal's initial 10–40-day cutoff range belongs to candidate selection in the future acquisition workflow. The pure compiler consumes a fixed cutoff and checks its lookback and answer intervals. Retrieval after ten days can establish that the 48-hour interval is in the past, but cannot establish complete pagination, successful pages, or trustworthy provider coverage.

Compiled scoring results must remain private because they contain wallet identity, transaction hashes, event IDs, answers, and evidence. A future public question serializer needs an explicit allowlist plus leakage tests for rendered HTML, RSC payloads, API responses, and client state.

The correction suite uses syntactically valid invented Ethereum addresses and exercises order-independent results. The fixtures still provide no evidence about actual provider identifiers, casing, multi-leg behavior, or completeness signals. Claude's re-review was pending at that checkpoint; its outcome is recorded below and in `docs/reviews/0d3994d.md`.

## Scoring re-review hardening knowledge — September 23, 2026

Ethereum transaction hashes are now checked only for deterministic syntax and normalized casing. This does not prove a transaction exists, that Nansen always supplies a transaction hash, or that its rows use one hash consistently across swap legs and pagination. Those remain provider-contract questions.

The single-chain compiler rejects every event whose chain is not exactly `ethereum`, even when its wallet or token does not match the round. The future adapter must normalize aliases before compilation and pass only Ethereum events. The stricter boundary prevents an unexpected chain value from being silently discarded and turning a possible data-shape problem into No trade.

Coverage end times must not exceed the recorded observation time. This is internal consistency validation, not proof that all pages were fetched or that the retrieval clock and upstream data were complete.

Public relative times and size bands reduce direct lookup clues, but a distinctive sequence can still be correlated with public chain history. No serializer or anonymity test exists yet. Duplicate-ID conflicts across unrelated token or wallet identities remain deferred until the provider's identifier namespace is known.
