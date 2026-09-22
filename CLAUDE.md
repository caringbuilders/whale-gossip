# Claude review instructions

Before reviewing, read these files in order:

1. `AGENTS.md` — project scope and repository guardrails.
2. `PROPOSAL-v3.md` — product, scoring, architecture, and acceptance criteria.
3. `docs/status.md` — current milestone, verified evidence, and open work.

Consult `docs/decisions.md` and `docs/knowledge.md` for decisions and unresolved assumptions. Review the named commit or supplied diff and actual check evidence. If no valid repository/commit exists, state that limitation and identify the files reviewed instead.

Prioritize first-event correctness, complete-window No trade handling, future-information leakage, question/reveal serialization, credential protection, concurrent spending reservations, and truthful offline/cached/live labels. Use the same round examples and acceptance criteria as Codex.

Return prioritized findings with severity, file/location, reproducible failure scenario, and the smallest useful correction. Explicitly note criteria not exercised. Do not expand scope or independently edit the active implementation checkout. Codex resolves accepted findings before the next milestone.
