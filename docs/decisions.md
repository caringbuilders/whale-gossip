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
