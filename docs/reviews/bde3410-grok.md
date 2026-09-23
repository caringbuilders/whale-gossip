# Grok independent review: scoring normalization hardening

## Review identity and scope

- Reviewer: Grok 4.7 at High effort
- Reviewed commit: `bde341009c335af7e357adbb71255a340df0975c`
- Milestone base: `0d3994db0f294f3c39a3128cd366396d6961787d`
- Execution boundary: read-only sandbox; editing, shell, MCP, web, and subagents disabled
- Result: no blocking findings

The review was static. Grok did not independently execute tests, lint, type checking, Git status, provider behavior, or live integration. It did not edit the checkout or call external services.

## Files inspected

The supplied review evidence records inspection of:

- `AGENTS.md`
- `docs/rules.md`
- `docs/status.md`
- `lib/rules.ts`
- `test/rules.test.ts`

No broader file-inspection claim is made because the full review body was not included after the supplied review marker.

## Definite finding and disposition

Grok identified one definite non-blocking issue: JavaScript numeric negative zero satisfies neither `value < 0` nor the existing null/non-finite checks. A relevant `usdValue` of `-0` could therefore pass validation and contribute to a scorable result, including No trade.

Disposition: accepted. The rules now detect `Object.is(usdValue, -0)` and return the existing typed `invalid-usd-value` result. Focused synthetic regressions cover signed zero in the lookback alongside otherwise valid evidence and signed zero as the only answer-window event in an otherwise valid No trade candidate. The input-validation change advances the rules version from 3 to 4.

Grok's optional test suggestions were not added because the signed-zero correction exposed no related concrete failure beyond these two cases.

## Provider questions retained

The review does not resolve actual Nansen USD-value representation, signed-number serialization, chain or transaction-hash formats, stable leg identity, multi-leg semantics, timestamp precision, pagination, or completeness evidence. The normalized event contract and synthetic fixtures remain provisional. Public serialization and live integration remain unimplemented and unverified.
