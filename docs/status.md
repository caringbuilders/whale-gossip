# Project status

Current milestone: the final blocker from Claude's focused re-review of the offline Nansen acquisition workflow is corrected and offline-tested for another review. The corrected workflow has not been executed live. The accepted five-round synthetic game remains the public experience, and real/live acquisition stays disabled pending approval and a separate 10-call authorization.

## Offline acquisition workflow — September 24, 2026

- Added `lib/server/nansen-acquisition.ts`, `lib/server/nansen-acquisition-runner.ts`, and `scripts/nansen-acquisition.ts`. Application/client modules cannot import them, and importing the CLI has no side effects.
- The exact allowlist contains only `POST https://api.nansen.ai/api/v1/tgm/dex-trades`, Ethereum, `only_smart_money=false`, redirect rejection, an abort timeout, and server-owned request parameters. Arbitrary endpoints, tokens, wallets, dates, bodies, and target totals are not CLI inputs.
- The reviewed token universe contains only canonical WETH9, whose address was already used by the closed spike. Expansion to three–five verified non-stable ERC-20s remains pending; no address was guessed or externally checked in this task.
- Adapter/state/schema version 3 retains the corrected discovery design. Discovery is three deterministic, non-overlapping six-hour WETH samples, spread across all windows and capped at two pages each. Candidate rows are processed after every valid page; capped windows are labelled sampled, never complete. A no-candidate nonterminal run stops after six calls instead of draining one window.
- Candidate coverage is independent and sends the provisional `filters.trader_address` field populated only from validated discovery. Its identity includes the candidate and wallet. Two candidates sharing a cutoff remain separate work/results. No tracked project source independently confirms this request field, and provider acceptance and enforcement remain unverified until a live pilot.
- Adapter/state/schema version 3 validates every coverage page before it can count as success or enter cache. Every structurally valid row must match the canonical candidate wallet and configured token. A mismatch, including on a nonterminal page, settles as `invalid-response` with `wallet-filter-not-applied`, retains reported credit accounting, writes only sanitized coverage-page evidence, and stops immediately. Structurally invalid rows fail similarly as `invalid-coverage-row`. Empty pages remain provisional pagination evidence and cannot by themselves prove filter enforcement or complete coverage.
- Coverage requires exact sequential terminal pagination and is derived from the actual requested local range. Exact and cross-page duplicate candidate rows, conflicts, wallet mismatches, ambiguous repeated transaction hashes, invalid relied-upon fields, and a one-millisecond boundary shortfall reject rather than score. Adapter-local event IDs remain private canonical-row fingerprints labelled `derived-v1`; BUY/SELL semantics remain provisional.
- Only complete normalized evidence reaches rules version 4. Raw responses, cache pages, wallets, exact evidence, compiled private answers, and provenance remain in ignored `0600`/`0700` paths. A versioned private manifest holds exact evidence. Report version 3 is built field-by-field and contains allowlisted discovery and coverage page counts, reason categories, pagination, coarse time/latency bands, and safe credit cost.
- The acquisition ledger/lock stays separate from the permanently closed spike ledger. It caps attempts and retained/reported credits at 130, reserves durably before fetch, directory-syncs atomic JSON replacements where supported, stops on unexpected/missing pricing, retains unknown charges, throttles to about two requests per second, and permits at most one bounded retry. Reservation-sync failure prevents fetch. Crash-left locks and uncertain attempts require evidence-preserving review rather than automatic deletion or replay.
- Combined reporting begins with the documented three spike successes without opening the old ledger. The useful acquisition target is at most 117 additional successes for an internal total of 120. The updated Academy wording says 100+ calls while the older campaign page says 1,000; the discrepancy remains unresolved. The dashboard balance of 1,092 is preserved only as the user's manual post-spike observation.
- Dry-run and keyless status remain network-free and non-mutating. Live `--max-new-calls` accepts only digits `1`–`10`; ambiguous forms and larger values fail before fetch. The exact future pilot remains separately reviewable and authorizable. Detailed operations and failure rules are in `docs/nansen-acquisition-runbook.md`.
- **Codex verification for the correction:** all eight test files passed under the automatic outbound-network guard. The focused ignored-filter schedule made exactly three synthetic discovery attempts and one rejected nonterminal coverage attempt, requested no later page or candidate, counted three acquisition successes, retained all four reported credits, and compiled no result. Unit regressions cover wrong-token rejection, canonical case comparison, invalid rows, provisional empty pages, and the report allowlist. Temporarily bypassing the per-page wallet/token comparison made the focused regression fail; the implementation was restored before the final suite. `npm run lint`, `npm run typecheck`, and `git diff --check` passed. The credential-pattern, tracked-private-data/ignore, and application dependency-boundary scans passed; `package.json` and `package-lock.json` are unchanged. The default `npm run nansen:acquire` dry-run reported `networkRequestSent: false`. A keyless `--status` check against an isolated temporary root reported zero attempts and `networkRequestSent: false`; no real ledger was opened.
- This correction made **zero Nansen or other external application calls** and consumed **zero credits**. It did not read `.env.local`, the closed spike ledger, real acquisition state, caches, locks, manifests, or raw responses. No packages were installed, no production build ran, and nothing was deployed.

