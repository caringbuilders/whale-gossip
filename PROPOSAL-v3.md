# Proposal: Whale Gossip — Nansen Meridian Buildathon (v3)

**Prepared for:** Anil Wijesooriya  
**Date:** September 22, 2026  
**Version:** v3 — incorporates PROPOSAL-v2, the first peer review, and the established AI development workflow  
**Decision:** Build Whale Gossip first, then return to the 0600 news/wiki project  
**First milestone:** Ten verified rounds and one complete live fetch → guess → reveal flow on September 22  
**Submission target:** Saturday September 26, 2026, by 23:59 America/New_York  
**Status:** Implementation proposal. This revision does not represent a completed build or authenticated API validation.

**Dated correction — September 25, 2026:** The original proposal below preserves its planning assumption based on the [campaign landing page](https://nansen.ai/campaigns/meridian-buildathon), which still says “Make 1,000 API calls.” The newer, detailed [Nansen Academy FAQ](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27), shown as updated one day before this correction, says “Log 100+ API calls between Sep 14th–27th.” These official sources conflict. Whale Gossip has logged 101 successful calls and proceeds under the newer, detailed FAQ; only Nansen can definitively reconcile the discrepancy. The FAQ also requires a public GitHub repository, an X post tagging `@nansen_ai` with the GitHub link, a 30–60 second recording showing the build running with live Nansen data visible, official Typeform submission, and submission by September 27 at 23:59 UTC.

## 1. Recommendation and scope

Proceed with Whale Gossip as a small, time-limited build before the 0600 migration. It is a useful first exercise of the Windows → GitHub → Vercel/Supabase workflow: API integration, a private data store, a responsive interface, bounded spending, a reviewed deployment, and documentation.

Keep it in its own repository, Vercel project, and Supabase project. Reuse the development workflow and lessons for 0600 afterward. Its existing application and migration should not become dependencies of the buildathon entry.

The first release asks a precise question:

> This wallet made these trades in this token. What was its first material trade in the same token during the next 48 hours?

Players choose **Buy**, **Sell**, or **No trade**. The reveal shows the recorded action and a short explanation grounded in the visible tape. A five-round session produces a shareable score.

The seven-day price follow-up is a stretch feature. Portfolio PnL clues, market-cap buckets, crowd statistics, daily scheduling, a second chain, and runtime AI are outside the first release.

### Review of v2

V2 improves the budget arithmetic, introduces a server boundary, recognizes distribution constraints, and gives the game a clearer identity. These changes remain. The remaining issues are resolved as follows.

| V2 issue | V3 decision |
|---|---|
| First playable game and deployed live path arrive late in the week | Complete a narrow end-to-end flow on Day 1 |
| “Before 0600” could be read as a clock deadline | Treat 0600 as the existing news/wiki project; prioritize Whale Gossip before resuming that work |
| Current Smart Money discovery is still central, while public-use questions remain | Default to ordinary token DEX data, without Smart Money filters or displayed labels |
| Plan C changes sourcing but still depends on the unlisted wallet DEX endpoint | Use the documented token DEX endpoint for both sourcing and the scored history |
| Buy/Sell/Hold plus overlapping size/age buckets complicates scoring | One featured token; one action; one point per correct answer |
| Date-limited PnL is assumed to reconstruct historical open positions | Remove portfolio clues from launch; derive simple clues from the pre-cutoff tape |
| “Whale won” equates subsequent token price movement with wallet profit | Optional follow-up reports subsequent price movement with explicit measurement dates |
| A daily sum of completed calls leaves a concurrency gap | Reserve credits atomically before each paid request |
| Database failure falls back to in-memory controls | Cached play continues; paid refresh stops when durable controls cannot be reached |
| Eligibility partly depends on future public play | Finish the required observed usage during controlled data preparation |
| Codex and Claude are named without a working handoff | Codex implements bounded tasks; Claude reviews a commit or diff; Codex resolves findings |

## 2. Buildathon requirements

The published rules require at least 1,000 API calls during September 14–27, a public GitHub repository, an X post tagging @nansen_ai with the repository link and a 30–60 second recording showing live Nansen data, and submission through the official form. The hard deadline is September 27 at 23:59 UTC: 19:59 in America/New_York. One submission is allowed per account. The four judging categories carry equal weight. [1][2]

First prize is $10,000 USDC; winners are scheduled to be announced October 1. [1]

| Criterion | Evidence this build should supply |
|---|---|
| Data Integration | Nansen supplies candidate activity, the visible tape, and the answer; the README traces the fields |
| Functionality | A full game works from fixtures and through the deployed live path; errors have clear states |
| Creativity & Originality | A chronological wallet challenge with an evidence-based reveal |
| Documentation & Submission | A timed keyless quick-start, a clear recording, and a complete entry |

The internal submission deadline is **Saturday September 26 at 23:59 America/New_York**, equivalent to **Sunday September 27 at 03:59 UTC**. Sunday is a repair buffer.

A local call ledger is supporting evidence. Reconcile it with the usage shown by Nansen for the submitting account. Do not treat planned requests, cache hits, or browser clicks as counted API calls.

## 3. Use the agreed AI stack

The prior stack discussion established Windows as the main development machine, WSL2/Ubuntu and VS Code as the preferred local workflow, GitHub as the source of truth, and Codespaces as the fallback. ChatGPT/Codex builds; Claude Pro reviews. Apply that workflow to this smaller project.

| Component | Role in Whale Gossip | Scope for this sprint |
|---|---|---|
| Windows desktop | Main development workstation | Use the working environment already available |
| WSL2/Ubuntu + VS Code | Preferred local repository and terminal | If setup is not ready within 20 minutes, use the existing Codespaces fallback |
| ChatGPT / Codex | Implementation, debugging, focused verification, README updates | One clearly bounded milestone at a time |
| Claude Pro | Independent review of rules, data assumptions, security boundaries, and UX | Review a named commit/diff and screenshots; avoid simultaneous edits to the same checkout |
| GitHub | Canonical source and review history | Commit each working milestone and retain the lockfile |
| Vercel | Next.js application and server routes | One project; preview verification before production changes |
| Supabase | Private rounds, shared cache, usage ledger, and durable live-request controls | Hosted project for this sprint |
| Gemini / NotebookLM / Grok | Optional research or a second opinion using already available tools | Use only for a concrete unresolved question |
| Local models, routing gateways, scraping, voice, image-generation services | Possible tools for other work | No dependency in this game |

**Runtime AI is unnecessary for the MVP.** Scoring and explanations are deterministic. This avoids model latency and makes every answer reproducible.

Use a supported Node LTS version of at least 22, matched between development and deployment, and record the exact version. Supabase's current changelog records the end of Node 20 support in its client libraries. Do not spend this sprint installing Docker or local Supabase if they are not already working. [11]

### Working agreement for Codex and Claude

- PROPOSAL-v3.md defines product scope; AGENTS.md defines repository rules.
- CLAUDE.md explicitly tells Claude to read AGENTS.md and the current milestone. Do not assume the two tools automatically share context.
- Codex's handoff includes the commit, changed behavior, checks actually run, and remaining risks.
- Claude returns prioritized, reproducible findings. Codex fixes accepted issues before the next milestone.
- Use the same round examples and acceptance criteria in both tools.
- Keep the full 0600 migration, new orchestration frameworks, and reusable package extraction until after submission.

## 4. Public data path

Nansen's redistribution guide lists tgm/dex-trades, tgm/token-screener, and tgm/who-bought-sold as allowed with attribution. It prohibits redistribution of smart-money/dex-trades and address labels. It does not explicitly list profiler/dex-trades or tgm/token-ohlcv. [3]

**Implementation decision:** use ordinary tgm/dex-trades with only_smart_money=false, no Smart Money label filters, and no displayed trader labels. This gives the core game a data path covered by the guide's explicit allowance. Validate that path during the spike.

An eight-day delay, a salted identifier, or hidden addresses does not independently establish permission for an unlisted or prohibited dataset. Treat pseudonyms as a presentation choice; trade patterns may still be identifiable. [3]

Display “Powered by Nansen API” beside the game. Store raw responses and wallet identities privately. Publish only reviewed question/reveal fixtures and aggregate build reports. [3]

The advanced whole-wallet version and OHLCV follow-up can wait for clarification of their public-display and fixture-distribution treatment. The core implementation need not wait for those optional features.

### Sourcing without an unsupported “Smart Money” claim

Start on Ethereum with a small set of non-stable tokens whose contracts are verified during the spike. Use token-centric DEX history from a period before each proposed cutoff to find candidate wallets.

For this game, “whale” is branding for a large-trade participant, not a Nansen classification. Initial admission rule: at least one observed trade of $25,000 or more in the featured token during the 30-day lookback. Show a banded fact such as “Largest observed trade: $25k–$100k.”

This threshold is an implementation assumption. Tune it once after the spike if necessary, version the change, and apply it consistently. Do not choose wallets by their later profit or by whether their eventual answer makes a better story.

## 5. Product and scoring contract

### Player experience

1. Show a wallet pseudonym, the featured token, Ethereum, and the last five qualifying trades in that token.
2. Show relative times, Buy/Sell direction, size bands, and one factual clue derived from those five trades.
3. Ask what happened first in the next 48 hours: Buy, Sell, or No trade.
4. Reveal the recorded answer, elapsed time, size band, and one evidence-based sentence.
5. After five rounds, show a score out of five and a copyable challenge link and result.

Example clue: “Four of the last five trades were buys.”  
Example reveal: “The next qualifying trade was a sell, 11 hours later.”

These describe observations. They do not assert the wallet's intent or establish predictive skill.

### Definitions

| Item | Rule |
|---|---|
| Identity | Chain + token contract + wallet address internally; use a round-specific pseudonym publicly |
| Cutoff | A fixed UTC instant t0, initially 10–40 days before retrieval |
| Lookback | The 30 days before t0 |
| Visible tape | Last five validated trades of at least $500 with timestamps strictly before t0 |
| Answer window | From t0 inclusive to t0 + 48 hours exclusive |
| Material trade | A validated trade in the featured token with estimated USD value of at least $2,500 |
| Buy / Sell | Direction relative to the featured token |
| No trade | No material trade in that token in a completely observed answer window |
| Score | One point for a correct action; zero otherwise; five points maximum per session |
| Streak | Consecutive correct actions, stored locally |
| Metadata | rules_version, deck_version, cutoff, window end, retrieval time, provenance, and completeness status |

“No trade” does not mean that the wallet held every asset or was inactive elsewhere. Put “No trade of $2.5k+ in this token within 48h” beside the choice or in its explanation.

The token DEX API provides token-specific BUY/SELL actions, a trader-address filter, timestamps, and estimated trade values. Confirm the meaning against actual response examples before compiling rounds. [4]

### Ordering, completeness, and ambiguous data

- Fetch both actions. Do not apply a BUY-only or SELL-only filter while looking for the answer.
- Apply the cutoff inequalities locally even if request date boundaries are inclusive.
- Exhaust the relevant pagination. If a page cap, timeout, or schema error prevents complete coverage, mark the candidate unscorable.
- Deduplicate identical records returned across pages. Do not collapse distinct swap legs solely because they share a transaction hash.
- For the initial compiler, reject candidates where a multi-leg transaction or tied earliest timestamp makes the first action ambiguous. Do not skip an ambiguous earlier material event to reveal a later convenient one.
- Null or invalid USD estimates in an event that could change the answer make that window unscorable. They are not evidence for No trade.
- The No trade branch requires a completed historical window and complete query results. API failure never generates that answer.
- Use the same rules for prepared and freshly fetched rounds.

### Fairness and content selection

Keep all pre-guess clues strictly before t0. Do not display current PnL, current portfolio ROI, current wallet labels, or future price data. A date filter on PnL has not yet been validated as a reconstruction of open positions at the cutoff; removing the clue resolves this dependency.

Use bot/rapid-activity filters only as documented heuristics based on the lookback. They do not prove that the remaining wallets are people.

Build a roughly balanced challenge set when data permits, but never fabricate an action to fill a quota. Record action distribution and exclusion reasons. Disclose that a curated deck is not a representative sample of wallet behavior.

Compare the deck with two simple baselines: always choosing the most frequent action, and repeating the last visible action. Reserve separate wallets or non-overlapping periods for checking changes to the rules. Ten initial rounds are a playability check, not evidence that the game teaches profitable trading.

### Positioning

Label Me's published design already includes cached cards, fresh draws, shared challenges, explanations, and a comparison baseline. Whale Gossip's distinction is the chronological question and reveal. [9]

Describe the game as entertainment built on observed history. Retain the gossip tone, but avoid “Whale won” or “Whale got rekt” as a conclusion about realized profit.

## 6. Optional price follow-up

After the core release passes its checks, a reveal may add:

> The token price rose 8% over the following seven days.

This is **subsequent market movement**, not the wallet's realized PnL. A seller can realize a profit before a further rise; a buyer may later sell, hedge, or transfer the position. Player points remain tied only to the next-action answer.

If implemented, use a written measurement convention:

- P0 is the close of the first completed hourly candle whose closing time is at or after the revealed trade.
- P7 is the close exactly 168 hours after that P0 closing time.
- Display 100 × (P7 / P0 − 1), with both timestamps and a note that this is a candle-based comparison.
- Missing, invalid, omitted, or truncated price data gives “Price follow-up unavailable.”
- Do not replace a missing price with zero or discard losing rounds because outcome data is inconvenient.
- No trade rounds receive no trade-outcome verdict.

Nansen documents batches of up to ten tokens for ordinary OHLCV queries, but tokens without data may be omitted and responses may be truncated. Batchability does not establish one complete price result per requested token. [6]

This feature stays off until its public use is clarified and its calculation is verified. Buckets, PnL clues, and crowd statistics remain later work even if the price follow-up ships.

## 7. Architecture

Use **Next.js App Router + TypeScript on Vercel**, with server-side Nansen REST calls and Supabase persistence. Pin installed versions and the lockfile.

| Boundary | Responsibility |
|---|---|
| Browser | Display public question fields, submit a guess, display the returned reveal, keep local streaks |
| Next.js server | Select rounds, strip private fields, grade guesses, normalize Nansen responses, enforce live controls |
| Supabase | Private rounds and provenance, cache, actual call attempts, budgets, request limits, live-deal idempotency |
| Nansen | External source of observed activity; contacted only by server code or an explicit local acquisition script |
| Bundled fixtures | Keyless quick-start and zero-spend fallback |

Mark secret-bearing modules as server-only. Never expose NANSEN_API_KEY or a Supabase privileged key through NEXT_PUBLIC_ variables, client props, logs, source control, or error messages. Next.js documents a server-only import boundary to catch accidental client imports. [10]

### Minimal routes and modules

| Path | Purpose |
|---|---|
| app/page.tsx | Five-round game |
| app/api/round/route.ts | Public question payload only |
| app/api/guess/route.ts | Validate a guess and return its reveal |
| app/api/deal/route.ts | Guarded fresh API retrieval and round generation |
| lib/server/nansen.ts | REST adapter, schema checks, call reservation, logging, cache |
| lib/server/store.ts | Supabase access and read-only fixture adapter |
| lib/server/guard.ts | Durable budget and request controls |
| lib/rules.ts | Pure normalization, cutoff logic, scoring, exclusion reasons |
| lib/config.ts | Thresholds, source allowlist, versions, and caps |
| scripts/spike.ts | Small live contract check with a fixed budget |
| scripts/fetch.ts | Resumable candidate acquisition |
| scripts/build.ts | Offline compiler |
| scripts/publish.ts | Reviewed rounds to private storage; reviewed fixture export |
| scripts/calls.ts | Call, credit, cache-hit, and pending-reservation totals |
| data/sample-deck.json | Small reviewed fixture set with attribution and provenance summary |
| supabase/migrations/ | Versioned database changes |
| AGENTS.md / CLAUDE.md | Shared project rules and task handoff |

A token address needed by implementation is different from a wallet identity. Public runtime payloads should contain only fields needed for play. Keep internal wallet addresses and raw provider labels out of the public serializer.

Cache by endpoint plus normalized request parameters and schema version. Retain retrieval timestamps and immutable source snapshots for compiled rounds. A later provider refresh creates a new source/deck version instead of silently changing an existing challenge's answer.

The sample deck is openly inspectable in the public repository. Withholding answers from the browser prevents accidental spoilers during normal play; it does not make public fixtures cheat-proof. Scores are casual and carry no prize or leaderboard claim.

### Supabase and failure behavior

Use private application tables with RLS enabled on exposed schemas and no browser-role access. Permit only the intended server role. Review table grants and function execution privileges as well as RLS; privileged server keys require careful handling. [12]

Suggested tables: rounds, api_cache, api_calls, credit_budgets, request_limits, and live_deals. Do not add accounts, social data, or per-player analytics for launch.

If Supabase is unavailable:

- Existing bundled rounds remain playable.
- Grading falls back only for those bundled round IDs.
- A private live round whose answer cannot be loaded returns an explicit retry/unavailable state.
- All new paid acquisition through the deployed app stops.
- An in-memory counter never substitutes for the global spending guard.

Keep database transactions short: reserve or settle in a transaction, commit, and make the Nansen network request outside it. [13]

### Live path

1. Validate the request and an idempotency identifier. Choose a server-owned candidate; accept no arbitrary endpoint or provider request body from the browser.
2. Apply durable per-IP limits and reserve the maximum allowed cost for the deal.
3. Make fresh upstream requests for the historical lookback and answer window. Normal cache-only retrieval is labelled cached.
4. Validate coverage, compile a round, and persist the private answer and source references.
5. Return the public question. Return the reveal only after the guess.
6. On failure, offer a labelled cached round without presenting it as a successful live retrieval.

Show retrieval time separately from historical activity time. A small source strip can show endpoint, upstream/cached status, credits actually reported, and latency; it must omit secrets, wallet addresses, and raw bodies.

A practical target is a completed fresh round within ten seconds, to be measured on the deployed app. The earlier three-second figure is not a guarantee. A fallback is useful product behavior, but a recording containing only fallback play is not proof of a successful live path.

## 8. Spend control and eligibility

The planned public path uses token DEX trades, with optional token screening or who-bought-sold discovery; these are currently listed at one credit per call. Validate actual response costs in the spike. [5]

Do not assume the full 100 trial credits remain unused. The campaign advertises a separate claimable 1,000-credit grant and doubled purchased credits during the window; use the account's actual balance for planning. Free-plan daily replenishment is a top-up to a small balance, not a fresh 100-credit grant each day. [1][7]

### Planning envelope

These are workload estimates, not observed call totals. Extra pages, retries, existing cache coverage, and early candidate rejection will change the result.

| Work | Estimated upstream calls | Estimated credits at 1 per call |
|---|---:|---:|
| Contract spike | 30 | 30 |
| Historical token/candidate discovery | 40 | 40 |
| Up to 500 distinct candidate cases, two coverage queries each | 1,000 | 1,000 |
| Additional pagination and targeted coverage checks | 50 | 50 |
| Deployed live verification, recording, and public-use reserve | 100 | 100 |
| Planned workload | 1,220 | 1,220 |
| Unallocated contingency | Not a call target | 280 |
| Total planning ceiling | — | 1,500 |

Acquire useful candidate cases until sufficient deck variety and verified eligibility are both achieved. Cases may be rejected with recorded reasons. Cache reuse and batching are desirable: if they reduce counted calls, expand useful coverage instead of bypassing cache or repeating requests to inflate usage.

Do not wait for public traffic to reach the threshold. Aim to reconcile at least **1,050 successful upstream calls by Thursday September 24**, allowing a margin over the official 1,000-call requirement. Failed calls remain in the ledger but are excluded from this internal success target unless Nansen explicitly confirms their treatment.

A 1,500-credit planning ceiling is not a purchase instruction. After the spike, compare the remaining balance with the revised forecast. If funds are insufficient, fund only the required gap through the account's normal purchase flow or revise the plan. The proposed throughput does not itself justify a recurring Pro subscription.

### Enforceable controls

- The local spike defaults to a 30-credit maximum. Bulk runs use explicit, bounded batches; do not silently raise the spike cap.
- Before hosted storage is connected, the single-process spike writes a durable local ledger. Import it once by stable attempt ID when Supabase is ready. Subsequent scripts and deployments share the same project budget, including their in-flight reservations.
- Public live mode begins disabled. Enable it after the deployed guard passes.
- Initial public live limits: 3 deals per minute per hashed IP, 4 credits maximum per deal, and 100 credits per UTC day within the remaining project ceiling.
- Reserve credits atomically before outbound requests. Include in-flight reservations when checking the day and project totals.
- A live deal reserves up to four credits once; individual calls and retries consume that allocation rather than reserving it twice. Settle known charges and release unused capacity at completion. Retain any amount whose charge status is unknown.
- Each actual attempt has a unique ledger record. Settle from X-Nansen-Credits-Used when available; retain unknown charges conservatively until reconciled.
- Repeated requests with the same deal identifier reuse the same result or status. They do not generate a second acquisition.
- Failed reservations, unavailable storage, exhausted caps, and unexpected pricing disable paid work.
- Keep the allowed endpoint list narrow. Address search, premium labels, agent endpoints, and trading endpoints are outside it.
- Throttle conservatively, initially around two requests per second. Honor Retry-After on 429, use bounded retries for transient failures, and stop on authentication or credit errors.
- Missing cost headers mean “unknown,” not zero. If a retry could create an unaccounted charge, retain its reservation.

Current published Free limits are 15 requests per second and 300 per minute. The conservative local pace leaves room for other calls on the account. [8]

## 9. First-session plan

**Estimate: four to six focused hours with working credentials and accounts.** This is a first-session estimate, not a 06:00 clock deadline or a promise to finish the submission in one sitting.

| Stage | Timebox | Deliverable and exit check |
|---|---|---|
| Environment | 20 minutes | Working repo, supported Node, Git, secrets stored correctly; use Codespaces if local setup stalls |
| Data contract | 45–60 minutes | Small Ethereum sample verifies token-relative action, filters, pagination, timestamps, and actual credits within the spike cap |
| Rules and fixtures | 60–90 minutes | Ten manually checked real rounds, including a fully observed No trade case; pure compiler and meaningful boundary checks |
| Game | 60 minutes | Five-round mobile/keyboard flow and copyable score work with Nansen offline |
| Live and deployment | 60–90 minutes | Server-only live retrieval, hosted persistence and tested spending reservation, deployed complete round |
| Review | 30 minutes | Claude reviews the named commit; resolve blocking findings and retain a usable milestone |

The first-session success condition is the entire narrow loop. Supabase setup can proceed after the first local round, but hosted paid refresh cannot ship without its durable guard.

If the contract spike fails, inspect the actual cause before widening the scope. Missing market-cap fields do not matter because buckets are cut. Unclear PnL semantics do not matter because the position clue is cut. Missing or unreliable action/coverage data does matter: resolve it or select a replacement launch chain, rather than adding another unproven feature.

If ten good rounds cannot be produced within the timebox, retain the working compiler and record the exact data blocker. Synthetic fixtures can support UI work, but must be labelled and cannot stand in for live Nansen evidence.

## 10. Remaining build and submission schedule

| Date, America/New_York | Priority | Exit criterion |
|---|---|---|
| Tue Sep 22 | Complete the first-session plan | Ten verified rounds; one deployed live guess/reveal; actual cost recorded |
| Wed Sep 23 | Expand candidates and harden compilation | Approximately 30–50 usable rounds; coverage/exclusion report; at least 500 successful calls if costs follow forecast |
| Thu Sep 24 | Finish acquisition and guard checks | At least 1,050 successful calls reconciled; sufficient deck variety; concurrency and failure behavior verified |
| Fri Sep 25 | Freeze core features; improve presentation | Mobile and keyboard flow, attribution, share text, README, clean-clone quick-start; optional price follow-up only if already cleared |
| Sat Sep 26 | Record and submit | Public repository, X recording, and entry form completed by 23:59 ET |
| Sun Sep 27 | Repair buffer | Resolve submission issues before 19:59 ET |

**Cut order:** seven-day follow-up → generated OG image → daily set scheduling → cosmetic animation. Crowd statistics, buckets, portfolio clues, second-chain support, and runtime AI are already deferred.

**Keep:** trustworthy scoring, ten real fixture rounds, one successful deployed live round, durable spending limits, truthful cached/live labels, the usage threshold, and the submission materials.

A stable shared challenge can be derived from deck version and seed. This does not require daily jobs or a daily_sets table.

## 11. Verification that matters

Do not target a test count or a blanket coverage percentage. Verify the behaviors that can invalidate a round, leak a secret, or spend beyond the cap.

| Check | Required result |
|---|---|
| Featured-token direction | A swap is graded relative to the displayed token; both buy and sell examples match the source |
| Cutoff and 48-hour boundary | Exact boundary examples follow the written inequalities |
| Incomplete coverage | Missing pages, errors, ambiguous ordering, and relevant invalid values never produce No trade |
| Look-ahead | Pre-guess clues contain no post-cutoff activity or optional price result |
| Answer boundary | Public HTML, RSC payloads, request responses, and client state contain no private answer before submission |
| Concurrent spending | Concurrent live requests near a cap cannot reserve more than the remaining allowance |
| Retry/idempotency | Repeated deal IDs and duplicate submissions cannot repeat paid acquisition |
| Storage failure | Cached play works; new paid calls stop |
| Offline behavior | Normal development, compiler runs, and keyless play make zero Nansen requests |
| Production flow | A fresh deployed upstream request creates a playable question and correct reveal |
| Reproducibility | Same frozen source fixtures and rules version yield the same round; source refreshes create new versions |

Try the initial game with a few target users. Check whether they understand the time window, can read the tape, and want another round. Treat the result as qualitative feedback.

A rules change needs verification where it changes behavior. UI copy and other low-impact edits do not require an artificial new test suite.

## 12. Submission and recording

Target a 40–55 second silent recording:

| Time | Screen |
|---|---|
| 0–8 seconds | Featured token, tape, question, and a guess |
| 8–15 seconds | Actual answer, elapsed time, evidence-based reveal |
| 15–35 seconds | Successful fresh Nansen retrieval with clearly separated fetch/history timestamps, followed by a guess and reveal |
| 35–45 seconds | Five-round result and copyable challenge |
| Final seconds | Repository URL and attribution |

Record a successful live segment; verify the resulting video rather than relying on the button animation. A cached fallback must not be labelled live.

README contents: one-line purpose, keyless setup, exact scoring rules, data flow, source/redistribution notes, call and credit accounting, live-mode setup, tests actually run, and honest limits. Time the clean-clone setup rather than asserting that it takes under ten minutes.

- [ ] At least 1,000 qualifying calls confirmed for the submitting account and competition window
- [ ] Public GitHub repository with a clean secret scan and no private raw responses or wallet-identity exports
- [ ] Deployed demo with attribution, cached mode, and a verified live path
- [ ] Clear source and fixture provenance; open sample answers acknowledged
- [ ] README quick-start timed on a clean clone
- [ ] 30–60 second recording
- [ ] X post tags @nansen_ai and includes the repository link
- [ ] Official entry form submitted with email, X URL, and GitHub URL
- [ ] Submission confirmation retained

Use the form linked from the official campaign/Academy page at submission time. [1][2]

## Appendix A. Project guardrails to carry into AGENTS.md

1. Implement the current milestone in this proposal; log scope changes before coding them.
2. Use a separate Whale Gossip repository and infrastructure. Do not modify 0600 during this sprint.
3. Normal development and tests run offline. Paid acquisition requires an explicit live mode and a bounded budget.
4. Keep provider credentials, privileged database keys, wallet identities, and raw responses out of the public repository and browser.
5. Commit a placeholder-only .env.example; ignore real .env and .env.local files. Do not use the blanket “never commit .env*” rule that would also exclude the required example.
6. Publish only the reviewed fixture export, with attribution and versioned provenance.
7. Use token-centric, unfiltered public data for the launch path; keep unsupported optional datasets disabled.
8. Preserve the score contract, complete-coverage requirement, and server-only answer boundary.
9. Stop paid work if reservations or logging cannot be made durable. Do not replace them with process memory.
10. Do not install new AI infrastructure or introduce model calls into scoring.
11. Report checks actually run and their results. Do not claim a deployed or live test passed from an offline fixture.
12. Before public release, inspect the built client payload, scan for secrets, verify the live flow, and reconcile usage.

## Appendix B. First Codex task

> Read PROPOSAL-v3.md and the repository instructions. Build only the first Whale Gossip milestone: Ethereum, one featured token per round, Buy/Sell/No trade in a fully observed 48-hour window, ten reviewed rounds, and the complete guess/reveal flow.
>
> Use Next.js and TypeScript, a pure deterministic rules module, server-only Nansen REST access, and a storage interface that works with fixtures before hosted persistence is connected. Start with the bounded contract spike if live credentials are available through the environment; otherwise implement explicitly labelled fixtures and state that live verification remains open.
>
> Keep the default public data path to ordinary tgm/dex-trades with only_smart_money=false and no label filters. Do not add buckets, PnL clues, crowd stats, runtime AI, or the seven-day follow-up.
>
> Use offline defaults, an endpoint allowlist, and the stated credit cap. Add the durable reservation guard before enabling hosted paid refresh. Test the important scoring boundaries and failure behavior. Finish with a working milestone, a clear README, and a handoff containing the commit, actual checks, and unresolved issues.

## Appendix C. Claude review brief

> Review the current commit against PROPOSAL-v3.md and AGENTS.md. Prioritize first-event correctness, full-window No trade handling, future-information leakage, the public/private serializer, cost reservations under concurrency, and truthful live/cached presentation.
>
> Inspect the actual diff and test evidence. Return findings with severity, location, failure scenario, and the smallest useful correction. Note any criterion that was not exercised. Do not expand the feature set or independently edit the active implementation checkout.

## Appendix D. Optional clarification for Nansen

Unsent draft for the later feature set:

> We are building Whale Gossip for Meridian. The launch version uses ordinary tgm/dex-trades with Smart Money filtering disabled and clear attribution. Players guess the next material action in one token from a historical tape. We plan to include a small transformed fixture set in the public repository for a keyless demo.
>
> For a later version, can you clarify public-display and fixture-distribution treatment for profiler/dex-trades and tgm/token-ohlcv, which are not explicitly listed in the redistribution table? We would label any OHLCV result as subsequent price movement, never realized wallet profit. We will keep those optional features disabled pending clarification.

## Sources and verification notes

The proposal and earlier peer review were read in full. Prior conversation context was used for the 0600 identity and the Windows/Codex/Claude workflow. Public documentation below was checked on September 22, 2026; the Label Me author write-up was checked during the earlier review.

No authenticated Nansen calls, repository implementation, deployment, or database mutation was performed to prepare this revision. Endpoint response behavior, real credit deductions, candidate yield, and live latency remain Day 1 checks. Cost envelopes, thresholds, timeboxes, and scope choices are recommendations.

1. [Nansen Meridian rules and entry requirements](https://academy.nansen.ai/articles/3540155-nansen-meridian-buildathon-sep-14-27)
2. [Official campaign and submission entry point](https://nansen.ai/campaigns/meridian-buildathon)
3. [Nansen Data Redistribution Guidelines](https://docs.nansen.ai/guides/redistribution-guide)
4. [Nansen Token God Mode DEX Trades](https://docs.nansen.ai/api/token-god-mode/dex-trades)
5. [Nansen endpoint overview and credit costs](https://docs.nansen.ai/api/overview)
6. [Nansen Price OHLCV](https://docs.nansen.ai/api/token-god-mode/price-ohlcv)
7. [Nansen credits and pricing](https://docs.nansen.ai/getting-started/credits)
8. [Nansen rate limits](https://docs.nansen.ai/getting-started/rate-limits)
9. [Label Me: creator's published design and limitations](https://dev.to/edycutjong/four-numbers-five-labels-how-far-can-you-read-a-crypto-wallet-without-a-model-4mh5)
10. [Next.js server/client boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components)
11. [Supabase changelog](https://supabase.com/changelog)
12. [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
13. [PostgreSQL transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html)
