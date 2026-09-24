# Environment knowledge and open validation questions

## Offline acquisition workflow knowledge — September 24, 2026

The repository currently has one verified acquisition token address: canonical Ethereum WETH9 from the closed contract spike. No external address verification was performed for this milestone, so expanding the token universe remains open.

The first acquisition design used token-wide coverage and could spend an entire pilot draining one dense discovery window. Claude rejected that design before any acquisition call occurred. Adapter/state/schema version 2 treats discovery as bounded sampling: three six-hour periods, page 1 spread across them, at most two pages per period, and at most six discovery calls. Candidate extraction happens on each valid page without waiting for terminal pagination. A capped sample is never completeness evidence.

The endpoint schema identified in the supplied review permits `filters.trader_address`. Corrected coverage pairs the fixed token with the normalized wallet obtained from validated discovery, and uses a unique candidate ID so wallets sharing a cutoff remain independent. This field and its selectivity have not been exercised live. Private pilot evidence must establish that the provider accepts it, filters correctly, paginates stably, and permits complete intervals within the budget.

Inclusive provider dates are handled by a one-millisecond request overlap at the local start and inclusion of the local exclusive end. The adapter then enforces `[start, end)` locally. This is a defensive transformation, not live proof of Nansen's boundary behavior. Exact millisecond ISO timestamps are required so loss of precision cannot silently move an event across `t0` or the 48-hour endpoint.

The endpoint has not supplied a provider-stable leg ID. `derived-v1` IDs hash the canonical complete row for deterministic local processing; that label remains the ID format under adapter version 2. A provider label can therefore affect the private fingerprint, but labels are not copied into normalized events or reports. Candidate coverage now rejects exact and cross-page duplicates instead of collapsing them, because repeated subthreshold rows could otherwise produce a false No trade. Conflicting rows and multiple matching rows under one transaction hash also reject conservatively while correction and leg semantics are unknown.

Coverage metadata must come from the successfully retrieved work-item interval. Rules version 4 rejects a one-millisecond shortfall at either required edge. Request/cache fingerprints include adapter, state, and schema versions, purpose, and every response-affecting request field, including the wallet filter; cache hits add no provider-call or success counters.

Atomic JSON replacement is not fully durable at rename alone. The corrected writer syncs the containing directory where supported, and a failed ledger-directory sync prevents fetch after reservation. This behavior is tested through injected scratch hooks without touching real private state.

The acquisition ledger is separate from the closed spike ledger. Status begins from the documented three spike successes without reading that historical file. The internal target is 120 combined successes: three existing plus up to 117 useful acquisition successes. The current Academy requirement says 100+ while the older campaign page says 1,000; both remain recorded until reconciled. The manually observed 1,092 dashboard balance is historical evidence only.

The exact future pilot command is `npm run nansen:acquire -- --live --max-new-calls 10 --target-total-success 120`. It has not been run and is not authorized by implementation or credential availability. The current CLI accepts only digits `1`–`10` for the per-run allowance. Separate clones/worktrees cannot coordinate the local lock or ledger and must not run live acquisition.

Crash-left locks, pending or unknown-charge attempts, a successful attempt without reusable cache, malformed state, and categorized cached-page validation failures stop automatic continuation. Preserve all evidence, inspect only approved metadata and sanitized status, reconcile accounting independently, and define a reviewed recovery action. Do not delete a lock, edit accounting, or replay an uncertain request merely to resume.

Provider direction, stable identity, USD allocation, multi-leg structure, inclusive boundaries, pagination termination/stability, candidate yield, and account eligibility remain unresolved. A terminal flag observed in future private evidence must be checked with page continuity and request identity; it is not sufficient by itself.

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

The proposal specifies Windows with WSL2/Ubuntu and VS Code, GitHub as canonical source, and Codespaces as fallback. The kernel supports the WSL2 observation; the Linux distribution, editor, and fallback availability were not checked. The foundation commit was pushed to origin in the preceding milestone; local `main` tracks `origin/main`. GitHub authentication was verified then without displaying credentials. The later bounded contract spike used the local Nansen credential without displaying it or reading it into documentation. Node support status and deployment runtime parity have not been independently validated.

## Bounded Nansen contract evidence — September 23, 2026