Claude's earlier review is recorded in `docs/reviews/803ba5c.md`; its focused re-review of `fa3818b` and this correction's disposition are recorded in `docs/reviews/fa3818b.md`. Independent review of the new correction commit is the next checkpoint. Only after acceptance may a separate authorization permit exactly the documented 10-call pilot. No real round should be published until private acquisition evidence, provider semantics, and the public serialization boundary are reviewed.

## Synthetic-game hardening and public policies — September 24, 2026

- The footer now states exactly: “Built for the Nansen API · This offline demo uses synthetic data, not Nansen data.” README and future-live documentation retain appropriate attribution without describing the invented deck as provider data.
- The fixed five-round answer map is exercised for all 15 round/guess combinations. Tests pin the returned action, correctness, and points so always-Buy, always-correct, and always-one-point mutations contradict explicit assertions. Every success and typed error response asserts `Cache-Control: no-store`.
- Each of the ten private rounds is recompiled with a different answer and different post-cutoff event. The corresponding question JSON must remain byte-identical. Forbidden-key, private-value, sentinel, initial HTML/RSC, and client-script scans remain separate defenses; the earlier suite did not contain this alternate-answer proof.
- Tests pin all public relative-time labels and size bands used by the deck, the exact `t0` and `$2,500` output, exclusion at 48 hours, the three-action selected mix, deterministic distinct selection, and rejection of all five unplayed fixture IDs.
- The client uses a synchronous `useRef` request gate in addition to visible pending state. Runtime parsing validates every success field and its scoring coherence. Malformed success leaves score unchanged and permits retry; generation tokens prevent late responses from changing a later round or replay.
- `lib/server/synthetic-rounds.ts` imports Next.js's framework-supported `server-only` marker. The Node-only test resolver maps that marker to Next's test context without adding a package; client-import checks and loopback bundle scans remain in place.
- The reveal uses one polite atomic announcement region and moves focus to the explicit Next/score action. It no longer focuses the live region or adds a redundant score label.
- `/terms` and `/privacy` are implemented for the current offline release, share the existing responsive visual identity, and are linked from an accessible footer navigation. No consent banner was added because this milestone introduces no optional cookie or application analytics.
- Terms and Privacy are deployment prerequisites. They require reconsideration before accounts, analytics, Supabase persistence, production Nansen live mode, new hosting practices, or other collection. No claim is made that these pages remove legal obligations or replace qualified legal advice.
- Claude's supplied findings and the limits of the available review evidence are recorded in `docs/reviews/5364a79.md`. The attachment did not include a model/effort label or Claude command log, so neither is inferred.
- Claude approved the hardened synthetic-game checkpoint for push with no blocking findings. Its one non-blocking test gap is closed by a focused regression that rejects a forged reveal whose Sell guess conflicts with a recorded Buy even when `correct: true` and `points: 1` are internally consistent. The working runtime parser was unchanged. See `docs/reviews/abc7004.md`.
- **Codex follow-up verification:** `npm test` passed 98/98 with the automatic network guard; `npm run lint`, `npm run typecheck`, and `git diff --check` passed. A temporary mutation removing only the guess/action cross-check made the new focused regression fail and was restored before the final suite.
- **Codex verification:** `npm test` passed 97/97 with the automatic network guard; `npm run lint`, `npm run typecheck`, and `git diff --check` passed. Three temporary negative mutations—always correct, always one point, and always Buy—each made the fixed 15-case scoring test fail and were restored before the final run.
- Loopback checks returned HTTP 200 for `/`, `/terms`, and `/privacy`; exercised all 15 round/guess outcomes; and confirmed no-store on every success plus all three typed error codes. Initial HTML/RSC and 17 referenced client scripts contained none of the checked private identifiers/sentinels or answer keys. These are HTTP/static checks rather than browser interaction or a browser network capture.
- Browser automation remains unavailable: no `agent-browser`, supported browser executable, or cached Playwright browser was found. Visual, keyboard, clipboard, focus, narrow-mobile, console, and browser-network checks remain pending. No production build was run against the active development server's `.next` directory.
- This hardening made **zero Nansen or other external calls** and consumed **zero credits**. It preserves the user-verified post-spike dashboard balance of **1,092 credits** as manual dashboard evidence.
- A post-submission admin/analytics portal is deferred; it would require authentication, Supabase persistence, and a Privacy Notice update before implementation.

