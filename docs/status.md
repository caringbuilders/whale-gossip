# Project status

Current milestone: deterministic round scoring rules with explicitly synthetic offline tests, prepared for the local checkpoint `feat: add deterministic round rules and synthetic tests`. The accepted offline skeleton remains recorded at commit `825ddc515592b4bed9ca5f35728e11cdf969b8e7`; its review is in `docs/reviews/825ddc5.md`.

## Deterministic scoring rules: verified progress

- Added pure TypeScript compilation and guess-scoring logic in `lib/rules.ts`. It has no network, database, environment-variable, UI, React, or Next.js dependency.
- Added `docs/rules.md` to define the provisional normalized internal event contract and the guarantees a future acquisition adapter must provide before real provider events are accepted.
- Implemented Ethereum-only, exact wallet/token matching; `[t0 - 30 days, t0)` lookback; five most recent qualifying `$500+` trades; `$25,000+` admission; and `[t0, t0 + 48 hours)` first-material-trade selection at `$2,500+`.
- Compilation requires explicit lookback and answer-window coverage evidence. Missing pages, failed retrieval, insufficient covered ranges, and an answer window observed before its end return explicit unscorable reasons. Event arrays never establish completeness.
- Matching events with null, non-finite, or negative USD values in either required window fail closed. Insufficient tape, missing admission evidence, conflicting duplicate IDs, distinct material legs in the first transaction, and tied earliest material events are also explicit unscorable outcomes. None become No trade.
- Identical records deduplicate only by the same stable event/leg ID and identical normalized fields. Different IDs remain distinct even when transaction hashes match.
- Valid guesses are `buy`, `sell`, and `no-trade`. A correct guess scores one point, a wrong valid guess scores zero, and any other value is rejected rather than scored.
- Added 19 explicitly synthetic offline tests covering Buy, Sell, fully observed No trade, Ethereum-only compilation, cutoff/window and dollar boundaries, irrelevant identities, coverage failures, unfinished windows, invalid USD values, duplicates, distinct legs, tied events, unsorted input, pre-cutoff tape isolation, insufficient tape/admission, invalid guesses, and deterministic repeat compilation without input mutation.
- Actual checks: `npm test` passed 19/19 outside the sandbox; `npm run lint` passed with zero warnings; `npm run typecheck` passed. The first sandboxed test attempt failed before executing tests because `tsx` could not create its local IPC pipe (`EPERM`); no test failed. No production build was run for this milestone.
- Source inspection found no `fetch`, environment-variable, database, API-route, UI, or provider dependency in `lib/rules.ts` or its test file. No Nansen or other external data call was made.

## Scoring milestone limitations

- `NormalizedTradeEvent` is provisional. Actual Nansen field names, token-relative direction, timestamp precision, stable event/leg identity, transaction-leg representation, USD-value semantics, pagination, and coverage signals remain unvalidated.
- Conservative rejection treats every matching invalid USD value within a required window as potentially outcome-relevant. Provider validation may later justify a narrower rule, which would require a versioned decision and new tests.
- Exact normalized identifier comparison assumes a future adapter canonicalizes Ethereum, token, and wallet identifiers.
- Multiple material events sharing the first event's transaction hash are treated as an ambiguous multi-leg first transaction even if normalized timestamps differ. A validated adapter should preserve one transaction timestamp and stable leg identities.
- Tests are invented internal-contract fixtures. They are not verified historical rounds, provider response fixtures, live-path evidence, or evidence of API completeness.
- No public/private serializer, guess route, application game flow, acquisition adapter, real historical data, Nansen integration, persistence, spending guard, or deployment was added or verified.
- Independent Claude review of this milestone remains pending.

## Next proposed step

Have Claude review the named scoring commit, prioritizing boundary inequalities, coverage fail-closed behavior, invalid-value relevance, deduplication versus distinct legs, earliest-event ambiguity, deterministic output, and whether test evidence matches the implementation. Real historical acquisition and live integration remain pending and require a separately authorized bounded milestone.

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
