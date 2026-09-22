# Environment knowledge and open validation questions

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
| Git identity / remotes | User-supplied name and email configured locally; no configured remotes |
| Initial project files | Proposal and its `:Zone.Identifier` sidecar; requested documentation did not exist |

The proposal specifies Windows with WSL2/Ubuntu and VS Code, GitHub as canonical source, and Codespaces as fallback. The kernel supports the WSL2 observation; the Linux distribution, editor, and fallback availability were not checked. There is no configured Git remote. No credentials were read or tested. Node support status and deployment runtime parity have not been independently validated.

## Nansen questions requiring a bounded live contract check

- Which verified Ethereum token contracts and historical periods provide sufficient qualifying trades and candidate variety?
- Do actual token DEX response fields match the proposed token-relative BUY/SELL interpretation, trader-address filter, timestamps, and USD estimates?
- How do date boundaries, sorting, page sizes, pagination termination, and history availability work in actual responses? Can full lookback and answer-window coverage be demonstrated?
- Which stable fields distinguish duplicate records from distinct swap legs? How should tied timestamps and multi-leg transactions be detected for rejection?
- How are missing or invalid USD estimates represented, and can their possible effect on the first material action be determined?
- What credit balance is actually available? What does each allowed request/page/retry cost, and is `X-Nansen-Credits-Used` present on successful and failed responses?
- What rate-limit and `Retry-After` behavior is observed? How are timeouts or uncertain charges reconciled with account usage?
- Does a fresh, complete round fit the proposed four-credit deal cap and ten-second deployed target? Neither is an observed result.
- Which attempts count toward competition eligibility? Reconcile successful calls and the competition window with the submitting account; planned requests and cache hits do not count as observed usage.

## Public-use and external questions

The proposal reports that ordinary token DEX data is allowed with attribution, while Smart Money DEX data and address labels are prohibited from redistribution. That report has not been independently revalidated here. Before release, verify current terms and that the reviewed transformed fixture export complies. Hiding addresses, using pseudonyms, or delaying data is not itself permission.

`profiler/dex-trades` and `tgm/token-ohlcv` public display and fixture-distribution treatment remain unresolved in the proposal; keep those optional paths disabled. The proposal contains an unsent clarification draft, not a sent request or provider approval.

Recheck official competition rules, call eligibility, deadlines, submission links, grants, pricing, and account usage before relying on them. The proposal's source links are references, not evidence that this session visited or validated them.

## Future infrastructure verification

The local author identity is configured for the foundation checkpoint. Remote setup is separate future work. Later verify Vercel/Supabase project linkage, secret storage, private table grants/RLS/function privileges, shared budget reservations under concurrency, idempotency, and fail-closed storage behavior. No hosted resources or controls have been verified by this documentation setup.

Private acquisition artifacts belong under ignored `data/` paths (for example `data/private/`, `data/raw/`, `data/cache/`, and `data/ledgers/`) or `private/`. Only `data/sample-deck.json` and `data/fixtures/` are allowed through the data ignore rule, and require explicit review before staging. Ignore rules do not inspect content or protect files force-added to Git.