## Synthetic offline game — September 24, 2026

- Ten fictional private round inputs compile through `lib/rules.ts`; they cover Buy, Sell, No trade, exact `t0`, the exact material threshold, varied tape values, and deliberately unsorted input. A fixed five-round selection is deterministic and includes all three answer types.
- Private source inputs, valid-but-fictional addresses and hashes, exact timestamps and USD values, event IDs, answers, and evidence live in `lib/server/synthetic-rounds.ts`. The client imports only public types and receives serialized questions.
- The pure allowlist serializer emits a round ID, fictional token display name, fictional wallet pseudonym, relative times, broad size bands, five ordered tape entries, rules version, and the exact source label “Synthetic offline fixture.” It omits addresses, source IDs, exact times and values, future events, the answer, coverage, and raw/provider data.
- `POST /api/guess` accepts exactly a server-owned round ID and `buy`, `sell`, or `no-trade`. It returns an allowlisted reveal only after the guess and makes no external call. Malformed JSON, unknown rounds, invalid guesses, and extra source-shaped fields return typed safe errors.
- The responsive interface supports five locked-after-guess rounds, explicit reveal and Next steps, score, replay, result copying, keyboard controls, visible focus, announced status, narrow layouts, and reduced-motion preferences. It labels the deck as synthetic, uses the clarified Nansen attribution, and states that it is not investment advice.
- The boundary is an offline demonstration design, not authentication or anti-cheat protection. Repository/server access exposes the fictional deck, and a caller can submit repeated guesses.
- The original automated leakage tests checked forbidden keys and private sentinel/source values in both payload types, deterministic output and selection, ordinary zero behavior, signed-zero rejection, route validation, and the client-module import boundary. They did not yet prove byte identity after changing the private answer; the hardening section above records that added coverage.
- **Codex verification:** the final `npm test` passed 87/87 with the automatic outbound-network guard; `npm run lint`, `npm run typecheck`, and `git diff --check` passed. A React review found no added dependency, render waterfall, client-side private import, or avoidable heavy bundle; question props are minimal allowlisted values.
- The existing loopback development server returned HTTP 200. HTTP-level checks found no private sentinel, source address/hash/ID, exact private timestamp/value, or answer key in the initial HTML/RSC response or 14 referenced client scripts. Five server-owned round IDs each returned one valid reveal, and an invalid guess returned the typed 400 response. These were local HTTP checks, not browser interaction or a browser network capture.
- Browser automation remains unavailable: no `agent-browser`, supported browser executable, or cached Playwright browser was found. Visual layout, console, full UI click/keyboard flow, score/replay/copy behavior, narrow Android viewport, focus movement, and browser-captured network behavior therefore remain pending. No production build was run because a development server is active on the shared `.next` directory.
- This milestone made **zero Nansen or other external calls** and consumed **zero credits**. No packages were installed. The user-verified Nansen dashboard balance after the closed three-call spike is **1,092 credits**; it is dashboard evidence, not inferred from the spike ledger.

Real acquired rounds, provider normalization and completeness, persistence, authentication, hosted spending controls, production live mode, and deployment remain unimplemented and unverified. The three-attempt contract spike remains permanently closed; further acquisition requires a new reviewed and explicitly authorized workflow.

