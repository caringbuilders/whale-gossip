/**
 * SYNTHETIC OFFLINE FIXTURES ONLY.
 * These invented events test deterministic boundaries. They are not Nansen
 * responses, verified historical rounds, or evidence of live integration.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_WINDOW_MS,
  LOOKBACK_MS,
  compileRound,
  scoreGuess,
  type CoverageEvidence,
  type NormalizedTradeEvent,
  type RoundCompilationInput,
  type RoundCompilationResult,
} from "../lib/rules";

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const TOKEN = "synthetic-token";
const WALLET = "synthetic-wallet";

function event(
  eventId: string,
  occurredAtMs: number,
  usdValue: number | null,
  action: "buy" | "sell" = "buy",
  overrides: Partial<NormalizedTradeEvent> = {},
): NormalizedTradeEvent {
  return {
    eventId,
    chain: "ethereum",
    token: TOKEN,
    wallet: WALLET,
    transactionHash: `tx-${eventId}`,
    occurredAtMs,
    action,
    usdValue,
    ...overrides,
  };
}

function completeCoverage(overrides: Partial<CoverageEvidence> = {}): CoverageEvidence {
  return {
    lookback: { status: "complete", fromMs: T0 - LOOKBACK_MS, toMsExclusive: T0 },
    answerWindow: { status: "complete", fromMs: T0, toMsExclusive: T0 + ANSWER_WINDOW_MS },
    observedAtMs: T0 + ANSWER_WINDOW_MS,
    ...overrides,
  };
}

function baseLookback(): NormalizedTradeEvent[] {
  return [
    event("admission", T0 - 20 * DAY, 25_000),
    event("tape-1", T0 - 5 * DAY, 500, "sell"),
    event("tape-2", T0 - 4 * DAY, 600),
    event("tape-3", T0 - 3 * DAY, 700, "sell"),
    event("tape-4", T0 - 2 * DAY, 800),
    event("tape-5", T0 - DAY, 900),
  ];
}

function input(
  answerEvents: readonly NormalizedTradeEvent[] = [],
  overrides: Partial<RoundCompilationInput> = {},
): RoundCompilationInput {
  return {
    chain: "ethereum",
    featuredToken: TOKEN,
    wallet: WALLET,
    cutoffMs: T0,
    events: [...baseLookback(), ...answerEvents],
    coverage: completeCoverage(),
    ...overrides,
  };
}

function requireScorable(result: RoundCompilationResult) {
  assert.equal(result.status, "scorable", result.status === "unscorable" ? JSON.stringify(result.reason) : undefined);
  return result;
}

function expectUnscorable(result: RoundCompilationResult, code: string) {
  assert.equal(result.status, "unscorable");
  if (result.status === "unscorable") assert.equal(result.reason.code, code);
  return result;
}

test("synthetic Buy round uses the first material event from unsorted input", () => {
  const events = [
    event("later-sell", T0 + 4 * HOUR, 9_000, "sell"),
    ...baseLookback().toReversed(),
    event("first-buy", T0 + HOUR, 2_500, "buy"),
  ];
  const result = requireScorable(compileRound(input([], { events })));

  assert.deepEqual(result.answer, {
    action: "buy",
    eventId: "first-buy",
    occurredAtMs: T0 + HOUR,
    usdValue: 2_500,
    transactionHash: "tx-first-buy",
  });
  assert.deepEqual(result.visibleTape.map((trade) => trade.eventId), ["tape-1", "tape-2", "tape-3", "tape-4", "tape-5"]);
  assert.ok(result.visibleTape.every((trade) => trade.occurredAtMs < T0), "visible tape must not contain post-cutoff clues");
});

test("synthetic Sell round is selected and scored", () => {
  const result = requireScorable(compileRound(input([event("first-sell", T0 + HOUR, 3_000, "sell")])));
  assert.equal(result.answer.action, "sell");
  assert.deepEqual(scoreGuess(result.answer, "sell"), { status: "scored", guess: "sell", correct: true, points: 1 });
  assert.deepEqual(scoreGuess(result.answer, "buy"), { status: "scored", guess: "buy", correct: false, points: 0 });
});

test("fully observed synthetic No trade ignores sub-material and exact 48-hour events", () => {
  const result = requireScorable(
    compileRound(
      input([
        event("below-material", T0 + HOUR, 2_499.99, "sell"),
        event("at-exclusive-end", T0 + ANSWER_WINDOW_MS, 50_000, "buy"),
      ]),
    ),
  );

  assert.deepEqual(result.answer, { action: "no-trade" });
  assert.deepEqual(scoreGuess(result.answer, "no-trade"), {
    status: "scored",
    guess: "no-trade",
    correct: true,
    points: 1,
  });
});

test("exact cutoff is included in the answer window and exact material threshold qualifies", () => {
  const result = requireScorable(compileRound(input([event("at-cutoff", T0, 2_500, "buy")])));
  assert.equal(result.answer.action, "buy");
  assert.equal(result.answer.action === "buy" ? result.answer.occurredAtMs : null, T0);
});

test("visible threshold is inclusive and immediately lower values are excluded", () => {
  const events = [
    event("admission", T0 - 20 * DAY, 25_000),
    event("exact-visible", T0 - 5 * DAY, 500),
    event("v2", T0 - 4 * DAY, 600),
    event("v3", T0 - 3 * DAY, 700),
    event("v4", T0 - 2 * DAY, 800),
    event("v5", T0 - DAY, 900),
    event("below-visible", T0 - HOUR, 499.99),
  ];
  const result = requireScorable(compileRound(input([], { events })));
  assert.deepEqual(result.visibleTape.map((trade) => trade.eventId), ["exact-visible", "v2", "v3", "v4", "v5"]);
});

test("admission threshold is inclusive, including at the exact lookback start", () => {
  const events = baseLookback().map((item) =>
    item.eventId === "admission" ? event("admission", T0 - LOOKBACK_MS, 25_000) : item,
  );
  assert.equal(compileRound(input([], { events })).status, "scorable");

  const below = events.map((item) =>
    item.eventId === "admission" ? event("admission", T0 - LOOKBACK_MS, 24_999.99) : item,
  );
  expectUnscorable(compileRound(input([], { events: below })), "admission-not-met");

  const beforeLookback = events.map((item) =>
    item.eventId === "admission" ? event("admission", T0 - LOOKBACK_MS - 1, 25_000) : item,
  );
  expectUnscorable(compileRound(input([], { events: beforeLookback })), "admission-not-met");
});

test("round compilation is Ethereum-only", () => {
  expectUnscorable(compileRound(input([], { chain: "base" })), "unsupported-chain");
});

test("wrong wallet, token, and chain events cannot determine the answer", () => {
  const irrelevant = [
    event("wrong-wallet", T0, null, "sell", { wallet: "someone-else" }),
    event("wrong-token", T0, 100_000, "sell", { token: "other-token" }),
    event("wrong-chain", T0, 100_000, "sell", { chain: "base" }),
  ];
  const result = requireScorable(compileRound(input([...irrelevant, event("matching-buy", T0 + HOUR, 3_000)])));
  assert.equal(result.answer.action, "buy");
});

test("missing pages and retrieval failures remain explicit coverage failures", () => {
  const missingLookback = compileRound(
    input([], {
      coverage: completeCoverage({ lookback: { status: "incomplete", reason: "missing-pages" } }),
    }),
  );
  const missingResult = expectUnscorable(missingLookback, "coverage-incomplete");
  if (missingResult.status === "unscorable" && missingResult.reason.code === "coverage-incomplete") {
    assert.deepEqual(missingResult.reason, {
      code: "coverage-incomplete",
      segment: "lookback",
      detail: "missing-pages",
    });
  }

  const failedAnswer = compileRound(
    input([], {
      coverage: completeCoverage({ answerWindow: { status: "incomplete", reason: "retrieval-failed" } }),
    }),
  );
  const failedResult = expectUnscorable(failedAnswer, "coverage-incomplete");
  if (failedResult.status === "unscorable" && failedResult.reason.code === "coverage-incomplete") {
    assert.deepEqual(failedResult.reason, {
      code: "coverage-incomplete",
      segment: "answer-window",
      detail: "retrieval-failed",
    });
  }
});

test("coverage ranges cannot be inferred from events and must span the required windows", () => {
  const result = compileRound(
    input([], {
      coverage: completeCoverage({
        answerWindow: { status: "complete", fromMs: T0 + 1, toMsExclusive: T0 + ANSWER_WINDOW_MS },
      }),
    }),
  );
  const rejected = expectUnscorable(result, "coverage-incomplete");
  if (rejected.status === "unscorable" && rejected.reason.code === "coverage-incomplete") {
    assert.equal(rejected.reason.detail, "range-mismatch");
  }
});

test("an unfinished answer window is unscorable even when coverage claims completeness", () => {
  const result = compileRound(
    input([], { coverage: completeCoverage({ observedAtMs: T0 + ANSWER_WINDOW_MS - 1 }) }),
  );
  expectUnscorable(result, "answer-window-unfinished");
});

test("relevant null and invalid USD values fail closed", () => {
  expectUnscorable(
    compileRound(input([event("null-answer", T0 + HOUR, null), event("later-valid", T0 + 2 * HOUR, 3_000)])),
    "invalid-usd-value",
  );

  const invalidLookback = [...baseLookback(), event("nan-lookback", T0 - HOUR, Number.NaN)];
  expectUnscorable(compileRound(input([], { events: invalidLookback })), "invalid-usd-value");
});

test("identical records are deduplicated", () => {
  const first = event("duplicate-buy", T0 + HOUR, 2_500);
  const result = requireScorable(compileRound(input([first, { ...first }])));
  assert.equal(result.answer.action, "buy");
  assert.equal(result.answer.action === "buy" ? result.answer.eventId : null, "duplicate-buy");
});

test("conflicting records that reuse an event ID are unscorable", () => {
  const first = event("conflict", T0 + HOUR, 2_500);
  const second = { ...first, action: "sell" as const };
  expectUnscorable(compileRound(input([first, second])), "conflicting-duplicate");
});

test("distinct transaction legs are preserved and make the first event ambiguous", () => {
  const legs = [
    event("leg-a", T0 + HOUR, 3_000, "buy", { transactionHash: "shared-transaction" }),
    event("leg-b", T0 + HOUR, 4_000, "sell", { transactionHash: "shared-transaction" }),
  ];
  expectUnscorable(compileRound(input(legs)), "ambiguous-multi-leg-first-event");
});

test("tied earliest material events in different transactions are unscorable", () => {
  const tied = [event("tie-a", T0 + HOUR, 3_000), event("tie-b", T0 + HOUR, 3_000, "sell")];
  expectUnscorable(compileRound(input(tied)), "tied-first-events");
});

test("insufficient qualifying tape and absent admission evidence are distinct failures", () => {
  const shortTape = [
    event("admission", T0 - 20 * DAY, 25_000),
    event("one", T0 - 3 * DAY, 600),
    event("two", T0 - 2 * DAY, 700),
    event("three", T0 - DAY, 800),
  ];
  expectUnscorable(compileRound(input([], { events: shortTape })), "insufficient-visible-tape");

  const noAdmission = baseLookback().map((item) => ({ ...item, usdValue: Math.min(item.usdValue ?? 0, 24_999.99) }));
  expectUnscorable(compileRound(input([], { events: noAdmission })), "admission-not-met");
});

test("invalid guesses are rejected instead of scored", () => {
  const result = requireScorable(compileRound(input([event("buy", T0 + HOUR, 3_000)])));
  assert.deepEqual(scoreGuess(result.answer, "hold"), { status: "invalid-guess", reason: "invalid-guess" });
  assert.deepEqual(scoreGuess(result.answer, null), { status: "invalid-guess", reason: "invalid-guess" });
});

test("identical inputs compile to deeply identical outputs without mutation", () => {
  const source = input([event("repeatable", T0 + 2 * HOUR, 3_000, "sell")]);
  const before = structuredClone(source);
  const first = compileRound(source);
  const second = compileRound(source);

  assert.deepEqual(first, second);
  assert.deepEqual(source, before);
});