Official documentation checked for the spike specifies the lowercase `apikey` header, the `chain`/`token_address`/`date` request fields, `page`/`per_page` pagination, ascending `block_timestamp` ordering, and one-credit pricing for `tgm/dex-trades`. The live result reported both cost and use as one credit.

One fixed Ethereum WETH request returned three records in 920 ms with a valid `data`/`pagination` envelope. On that page, documented fields were present; timestamps were parseable and ascending, addresses and hashes matched Ethereum syntax, the requested token matched after normalization, and USD fields were numeric. The page contained three `BUY` actions and no `SELL` action. These counts describe one sample, not general provider semantics.

The response exposed `trader_address_label` strings even though the request used no label filters. “No labels” therefore means no label filtering and no propagation or display of returned label contents; it does not mean the response omits the field. Raw values remain private.

The page reported `is_last_page=false`. It cannot prove a full range, an empty material-action window, or No trade. The response supplied transaction hashes but no explicit event/leg ID, leaving the scoring module's stable per-leg identity requirement unresolved.

The user reported 1,095 credits before the task. This was manually observed account evidence. The spike did not query a balance endpoint or retain a remaining-balance header, and it does not infer why the reported balance was five below 1,100.

Claude's review of `fa1249f` demonstrated that provider-call accounting must bound transport behavior as well as loop iterations. Default fetch redirects can create multiple requests under one reservation and can forward a custom API-key header. A read/count/append ledger also needs cross-process exclusion. The correction uses redirect rejection plus an exclusive lock held for the entire live run. Canonical paths prevent a changed working directory from creating a second budget, but separate clones still require an operational prohibition until shared storage exists.

Credential isolation also requires selecting the source explicitly. `process.loadEnvFile` preserves an existing shell value and imports unrelated file entries, so the corrected runner parses only `NANSEN_API_KEY` from the canonical repository file. Header parsing precedes raw persistence so a storage failure cannot erase already observed charge evidence.

Claude's re-review accepted the original redirect and concurrency fixes but exposed a testing lesson: an assertion thrown inside an injected callback can be caught by the code under test and therefore appear to pass without checking the intended property. Capture the observed option in the callback and assert after the runner returns or rejects. For paid-call controls, confirm important guards with a negative mutation that removes the guard and causes the test to fail.

The prepared pagination mode treats the existing successful page-1 ledger entry as a fixed prerequisite and lowers the milestone ceiling to three total attempts. Page 2 can authorize page 3 only within the same locked run after a valid nonterminal response; neither page implies complete coverage. Standard tests now load the outbound-network guard themselves, avoiding reliance on a manually supplied `NODE_OPTIONS` prefix.

The approved pagination command ran once on September 24. Pages 2 and 3 both returned valid three-row envelopes with `is_last_page=false`, two BUY and one SELL row, parseable timestamps ascending within each page, syntactically valid and within-page-distinct Ethereum hashes and trader addresses, matching fixed-token addresses, and numeric nonnegative USD values. The field types matched page 1's observed contract. This expands observed shapes to SELL rows but does not prove that action is token-relative across all swap structures.

Because page 3 also reported `is_last_page=false`, the three-page sample remains incomplete. The summaries do not establish cross-page ordering, stable pagination under concurrent data changes, date-boundary inclusivity, terminal-page behavior, stable leg identity, multi-leg semantics, or complete scoring coverage. The reviewed summary did not expose timestamp minima/maxima, and raw evidence was not inspected for documentation. The closed three-attempt milestone cannot answer these questions; a future acquisition workflow must do so under separate review and authorization.

Private-path hardening remains a fail-closed local control rather than protection from a malicious or mistaken process running as the same user. In particular, Node's path-based final `lstat` then `unlink` leaves a narrow same-user replacement race during lock cleanup. Operators must not alter the private paths while the script runs; hosted acquisition still requires a durable shared coordination mechanism.

## Nansen questions remaining after the bounded live contract check