## Pagination-probe execution — September 24, 2026

- HEAD was the approved commit `6e4096aab7dc932f1ba5903910ccdcd1609fc4e6` on clean `main`. The origin comparison was 0 behind / 3 ahead before execution.
- Metadata-only checks confirmed `.env.local` was ignored, untracked, a current-user-owned regular file; its mode was `0644`, so the explicitly permitted repair tightened it to `0600` without reading it. `data/ledgers` was a real current-user-owned `0700` directory and no lock was present.
- The exact command `npm run nansen:spike -- --live --pagination-probe` was invoked once only. It made two requests with no retries and exited successfully after page 3. It was not rerun.
- Page 2 returned HTTP 200 in 1,103 ms with three rows, page/per-page 2/3, `is_last_page=false`, two BUY and one SELL observation, and reported cost/use of 1/1 credit.
- Page 3 returned HTTP 200 in 494 ms with three rows, page/per-page 3/3, `is_last_page=false`, two BUY and one SELL observation, and reported cost/use of 1/1 credit.
- Both page summaries had valid envelopes, all reviewed fields present, expected string/number types, parseable within-page ascending timestamps, syntactically valid Ethereum addresses and hashes, matching fixed token addresses, numeric nonnegative USD values, and no reported issues or request/schema contradiction. The reviewed summary did not expose sanitized timestamp minima/maxima, so none are recorded.
- The keyless status command was invoked once and sent no network request. It reported three cumulative attempts, three settlements, three successes, three reported credits used, zero unknown-charge attempts, and three retained credits. The two new attempts added two successes and two reported credits; the historical page-1 attempt remains separately recorded as one success and one reported credit.
- Neither new page reached `is_last_page=true`; page 3 still reported `false`. This is incomplete contract evidence and cannot establish complete query, lookback, answer-window, or No trade coverage. No current account balance is inferred.
- The approved milestone is exhausted and permanently closed. Raw responses and ledger evidence remain private and ignored. Further calls require a separately reviewed and authorized acquisition workflow.
- Claude's approval of the named preparation commit is recorded in `docs/reviews/6e4096a.md`; the supplied authorization did not include a verbatim review body or reviewer metadata, so those details are not inferred.
- **Codex verification after documentation:** `npm test` passed 80/80 with the automatic network guard, `npm run lint` passed with zero warnings, `npm run typecheck` passed, and `git diff --check` passed. Credential-pattern and tracked-private-data scans passed; metadata confirmed the protected paths remain ignored/untracked, the lock is absent, `.env.local` remains `0600`, and `data/ledgers` remains `0700`. No production build was run.

## Offline pagination-probe preparation history — September 23, 2026

- Claude's re-review of `a0a5363` accepted the two original blockers: redirect rejection and exclusive cross-process locking. The task materials also identified one definite test defect: the redirect assertion ran inside the injected fetch callback, where the runner's expected catch could swallow it. The available materials did not include the verbatim re-review body, model/effort, or a list of Claude-executed commands, so none are inferred in `docs/reviews/a0a5363.md`.
- The redirect regression now captures the received option inside injected fetch and asserts `redirect === "error"` only after the runner finishes. A guarded mutation check that removed the production option made this test fail; the option was then restored.
- A separate `--live --pagination-probe` mode is required. Dry-run remains the default, `--pagination-probe` alone is rejected, and this new mode was not executed.
- The persisted attempt and retained-credit ceilings are both three. The original page-1 mode refuses a nonempty ledger. Pagination mode requires the exact historical safe state of one settled successful page-1 attempt with one reported cost/use credit and no unknown charge. It then requests page 2 once, stops if terminal or on any failure, and requests page 3 only after a valid nonterminal page 2. It stops after page 3 regardless of pagination status and never marks coverage complete.
- Pagination mode has no retries. The existing endpoint allowlist, redirect rejection, lock, pre-send reservations, conservative settlement, sanitized reports, and private raw storage remain in force.
- The standard `npm test` command now preloads the outbound-network guard automatically. Its sanity test proves controlled dummy fetch and raw-socket calls are blocked. Runner tests continue to use injected in-memory fetch functions.
- Additional offline regressions cover ignored/untracked credential enforcement in dummy repositories; credential parent, type, symlink/no-follow, and permission rejection; private file/directory modes; EEXIST directory races; same-inode lock release; combined run/release failures; bounded Retry-After; 429 handling; cost-header-only pricing mismatch; exact pagination flags and start state; the three-attempt cap; page-2/page-3 branching; disabled pagination retries; and import-time inactivity.
- Credential diagnostics now distinguish a missing file or key, unsafe type, unsafe permissions or ownership, parse failure, and invalid key value without including key contents. Lock release uses an aggregate error when both the run and cleanup fail, preserving both sanitized causes.
- **Codex verification:** `npm test` passed 80/80 with the automatically loaded guard; `npm run lint`, `npm run typecheck`, and `git diff --check` passed. The redirect-removal mutation produced the expected focused-test failure. Dependency manifests changed only in the `npm test` script; package versions and `package-lock.json` are unchanged. Private production files were checked only through Git ignore/tracking metadata and were not opened, listed, hashed, copied, or modified.
- This preparation made **zero Nansen or other external calls** and consumed **zero credits**. It preserves the historical one-call/one-credit evidence and manual pre-spike balance without inferring a current balance.

