# Whale Gossip

Whale Gossip is a five-round Ethereum guessing game. The current playable deck is an **explicitly synthetic offline demo**: read a fictional wallet's five-trade tape, choose Buy, Sell, or No trade for the next 48 hours, then reveal the deterministic result. It is a game about historical-style evidence, not investment advice.

The interface attributes the project as “Powered by Nansen API,” but this deck does not contain Nansen observations and gameplay makes no Nansen or other external request. The bounded provider contract spike is separate historical evidence recorded in `docs/nansen-contract-spike.md`. Real acquired rounds, live mode, persistence, authentication, and deployment remain future work.

## Local setup

Use Node.js **24.21.0** (recorded in `.nvmrc`) and npm. From this directory:

```bash
nvm use # if you use nvm
npm ci
npm run dev
```

Open **http://localhost:3000**. The development server binds to loopback. Stop it with Ctrl+C. The committed dependencies are sufficient; gameplay requires no credentials or environment file.

## Offline architecture

- `lib/rules.ts` is the accepted deterministic rules version 4.
- `lib/server/synthetic-rounds.ts` holds ten private, explicitly synthetic source records and compiled outcomes. Five are selected deterministically for each game.
- `lib/game/serializer.ts` allowlists relative times, broad size bands, fictional pseudonyms, and token display names for questions. Its separate reveal serializer runs only after a guess.
- `app/api/guess/route.ts` accepts only a server-owned round ID and a valid guess. It performs no provider request.
- `app/game.tsx` receives question payloads only. Private identifiers, exact values and times, source events, and outcomes are not passed as initial client props.

This is an offline demonstration boundary rather than authentication or an anti-cheat system. Someone with repository or server access can inspect the fictional source deck.

## Checks

```bash
npm test
npm run lint
npm run typecheck
```

`npm test` automatically loads the outbound-network guard. The synthetic tests cover rules compilation, deterministic deck selection, question and reveal serialization, forbidden-key and sentinel leakage, signed and ordinary zero, and guess-route validation. They are not verified historical rounds or provider-completeness evidence.

Do not run `npm run build` against the same `.next` directory while `npm run dev` is active. Read `AGENTS.md`, `PROPOSAL-v3.md`, and `docs/status.md` before development.