- Which verified Ethereum token contracts and historical periods provide sufficient qualifying trades and candidate variety?
- Does the observed `BUY`/`SELL` field remain token-relative for every swap shape, including multi-leg transactions? Both actions appeared in the bounded three-page sample, but their general semantics remain unverified.
- How do date boundaries, sorting, page sizes, pagination termination, and history availability work in actual responses? Can full lookback and answer-window coverage be demonstrated?
- Which stable fields distinguish duplicate records from distinct swap legs? How should tied timestamps and multi-leg transactions be detected for rejection?
- How are missing or invalid USD estimates represented, and can their possible effect on the first material action be determined?
- All three successes reported one credit cost and one credit used. Are the same headers present and trustworthy on validation failures, transient failures, retries, and credit/plan errors?
- What rate-limit and `Retry-After` behavior is observed? How are timeouts or uncertain charges reconciled with account usage?
- Does a fresh, complete round fit the proposed four-credit deal cap and ten-second deployed target? Neither is an observed result.
- Which attempts count toward competition eligibility? The newer Academy article says 100+ calls while the campaign landing page still says 1,000. Reconcile the current rule, these three observed successful calls, and submitting-account usage; planned requests and cache hits do not count as observed usage.

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

The [official Next.js installation documentation](https://nextjs.org/docs/app/getting-started/installation) and npm package metadata were consulted during setup. No provider data endpoints were queried during the skeleton milestone; the later bounded contract spike is recorded separately above.

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

The bounded page resolved field-presence questions only. Until the remaining semantic, identity, boundary, and completeness questions are answered with bounded evidence, the normalized event type and all synthetic fixtures remain provisional. They are not verified historical data.

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

## Grok review lesson — September 23, 2026

Grok 4.7 at High effort independently noticed that numeric negative zero bypasses an ordinary `< 0` validation. JavaScript preserves the sign bit for `-0` while most comparisons treat it as zero, so signed zero requires `Object.is(value, -0)` when the normalized contract rejects every negative representation.

This was a useful distinct finding from a third model after Codex implementation and Claude review. One useful result does not establish a standing requirement for three-model review; reviewer choice should remain proportional to milestone risk and unresolved questions. The static Grok review did not validate provider behavior or execute the repository checks.

## Synthetic game boundary knowledge — September 24, 2026

The offline game demonstrates a practical server/client split without claiming security it does not have. Private synthetic inputs and compiled outcomes remain in `lib/server/synthetic-rounds.ts`. Server-rendered question props come only from the allowlist serializer, while the same-origin guess route looks up the private round by ID and returns a separately allowlisted reveal. Client modules are statically tested against importing the private fixture module.

Serialization tests need both structural and value checks. Forbidden-key traversal catches accidental additions such as `transactionHash` or `answer`; unique sentinel and exact-source-value checks catch leaks under innocent-looking renamed keys. Determinism tests protect stable public payloads. These checks reduce accidental disclosure but do not replace inspection of generated HTML/RSC payloads and client bundles, and the offline route is not authentication or anti-cheat protection.

Ordinary numeric zero remains valid but nonmaterial and invisible in the question because answer-window events are never serialized. Numeric negative zero still fails through rules version 4. Broad size bands and relative time descriptions are derived only after compilation and do not modify scoring evidence.

The user verified a Nansen dashboard balance of **1,092 credits after the three-call spike**. This is manual dashboard evidence, distinct from the ignored local ledger's three reported credits and not a balance inferred by code. The synthetic-game milestone makes zero Nansen calls and consumes zero credits. Real acquisition still requires resolution of the existing direction, leg identity, USD, pagination, boundary, completeness, and redistribution questions.

## Synthetic-game hardening knowledge — September 24, 2026

Value and key scans do not fully prove answer independence: a future developer could add a harmless-looking field derived from the correct action. Recompiling the same pre-cutoff evidence with a different answer and asserting byte-identical question JSON catches that class of leak without relying on a forbidden field name.

React state does not synchronously close a rapid double-click window. A mutable ref gate can reserve the request before the first await or rerender. Pair the request ID with a game generation so replay or round advancement invalidates late responses, and validate returned JSON plus the submitted round/guess before applying score.

Next.js supports a bare `server-only` marker and rejects its import from the client graph. Direct Node tests do not run under Next's resolver, so the test command registers a narrow test-only mapping for exactly that marker. This adds no package and leaves the production framework enforcement intact.

Public policy text must match actual collection rather than saying no personal information is ever processed. The current app intentionally has no accounts, wallet connection, email capture, advertising identifiers, analytics, or gameplay persistence, while hosting infrastructure may still process IP/device/request logs. Revisit Terms and Privacy before the data model, hosting, analytics, persistence, or live mode changes.