## Contract-spike review correction — September 23, 2026

- Claude found two blockers in `fa1249f`: default redirect following could forward the API key/body and produce uncounted requests, and concurrent runners could race past the five-attempt cap. The review is recorded in `docs/reviews/fa1249f.md`.
- Fetch now sets `redirect: "error"`. A rejected redirect settles one reserved attempt as `request-error` and stops; one reservation contains exactly one fetch invocation.
- An exclusive no-follow lock derived from the canonical ledger path is acquired before the first live reservation and held for the complete run. Concurrent and crash-left locks fail closed before reserve/fetch. Normal release closes the descriptor first and removes only the same inode.
- Repository-root paths come from the runner module location, so changing the working directory cannot start a separate ledger. Separate clones and worktrees still have separate ledgers and must not be used for parallel live acquisition.
- Runtime key loading reads only `NANSEN_API_KEY` from the canonical `.env.local` through the narrow parser. It does not call `process.loadEnvFile`, populate unrelated environment variables, or allow an existing shell value to override the file.
- Ledger/lock/raw access uses no-follow file opens, validates regular files and parent-directory chains, and preserves restrictive permissions. Unsafe paths fail closed.
- Response status and credit headers are parsed before raw persistence. A raw-write failure retains known accounting and stops conservatively. Signed-zero observed USD values invalidate the response contract summary.
- The request loop is import-safe and testable through injected fetch, paths, key, clock, sleep, raw writer, and observer. Offline regressions directly cover 401/402/403 stops, two 503 attempts, unexpected pricing, redirects, malformed pagination, unknown arguments, non-mutating dry-run, retained-credit and attempt caps, ledger ordering, double settlement, malformed headers, 3xx responses, key redaction/isolation, lock contention/crash residue, and raw-write accounting.
- This correction made **zero Nansen or other external calls** and consumed **zero credits**. The earlier historical evidence remains one successful call with one reported credit used and a manually reported pre-spike balance of 1,095. No current balance is inferred.
- **Codex verification:** the final guarded `npm test` run passed 64/64 and the guard's fetch-blocking sanity check passed. `npm run lint`, `npm run typecheck`, and `git diff --check` passed. Dependency manifests and the lockfile are unchanged. No production build was run.

## Bounded Nansen contract spike — September 23, 2026

