# Scope and architecture decisions

These decisions summarize `PROPOSAL-v3.md` as the agreed planning baseline. They do not assert implementation or independent validation of external claims. Record later scope changes here before coding them.

## Product

- Build Whale Gossip before returning to the separate 0600 news/wiki project; keep repository and hosted infrastructure separate.
- Launch on Ethereum with one featured token per round. Predict Buy, Sell, or No trade as the first material action in the next 48 hours. Five rounds yield a score out of five, a local streak, and a copyable challenge/result.
- Use a 30-day lookback, five visible trades of at least $500 strictly before the cutoff, and a $2,500 material threshold in the inclusive-start/exclusive-end answer window. Initial whale admission is one observed $25,000+ lookback trade. Version changes to these assumptions.
- Deterministic rules and evidence-based explanations govern both prepared and fresh rounds. Incomplete or ambiguous data is unscorable. No trade requires complete coverage, not an API failure.
- No runtime AI, accounts, social data, per-player analytics, PnL clues, market-cap buckets, crowd statistics, daily scheduling, or second chain at launch. Seven-day price follow-up is optional later work, disabled until clarified and verified; it would measure market movement, not realized profit.

## Data and architecture

| Boundary | Planned responsibility |
| --- | --- |
| Next.js App Router + TypeScript browser UI | Display public questions, submit guesses, show reveals, retain local streaks |
| Next.js server on Vercel | Select rounds, serialize public fields, grade, normalize provider responses, enforce live controls |
| Supabase | Private rounds/provenance, shared cache, attempt ledger, budgets, request limits, live-deal idempotency |
| Nansen REST | Historical observed activity through server code or an explicitly enabled acquisition script |
| Bundled reviewed fixtures | Keyless play, offline development, and zero-spend fallback |

Use ordinary token-centric `tgm/dex-trades` with `only_smart_money=false`, no label filters, and no displayed trader labels. This is the proposal's selected public-data path; actual response behavior remains to be checked. Attribute “Powered by Nansen API”. Keep wallet identities and raw responses private; publish reviewed transformed fixtures only.

Separate a pure rules module from server adapters and storage. Planned routes are question (`/api/round`), guess/reveal (`/api/guess`), and guarded fresh retrieval (`/api/deal`). Planned scripts cover the contract spike, resumable acquisition, offline compilation, reviewed publishing, and usage reporting. These paths do not exist yet.

Cache by endpoint, normalized parameters, and schema version. Freeze source snapshots and version decks/rules so shared challenges remain reproducible. Withhold answers from runtime question payloads; acknowledge that public fixture source is inspectable.

## Cost and resilience

Offline is the default. A 30-credit local spike precedes bulk acquisition; the proposal's total planning ceiling is 1,500 credits, not purchase authorization. Public live mode starts disabled, with proposed limits of 3 deals/minute per hashed IP, 4 credits/deal, and 100 credits/UTC day within the remaining project ceiling.

Reserve credits atomically before requests, count in-flight reservations, settle actual charges conservatively, and reuse deal IDs. Durable controls are mandatory for hosted paid work. Storage failure stops paid acquisition while bundled play remains available. Cached fallback must never be presented as successful fresh retrieval.

## Delivery and evidence

Codex implements small milestones; Claude independently reviews a named commit/diff; Codex resolves accepted findings. Pin dependencies and preserve the lockfile when introduced. Use Node LTS at least 22 and match development/deployment versions.

The proposal targets ten real reviewed rounds and one complete live flow first, then deck expansion and hardening. Its internal submission target is September 26, 2026 at 23:59 America/New_York. Its stated eligibility plan targets at least 1,050 successful upstream calls reconciled with Nansen, above the stated 1,000-call requirement. These are future targets; external requirements and actual usage require validation. Do not generate wasteful calls to inflate counts.

## Offline skeleton milestone — September 22, 2026

The authorized first application step is a static App Router landing page only. It explains the future game without rounds, results, or simulated live functionality. No API routes, authentication, database clients, or acquisition scripts are introduced. Plain CSS and system fonts keep the page self-contained; Next.js telemetry is disabled in npm scripts.

Scaffold files were added individually to preserve existing project documents. Node 24.21.0 is recorded in `.nvmrc`, the package engine requires Node 24, and exact direct dependency versions plus the npm lockfile define the installation. This advances the implementation in smaller steps without changing the product scope.

## Deterministic scoring milestone — September 22, 2026

The rules layer is a pure TypeScript module that accepts provisional normalized events plus explicit coverage evidence. It does not infer completeness from an event array and does not import framework, network, environment, storage, or UI code. The normalized shape uses exact canonical identifiers, integer UTC epoch milliseconds, token-relative lowercase actions, stable per-leg event IDs, transaction hashes, and nullable USD estimates. These are internal assumptions pending provider validation, not claims about the Nansen response schema.

Both the 30-day lookback and 48-hour answer window use half-open intervals. Exact dollar thresholds qualify. The returned tape is the last five qualifying pre-cutoff events in chronological order. Admission is evaluated across all validated matching lookback events, not only the displayed five.

Incomplete or failed coverage, an unfinished answer window, matching invalid values, conflicting duplicate IDs, insufficient tape, absent admission, an ambiguous first transaction with distinct material legs, and tied earliest material events are unscorable. Identical stable-ID records with identical fields are deduplicated. Different stable IDs are never collapsed merely because they share a transaction hash.

Conservative rejection takes precedence over creating a convenient answer. This first rules version rejects any matching null, non-finite, or negative USD value inside a required window because it could affect the tape, admission, or answer. Revisions after real schema validation must be versioned and backed by boundary tests.

The test suite uses Node's test API through the minimal `tsx` runner. All fixtures are explicitly synthetic and cannot count toward real-round acceptance or live verification.
