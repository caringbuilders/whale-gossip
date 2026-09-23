# Whale Gossip

An offline development skeleton for a five-round historical Ethereum trading game. The landing page explains the planned Buy / Sell / No trade question. There are no rounds, results, API integrations, or database connections yet.

## Local setup

Use Node.js **24.21.0** (recorded in `.nvmrc`) and npm. From this directory:

```bash
nvm use # if you use nvm
npm ci
npm run dev
```

Open **http://localhost:3000**. The server binds to loopback. Initial dependency installation requires package downloads; subsequent development requires no external services, credentials, or environment file. Stop the server with Ctrl+C.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

To serve the production build locally, run `npm start` and open the same URL. Do not run the development and production servers on the same port simultaneously.

Next.js telemetry is disabled in the npm scripts. The page uses system fonts and local CSS, with no external images, analytics, or data requests. The App Router page and layout are Server Components. Dependencies are pinned in `package.json`; retain `package-lock.json` and use `npm ci` to reproduce the installation.

Read `AGENTS.md`, `PROPOSAL-v3.md`, and `docs/status.md` before development. The status document records checks actually performed and remaining verification. Live acquisition is outside this milestone; the presence of credentials cannot enable it.