- Starting state was clean `main` at `ed760eb27c48d06ff6085be80f6e2cb27829d469`, synchronized with `origin/main`.
- `.env.local` was confirmed present, ignored by `.env.*`, and untracked without reading or displaying its contents. The live script repeats the ignore and untracked checks before loading the key.
- The implementation hard-allows only `POST https://api.nansen.ai/api/v1/tgm/dex-trades`. Its fixed request uses Ethereum WETH, `only_smart_money=false`, no label filters, a one-hour historical interval, ascending `block_timestamp`, and page 1 with three records.
- Dry-run is the default and reports `networkRequestSent=false`. Explicit `--live` is required. After pagination preparation, the ignored durable ledger reserves before send and caps this milestone at three actual attempts and three retained credits: the historical page-1 attempt plus at most two pagination requests. It accounts conservatively for missing usage headers and stores no request body, API key, authorization header, raw wallet value, or raw response.
- The original 44-test suite covered request construction, endpoint allowlisting, default dry-run output, attempt-cap enforcement, conservative unknown-charge settlement, ledger sanitization, synthetic response parsing, and status classification. It did not directly exercise the live request loop; that overstatement is corrected by the post-review tests above.
- The reviewed dry run sent zero requests. The explicit live run made **one** actual attempt: HTTP 200, 920 ms, one reported credit cost, one reported credit used, and no retry. The provider returned three rows and `is_last_page=false`.
- The sanitized page had the documented field names, parseable timestamp strings in ascending order, valid-looking Ethereum addresses and transaction hashes, `BUY` actions, matching token addresses, and numeric USD fields. Exact values and identifiers are not tracked in documentation.
- The response included string `trader_address_label` values despite using no label filters. They remain private and must be discarded by future public or fixture serialization.
- Raw response and accounting evidence are stored only in ignored `data/private/` and `data/ledgers/` paths. They are not Git candidates.
- The user reported a pre-task balance of **1,095 credits**. This is manual evidence, not API-derived. No post-task balance was queried, and no explanation is inferred for the five-credit difference from 1,100.
- Current official sources disagree on eligibility call count: the Academy article updated September 23 says **100+ calls**, while the campaign landing page still says 1,000. The proposal retains the earlier 1,000-call basis as historical planning context. Do not manufacture calls; reconcile the current rule and account usage before submission.

Detailed evidence and remaining contract questions are in `docs/nansen-contract-spike.md`.

## Accepted deterministic scoring rules version 4

The scoring rules remain accepted after Codex implementation, Claude review, Grok independent static review, Codex correction, and Claude targeted approval of `48d1218664ea61288c546fd26fff3e565c7d115f`. The final approval is recorded in `docs/reviews/48d1218.md`.

- Grok 4.7 at High effort reported no blocking findings and one definite non-blocking issue: numeric `-0` bypassed the ordinary negative-value comparison.
- Rules version 4 rejects `Object.is(usdValue, -0)` through the existing typed `invalid-usd-value` result.
- Two focused synthetic tests cover signed zero in an otherwise valid lookback/answer candidate and as the only answer-window event in an otherwise valid No trade candidate.
- This was a static review. Grok did not independently run tests, lint, type checking, Git status, provider behavior, or live integration.
- Grok supplied a distinct third-model finding after the Codex implementation and Claude review cycle. This is useful evidence for this milestone, not a decision that every future change requires three-model review.
- **Codex verification:** before commit `48d1218`, `npm test` passed 35/35, `npm run lint` passed with zero warnings, `npm run typecheck` passed, and `git diff --check` passed. The credential-pattern and dependency-boundary scans passed, and dependency manifests were unchanged. Codex did not run a production build.
- **Claude targeted approval:** Claude Sonnet 5 at Medium effort independently ran the 35 tests, type checking, a commit-range diff check, and focused signed-zero/ordinary-zero probes. Claude reported no blocking findings and approved the correction for push. Claude did not independently run lint or a production build.

## Prior scoring re-review hardening: verified progress

- Claude's re-review accepted both earlier blocking fixes: strict coverage discriminants and ambiguity detection across individually subthreshold transaction legs.
- Rules behavior is now version 3. Every event must use exactly `ethereum`; transaction hashes require `0x` plus 64 hexadecimal characters and normalize to lowercase before deduplication or transaction grouping.
- Coverage with missing or nonnumeric `observedAtMs` is unscorable. A claimed segment end later than `observedAtMs` is contradictory and unscorable.
- Direct synthetic regressions cover exact `$2,500` combined legs, negative and nonnumeric USD values, empty identifiers, malformed event addresses and hashes, hash case normalization, non-Ethereum event chains, multiple conflicting IDs, and simultaneous ambiguous transactions across input permutations.
- Future public questions must omit exact timestamps and USD values in addition to private identities, source IDs, answers, and evidence. They will use relative times and size bands, without claiming anonymity. No serializer was implemented.
- The low-priority question of conflicting event IDs across unrelated wallets or tokens remains deferred pending provider identifier validation.
- Final pre-commit checks passed: `npm test` (33/33), `npm run lint` with zero warnings, `npm run typecheck`, and `git diff --check`. The credential-pattern scan found no matches in the changed files; the dependency-boundary scan found no import, runtime, network, environment, framework, or database dependency in `lib/rules.ts`; `package.json` and `package-lock.json` are unchanged. No production build was run.

