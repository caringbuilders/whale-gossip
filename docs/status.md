# Project status

Current milestone: the independently approved page-2/page-3 Nansen pagination probe has run exactly once and the three-attempt contract-spike milestone is permanently closed. Further acquisition requires a new reviewed and explicitly authorized workflow.

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

Design a separate bounded acquisition workflow for reviewed real-round candidates, including complete pagination evidence, stable leg identity, direction validation, resumability, and its own reviewed spending authorization. The closed contract-spike script must not be extended or rerun. The application remains offline and no five-round acquisition has started.

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
