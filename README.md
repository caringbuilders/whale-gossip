# Whale Gossip

Whale Gossip is a playable five-round Ethereum prediction game. Each round shows a fictional wallet's five-trade tape and asks whether its first material action during the next 48 hours was Buy, Sell, or No trade.

The current public deck uses **explicitly synthetic, deterministic fixtures**. It does not display live wallet data or claim that a real historical round was completed. The interface and reveal flow are playable without an API key.

## Nansen integration evidence

The private Nansen integration successfully logged **100 total API calls**: three bounded contract-spike calls and 97 acquisition calls. The acquisition calls consisted of six discovery calls and 91 candidate-specific coverage calls.

One wallet-filtered candidate reached coverage page 91. Each call requested the next sequential page required for its proposed 32-day window; the requests were not identical repeats. Early pages established consistent wallet-filter enforcement and extremely dense activity. Once completion appeared unlikely within the available budget, the user separately authorized continuing sequential coverage to the chosen Academy 100-call stop condition. Later pages continued to show wallet/token consistency and extreme density, but added limited diversity beyond that evidence. Page 91 was still nonterminal, so the candidate remained unscorable and no real round was published. API-call count alone does not prove a complete or publishable round.

The current Nansen Academy page says **100+ calls**, while an older campaign page says **1,000 calls**. That discrepancy remains unresolved and should be reconciled with the organizer.

**Powered by Nansen API.** The playable deck itself uses synthetic data, not Nansen data. Counts-only integration evidence is recorded in `docs/nansen-usage-summary.md`.

## Local setup — no API key required

Use Node.js **24.21.0** (recorded in `.nvmrc`) and npm. The normal quick-start is designed to take less than ten minutes:

```bash
nvm use # if you use nvm
npm ci
npm run dev
```

Open **http://localhost:3000**. The development server binds to loopback. Stop it with Ctrl+C. No credential or environment file is needed for the synthetic game.

## Public gameplay boundary

- `lib/rules.ts` contains accepted deterministic rules version 4.
- `lib/server/synthetic-rounds.ts` holds ten explicitly synthetic source records and compiled outcomes. Five are selected deterministically for each game.
- `lib/game/serializer.ts` emits only public relative times, broad size bands, fictional pseudonyms, and display names before a guess.
- `app/api/guess/route.ts` grades only server-owned synthetic round IDs and makes no provider request.
- `app/game.tsx` receives public question payloads and presents the five-round guess/reveal flow.

This boundary supports a keyless demonstration. It is not authentication or an anti-cheat system; repository or server access can reveal the fictional source deck.

## Optional private acquisition tooling

The repository also contains server-only acquisition tooling used for bounded, reviewed data preparation. It is separate from public gameplay, requires explicit authorization for any live request, and must never expose credentials, wallet identities, raw responses, or exact private evidence. Acquisition is currently frozen at 100 combined successful calls. No further live call is authorized by this checkpoint.

## Public policies and release prerequisites

The current offline release includes Terms of Use at `/terms` and a Privacy Notice at `/privacy`, both effective September 24, 2026. Revisit them before adding accounts, analytics, persistence, production live mode, or other collection.

Before deployment, complete the checks in `docs/submission-checklist.md`, including browser verification, the final secret/private-data scan, repository visibility confirmation, and the required recording and submission steps.

## Checks

```bash
npm test
npm run lint
npm run typecheck
```

`npm test` automatically loads the outbound-network guard. Synthetic tests are not verified historical rounds or provider-completeness evidence. Do not run `npm run build` against the same `.next` directory while `npm run dev` is active. Read `AGENTS.md`, `PROPOSAL-v3.md`, and `docs/status.md` before development.