The version 1 correction history remains in `docs/reviews/db2f0b1.md`. Version 2's accepted re-review and the additional non-blocking recommendations are recorded in `docs/reviews/0d3994d.md`.

## Remaining scoring limitations

- `NormalizedTradeEvent` remains provisional. One bounded page confirmed relevant field names and basic JSON types, but token-relative direction across swap shapes, timestamp precision, stable event/leg identity, transaction-leg representation, USD-value semantics, pagination termination, and coverage signals remain unvalidated.
- Conservative invalid-value and combined-leg ambiguity handling may reject events a future validated schema can classify safely. Any relaxation requires a versioned decision and boundary tests.
- Tests are invented internal-contract fixtures. They are not verified historical rounds, provider response fixtures, live-path evidence, or evidence of API completeness.
- No public serializer, answer-leakage test, round acquisition/compiler adapter, reviewed real round, application API route, persistence, hosted spending guard, or deployment was added or verified.
- Version 4 is accepted as an offline deterministic scoring milestone. The one-page spike is provider contract evidence only; production build behavior for this change, complete-window acquisition, application integration, persistence, UI integration, and public serialization remain unverified.

## Next proposed step

Independently review the named acquisition correction commit, especially the per-page wallet/token enforcement, invalid-response accounting, sanitized coverage evidence, and the ignored-filter mutation proof. A live pilot still requires that approval plus a separate explicit authorization for the documented 10-call command. The closed contract-spike script must not be extended or rerun.

## Accepted offline skeleton history

### Offline skeleton: verified progress

- Added Next.js App Router and TypeScript files individually, preserving `AGENTS.md`, `CLAUDE.md`, and the proposal unchanged.
- The responsive landing page is titled “Whale Gossip” and explains five rounds, one Ethereum token per round, and Buy/Sell/No trade in a historical 48-hour window. It explicitly states that this is an offline development skeleton with no playable rounds, trade data, results, or working Nansen integration.
- Node `24.21.0` and npm `11.19.0` were rechecked. `.nvmrc` records the exact Node version; `package.json` requires Node 24. Direct dependencies are pinned; `package-lock.json` is retained. `.env.example` contains comments only and no credentials are needed.
- Installed Next.js `16.3.6`, React/React DOM `19.3.0`, TypeScript `6.0.3`, ESLint `9.39.5`, and the matching Next.js lint configuration.
- `npm run lint` passed with zero warnings. `npm run typecheck` passed. `npm run build` passed with the home and not-found pages statically prerendered. The initial sandboxed build could not parse the TypeScript subprocess output; the same production build succeeded outside the sandbox.
- `npm start` served the production page on loopback. An HTTP check returned 200 and verified the title, offline notice, planned game explanation, and absence of external script/style/image URLs in HTML.
- Source review found no application fetch calls, external URLs, environment access, client components, authentication, API routes, or database connections. npm scripts disable Next.js telemetry; fonts and styling are local/system resources. No Nansen requests or other live data retrieval were performed.
- Reviewed the two Server Components using the React skill checklist: no hooks or client state, semantic headings/landmarks, a keyboard-focusable in-page link, and responsive CSS. No claim of browser accessibility or visual testing is made.
- `git diff --check` passed and the proposal/instruction files were confirmed unchanged.
- Claude independently reviewed the named scaffold commit and accepted it with no blocking findings. Claude's HTML/static inspection found no external references or application fetch calls; runtime network behavior was not verified through a browser network capture. Build, lint, type-check, and loopback HTTP results remain Codex-reported checks that Claude did not repeat.

### Remaining skeleton limitations

- Visual, browser-console, keyboard, and mobile viewport verification remain pending: no browser automation tool or browser binary was available. The HTTP check is not a browser test.
- npm marks ESLint 9.39.5 as deprecated. It is retained because the installed Next.js lint plugins declare peer support through ESLint 9; ESLint 10 produced peer conflicts. TypeScript 7 was also rejected by the lint tooling; TypeScript 6 passes the checks. Revisit tooling compatibility when upstream plugins support newer releases.
- npm reported an unapproved `unrs-resolver` postinstall script. It was not enabled; lint, type checking, and build passed without approving it.
- No game rules module, fixtures, guess/reveal flow, live integration, hosted persistence, spend guard, or deployment is implemented. No gameplay tests or live verification were performed.
- No clean-clone installation timing or browser network trace was performed.

### View locally and next proposed step

From `/home/aitooluse/work/hackathons/whale-gossip`, run `npm run dev` and open **http://localhost:3000**. Use `npm ci` first on a fresh checkout. The development server binds to loopback. For the built version, use `npm start` instead.

The next milestone is a pure deterministic scoring-rules module with explicitly synthetic offline boundary fixtures and meaningful tests. The fixtures must be clearly labelled synthetic and cannot count as real rounds or live evidence. Real historical data, Nansen integration, hosted persistence, spend controls, and deployment remain pending. Browser visual and runtime-network verification of the accepted skeleton also remain open.

## Foundation milestone history (September 22, 2026)

The following records the earlier documentation-only checkpoint; it is historical, not the current implementation status.

### Verified foundation setup

- The current project folder is `/home/aitooluse/work/hackathons/whale-gossip`.
- `PROPOSAL-v3.md` exists and was read in full. It describes an implementation proposal, not a completed build or authenticated API validation.
- Initial inspection found the proposal, `PROPOSAL-v3.md:Zone.Identifier`, and `.agents`, `.codex`, and `.git` directories. None of the five requested documentation files existed; no application files or package manifest appeared in the file listing.
- Documentation setup created `AGENTS.md`, `CLAUDE.md`, `docs/status.md`, `docs/decisions.md`, and `docs/knowledge.md`. The checkpoint task adds `.gitignore` for generated output, real environment files, logs, private acquisition data, and Windows download metadata. A placeholder-only `.env.example` is allowed; none exists yet.
- Read-only command results: Linux `6.18.33.2-microsoft-standard-WSL2` on `x86_64`; Node `v24.21.0`; npm `11.19.0`; Git `2.53.0`.
- Initial Git discovery failed. Inspection found an empty `.git` directory and no parent repository metadata; no existing history was found. `git init -b main` initialized a standalone local repository in the confirmed project folder. The branch is `main`, with no configured remotes; initialization preserved the existing project files.
- The user supplied the author identity, now configured only for this repository: Anil Wijesooriya, `212802896+caringbuilders@users.noreply.github.com`. No global settings were changed.
- The proposal and five documentation files were reviewed for scope consistency. Product and architecture decisions remain unchanged; stale Git setup statements were updated.

### Not performed during the foundation task

No application was built, packages installed, Nansen calls made, database changes made, or deployments performed during this task. No application tests or authenticated/live checks were run.

Credentials and account access were not inspected. GitHub linkage, VS Code setup, hosted projects, deployment runtime parity, database permissions, provider balance/pricing, endpoint semantics, redistribution treatment, real fixtures, scoring, spend controls, and live latency remain unverified. The proposal's statements about public documentation, competition rules, and deadlines have not been independently rechecked in this setup task.

There are no verified rounds or verified live-flow results from this session. Provider account usage is unknown; do not infer a zero account total from this task's lack of calls.

### Proposed next step at the foundation checkpoint

The foundation checkpoint uses message `docs: establish Whale Gossip project foundation` and contains only the proposal, five project documentation files, and `.gitignore`. No remote creation or push is part of this milestone. Preparation checks verified the exact staged file list, reviewed file contents for credentials/private data, and exercised 12 ignore-rule cases. The proposal retains intentional Markdown line-break spaces.

Next, agree a small offline application scaffold task with clearly labelled fixtures and no live API calls. The proposal's eventual first playable milestone is ten manually reviewed real rounds, including complete-window No trade, and a full live fetch → guess → reveal flow. A live contract spike must be explicitly enabled and capped at 30 credits; otherwise proceed only with clearly labelled offline fixtures. Hosted paid refresh cannot be enabled before durable spending controls pass verification.
