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
const TOKEN = `0x${"a1".repeat(20)}`;
const TOKEN_CASE_VARIANT = `0x${"A1".repeat(20)}`;
const OTHER_TOKEN = `0x${"c3".repeat(20)}`;
const WALLET = `0x${"b2".repeat(20)}`;
const WALLET_CASE_VARIANT = `0x${"B2".repeat(20)}`;
const OTHER_WALLET = `0x${"d4".repeat(20)}`;

function transactionHash(seed: string): string {
  const encoded = [...seed].map((character) => character.codePointAt(0)?.toString(16).padStart(2, "0") ?? "00").join("");
  return `0x${encoded.padEnd(64, "0").slice(0, 64)}`;
}

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
    transactionHash: transactionHash(eventId),
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
    transactionHash: transactionHash("first-buy"),
  });
  assert.deepEqual(result.visibleTape.map((trade) => trade.eventId), ["tape-1", "tape-2", "tape-3", "tape-4", "tape-5"]);
  assert.ok(result.visibleTape.every((trade) => trade.occurredAtMs < T0), "visible tape must not contain post-cutoff clues");
  assert.equal(result.rulesVersion, "3");
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
  assert.ok(result.visibleTape.every((trade) => trade.eventId !== "at-cutoff"));
  assert.ok(result.visibleTape.every((trade) => trade.occurredAtMs < T0));
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

test("wrong wallet and token events cannot determine the answer", () => {
  const irrelevant = [
    event("wrong-wallet", T0, null, "sell", { wallet: OTHER_WALLET }),
    event("wrong-token", T0, 100_000, "sell", { token: OTHER_TOKEN }),
  ];
  const result = requireScorable(compileRound(input([...irrelevant, event("matching-buy", T0 + HOUR, 3_000)])));
  assert.equal(result.answer.action, "buy");
});

test("every supplied event must use the exact normalized Ethereum chain", () => {
  for (const chain of ["", "Ethereum", "eth", "base"]) {
    const result = expectUnscorable(
      compileRound(input([event(`wrong-chain-${chain}`, T0 + HOUR, 3_000, "buy", { chain })])),
      "invalid-event",
    );
    if (result.status === "unscorable" && result.reason.code === "invalid-event") {
      assert.equal(result.reason.field, "chain");
    }
  }
});

test("Ethereum addresses match case-insensitively and malformed round addresses are rejected", () => {
  const caseVariantAnswer = event("case-variant", T0 + HOUR, 3_000, "sell", {
    token: TOKEN_CASE_VARIANT,
    wallet: WALLET_CASE_VARIANT,
  });
  const result = requireScorable(compileRound(input([caseVariantAnswer])));
  assert.equal(result.answer.action, "sell");
  assert.equal(result.featuredToken, TOKEN);
  assert.equal(result.wallet, WALLET);

  expectUnscorable(compileRound({ ...input(), featuredToken: "synthetic-token" }), "invalid-ethereum-address");
  expectUnscorable(compileRound({ ...input(), wallet: "0x1234" }), "invalid-ethereum-address");
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

test("missing, malformed, unknown, and contradictory coverage cannot compile", () => {
  const base = input();
  const cases: Array<{ value: unknown; code: string; detail: string }> = [
    { value: { ...base, coverage: undefined }, code: "coverage-invalid", detail: "missing" },
    { value: { ...base, coverage: null }, code: "coverage-invalid", detail: "malformed" },
    {
      value: {
        ...base,
        coverage: {
          ...base.coverage,
          answerWindow: {
            status: "mystery",
            fromMs: T0,
            toMsExclusive: T0 + ANSWER_WINDOW_MS,
          },
        },
      },
      code: "coverage-invalid",
      detail: "unknown-status",
    },
    {
      value: {
        ...base,
        coverage: {
          ...base.coverage,
          lookback: {
            status: "complete",
            reason: "missing-pages",
            fromMs: T0 - LOOKBACK_MS,
            toMsExclusive: T0,
          },
        },
      },
      code: "coverage-invalid",
      detail: "contradictory",
    },
    {
      value: {
        ...base,
        coverage: {
          ...base.coverage,
          lookback: { fromMs: T0 - LOOKBACK_MS, toMsExclusive: T0 },
        },
      },
      code: "coverage-invalid",
      detail: "malformed",
    },
  ];

  for (const item of cases) {
    let result: RoundCompilationResult | undefined;
    assert.doesNotThrow(() => {
      result = compileRound(item.value);
    });
    assert.ok(result);
    const rejected = expectUnscorable(result, item.code);
    if (rejected.status === "unscorable" && rejected.reason.code === "coverage-invalid") {
      assert.equal(rejected.reason.detail, item.detail);
    }
  }
});

test("missing or non-numeric observation time cannot produce any answer", () => {
  const answerCases: readonly (readonly NormalizedTradeEvent[])[] = [
    [event("would-buy", T0 + HOUR, 3_000, "buy")],
    [event("would-sell", T0 + HOUR, 3_000, "sell")],
    [],
  ];

  for (const answerEvents of answerCases) {
    const validCoverage = completeCoverage();
    const withoutObservedAt = {
      lookback: validCoverage.lookback,
      answerWindow: validCoverage.answerWindow,
    };
    const malformedCoverage = { ...validCoverage, observedAtMs: "later" };

    for (const coverage of [withoutObservedAt, malformedCoverage]) {
      const result = expectUnscorable(compileRound({ ...input(answerEvents), coverage }), "coverage-invalid");
      if (result.status === "unscorable" && result.reason.code === "coverage-invalid") {
        assert.deepEqual(result.reason, { code: "coverage-invalid", segment: "root", detail: "malformed" });
      }
    }
  }
});

test("coverage cannot claim data later than its observation time", () => {
  const observedAtMs = T0 + ANSWER_WINDOW_MS;
  const cases = [
    {
      segment: "lookback",
      coverage: completeCoverage({
        observedAtMs,
        lookback: {
          status: "complete",
          fromMs: T0 - LOOKBACK_MS,
          toMsExclusive: observedAtMs + 1,
        },
      }),
    },
    {
      segment: "answer-window",
      coverage: completeCoverage({
        observedAtMs,
        answerWindow: {
          status: "complete",
          fromMs: T0,
          toMsExclusive: observedAtMs + 1,
        },
      }),
    },
  ] as const;

  for (const item of cases) {
    const result = expectUnscorable(compileRound(input([], { coverage: item.coverage })), "coverage-invalid");
    if (result.status === "unscorable" && result.reason.code === "coverage-invalid") {
      assert.deepEqual(result.reason, {
        code: "coverage-invalid",
        segment: item.segment,
        detail: "contradictory",
      });
    }
  }
});

test("coverage ending or starting one millisecond inside a required window is insufficient", () => {
  const answerEndsEarly = compileRound(
    input([], {
      coverage: completeCoverage({
        answerWindow: { status: "complete", fromMs: T0, toMsExclusive: T0 + ANSWER_WINDOW_MS - 1 },
      }),
    }),
  );
  const rejectedAnswer = expectUnscorable(answerEndsEarly, "coverage-incomplete");
  if (rejectedAnswer.status === "unscorable" && rejectedAnswer.reason.code === "coverage-incomplete") {
    assert.equal(rejectedAnswer.reason.detail, "range-mismatch");
  }

  const lookbackStartsLate = compileRound(
    input([], {
      coverage: completeCoverage({
        lookback: { status: "complete", fromMs: T0 - LOOKBACK_MS + 1, toMsExclusive: T0 },
      }),
    }),
  );
  const rejectedLookback = expectUnscorable(lookbackStartsLate, "coverage-incomplete");
  if (rejectedLookback.status === "unscorable" && rejectedLookback.reason.code === "coverage-incomplete") {
    assert.equal(rejectedLookback.reason.detail, "range-mismatch");
  }
});

test("a claimed complete answer window observed too early is contradictory", () => {
  const result = compileRound(
    input([], { coverage: completeCoverage({ observedAtMs: T0 + ANSWER_WINDOW_MS - 1 }) }),
  );
  const rejected = expectUnscorable(result, "coverage-invalid");
  if (rejected.status === "unscorable" && rejected.reason.code === "coverage-invalid") {
    assert.deepEqual(rejected.reason, {
      code: "coverage-invalid",
      segment: "answer-window",
      detail: "contradictory",
    });
  }
});

test("relevant null, non-finite, and negative USD values fail closed", () => {
  expectUnscorable(
    compileRound(input([event("null-answer", T0 + HOUR, null), event("later-valid", T0 + 2 * HOUR, 3_000)])),
    "invalid-usd-value",
  );

  const invalidLookback = [...baseLookback(), event("nan-lookback", T0 - HOUR, Number.NaN)];
  expectUnscorable(compileRound(input([], { events: invalidLookback })), "invalid-usd-value");

  expectUnscorable(compileRound(input([event("negative-answer", T0 + HOUR, -0.01)])), "invalid-usd-value");
});

test("empty identifiers, malformed addresses and hashes, and non-numeric USD are invalid events", () => {
  const valid = event("candidate", T0 + HOUR, 3_000);
  const cases: Array<{ candidate: unknown; field: string }> = [
    { candidate: { ...valid, eventId: "" }, field: "eventId" },
    { candidate: { ...valid, chain: "" }, field: "chain" },
    { candidate: { ...valid, token: "0x1234" }, field: "token" },
    { candidate: { ...valid, wallet: "not-an-address" }, field: "wallet" },
    { candidate: { ...valid, transactionHash: "" }, field: "transactionHash" },
    { candidate: { ...valid, transactionHash: "   " }, field: "transactionHash" },
    { candidate: { ...valid, transactionHash: "0x1234" }, field: "transactionHash" },
    { candidate: { ...valid, transactionHash: undefined }, field: "transactionHash" },
    { candidate: { ...valid, usdValue: "3000" }, field: "usdValue" },
  ];

  for (const item of cases) {
    const result = expectUnscorable(
      compileRound({ ...input(), events: [...baseLookback(), item.candidate] }),
      "invalid-event",
    );
    if (result.status === "unscorable" && result.reason.code === "invalid-event") {
      assert.equal(result.reason.field, item.field);
    }
  }
});

test("malformed JSON-shaped inputs and event fields return typed failures without throwing", () => {
  const malformedInputs: unknown[] = [
    null,
    {},
    { ...input(), featuredToken: 7 },
    { ...input(), events: "not-an-array" },
    { ...input(), events: [...baseLookback(), null] },
    {
      ...input(),
      events: [...baseLookback(), { ...event("bad-time", T0 + ANSWER_WINDOW_MS + 1, 3_000), occurredAtMs: "later" }],
    },
    {
      ...input(),
      events: [...baseLookback(), { ...event("bad-action", T0 + HOUR, 3_000), action: "hold" }],
    },
  ];

  for (const malformed of malformedInputs) {
    let result: RoundCompilationResult | undefined;
    assert.doesNotThrow(() => {
      result = compileRound(malformed);
    });
    assert.ok(result);
    assert.equal(result.status, "unscorable");
  }
});

test("identical records are deduplicated", () => {
  const first = event("duplicate-buy", T0 + HOUR, 2_500);
  const result = requireScorable(compileRound(input([first, { ...first }])));
  assert.equal(result.answer.action, "buy");
  assert.equal(result.answer.action === "buy" ? result.answer.eventId : null, "duplicate-buy");
});

test("valid transaction hashes normalize to lowercase before deduplication and grouping", () => {
  const lowercaseHash = transactionHash("case-normalized-hash");
  const uppercaseHash = `0x${lowercaseHash.slice(2).toUpperCase()}`;
  const duplicate = event("case-duplicate", T0 + HOUR, 3_000, "buy", { transactionHash: uppercaseHash });
  const deduplicated = requireScorable(
    compileRound(input([duplicate, { ...duplicate, transactionHash: lowercaseHash }])),
  );
  assert.deepEqual(deduplicated.answer, {
    action: "buy",
    eventId: "case-duplicate",
    occurredAtMs: T0 + HOUR,
    usdValue: 3_000,
    transactionHash: lowercaseHash,
  });

  const grouped = expectUnscorable(
    compileRound(
      input([
        event("case-leg-a", T0 + HOUR, 1_250, "buy", { transactionHash: uppercaseHash }),
        event("case-leg-b", T0 + HOUR, 1_250, "sell", { transactionHash: lowercaseHash }),
      ]),
    ),
    "ambiguous-potentially-material-transaction",
  );
  if (grouped.status === "unscorable" && grouped.reason.code === "ambiguous-potentially-material-transaction") {
    assert.equal(grouped.reason.transactionHash, lowercaseHash);
  }
});

test("conflicting records that reuse an event ID are unscorable", () => {
  const first = event("conflict", T0 + HOUR, 2_500);
  const second = { ...first, action: "sell" as const };
  expectUnscorable(compileRound(input([first, second])), "conflicting-duplicate");
});

test("conflicting matching duplicate IDs are rejected before window filtering", () => {
  const outside = T0 + ANSWER_WINDOW_MS + DAY;
  const first = event("outside-conflict", outside, 1_000);
  const second = { ...first, usdValue: 2_000 };
  const result = expectUnscorable(compileRound(input([first, second])), "conflicting-duplicate");
  if (result.status === "unscorable" && result.reason.code === "conflicting-duplicate") {
    assert.equal(result.reason.eventId, "outside-conflict");
  }
});

test("multiple conflicting IDs choose the same failure across input permutations", () => {
  const aFirst = event("a-conflict", T0 + HOUR, 3_000);
  const aSecond = { ...aFirst, action: "sell" as const };
  const zFirst = event("z-conflict", T0 + 2 * HOUR, 4_000);
  const zSecond = { ...zFirst, usdValue: 5_000 };
  const conflicts = [aFirst, aSecond, zFirst, zSecond];
  const expected = {
    status: "unscorable",
    reason: { code: "conflicting-duplicate", eventId: "a-conflict" },
  } as const;

  assert.deepEqual(compileRound(input(conflicts)), expected);
  assert.deepEqual(compileRound(input(conflicts.toReversed())), expected);
  assert.deepEqual(compileRound(input([zFirst, aSecond, zSecond, aFirst])), expected);
});

test("distinct transaction legs are preserved and make the first event ambiguous", () => {
  const sharedTransaction = transactionHash("shared-transaction");
  const legs = [
    event("leg-a", T0 + HOUR, 3_000, "buy", { transactionHash: sharedTransaction }),
    event("leg-b", T0 + HOUR, 4_000, "sell", { transactionHash: sharedTransaction }),
  ];
  expectUnscorable(compileRound(input(legs)), "ambiguous-potentially-material-transaction");
});

test("simultaneous ambiguous transactions choose the same hash across input permutations", () => {
  const lowerHash = `0x${"1".repeat(64)}`;
  const higherHash = `0x${"f".repeat(64)}`;
  const ambiguous = [
    event("higher-a", T0 + HOUR, 1_250, "buy", { transactionHash: higherHash }),
    event("higher-b", T0 + HOUR, 1_250, "sell", { transactionHash: higherHash }),
    event("lower-a", T0 + HOUR, 1_250, "buy", { transactionHash: lowerHash }),
    event("lower-b", T0 + HOUR, 1_250, "sell", { transactionHash: lowerHash }),
  ];
  const expected = {
    status: "unscorable",
    reason: { code: "ambiguous-potentially-material-transaction", transactionHash: lowerHash },
  } as const;

  assert.deepEqual(compileRound(input(ambiguous)), expected);
  assert.deepEqual(compileRound(input(ambiguous.toReversed())), expected);
  assert.deepEqual(compileRound(input([ambiguous[2], ambiguous[0], ambiguous[3], ambiguous[1]])), expected);
});

test("tied earliest material events in different transactions are unscorable", () => {
  const tied = [event("tie-a", T0 + HOUR, 3_000), event("tie-b", T0 + HOUR, 3_000, "sell")];
  expectUnscorable(compileRound(input(tied)), "tied-first-events");
});

test("combined legs totalling exactly $2,500 and mixed directions conservatively trigger ambiguity", () => {
  const splitBuyTransaction = transactionHash("split-buy");
  const splitBuys = [
    event("split-buy-a", T0 + HOUR, 1_250, "buy", { transactionHash: splitBuyTransaction }),
    event("split-buy-b", T0 + HOUR, 1_250, "buy", { transactionHash: splitBuyTransaction }),
  ];
  expectUnscorable(compileRound(input(splitBuys)), "ambiguous-potentially-material-transaction");

  const mixedTransaction = transactionHash("mixed");
  const mixed = [
    event("mixed-a", T0 + HOUR, 1_300, "buy", { transactionHash: mixedTransaction }),
    event("mixed-b", T0 + HOUR, 1_300, "sell", { transactionHash: mixedTransaction }),
  ];
  expectUnscorable(compileRound(input(mixed)), "ambiguous-potentially-material-transaction");

  const smallTransaction = transactionHash("small");
  const belowTrigger = [
    event("small-a", T0 + HOUR, 1_200, "buy", { transactionHash: smallTransaction }),
    event("small-b", T0 + HOUR, 1_299.99, "sell", { transactionHash: smallTransaction }),
  ];
  assert.deepEqual(requireScorable(compileRound(input(belowTrigger))).answer, { action: "no-trade" });
});

test("ambiguity before or at the first material event rejects, while later ambiguity cannot change it", () => {
  const beforeTransaction = transactionHash("before");
  const before = [
    event("before-a", T0 + HOUR, 1_300, "buy", { transactionHash: beforeTransaction }),
    event("before-b", T0 + HOUR, 1_300, "sell", { transactionHash: beforeTransaction }),
    event("valid-later", T0 + 2 * HOUR, 3_000, "buy"),
  ];
  expectUnscorable(compileRound(input(before)), "ambiguous-potentially-material-transaction");

  const atFirstTransaction = transactionHash("at-first");
  const atFirst = [
    event("first-material-leg", T0 + HOUR, 2_500, "sell", { transactionHash: atFirstTransaction }),
    event("first-small-leg", T0 + HOUR, 100, "buy", { transactionHash: atFirstTransaction }),
  ];
  expectUnscorable(compileRound(input(atFirst)), "ambiguous-potentially-material-transaction");

  const afterTransaction = transactionHash("after");
  const after = [
    event("valid-first", T0 + HOUR, 3_000, "sell"),
    event("after-a", T0 + 2 * HOUR, 1_300, "buy", { transactionHash: afterTransaction }),
    event("after-b", T0 + 2 * HOUR, 1_300, "sell", { transactionHash: afterTransaction }),
  ];
  const accepted = requireScorable(compileRound(input(after)));
  assert.equal(accepted.answer.action, "sell");
  assert.equal(accepted.answer.action === "sell" ? accepted.answer.eventId : null, "valid-first");
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

test("input permutations produce identical scorable and unscorable results", () => {
  const scorableEvents = [
    ...baseLookback(),
    event("later", T0 + 2 * HOUR, 3_000, "sell"),
    event("first", T0 + HOUR, 3_000, "buy"),
  ];
  const expectedScorable = compileRound(input([], { events: scorableEvents }));
  assert.deepEqual(compileRound(input([], { events: scorableEvents.toReversed() })), expectedScorable);
  assert.deepEqual(
    compileRound(input([], { events: [...scorableEvents.slice(3), ...scorableEvents.slice(0, 3)] })),
    expectedScorable,
  );

  const invalidEvents = [
    ...baseLookback(),
    event("later-invalid", T0 + 2 * HOUR, null),
    event("earlier-invalid", T0 + HOUR, Number.NaN),
  ];
  const expectedUnscorable = compileRound(input([], { events: invalidEvents }));
  const reversedUnscorable = compileRound(input([], { events: invalidEvents.toReversed() }));
  assert.deepEqual(reversedUnscorable, expectedUnscorable);
  assert.equal(expectedUnscorable.status, "unscorable");
  if (expectedUnscorable.status === "unscorable") assert.equal(expectedUnscorable.reason.code, "invalid-usd-value");

  const malformedEvents: unknown[] = [
    ...baseLookback(),
    { ...event("a-bad-action", T0 + HOUR, 3_000), action: "hold" },
    { ...event("z-bad-time", T0 + 2 * HOUR, 3_000), occurredAtMs: "later" },
  ];
  const malformedInput = { ...input(), events: malformedEvents };
  const expectedMalformed = compileRound(malformedInput);
  assert.deepEqual(compileRound({ ...malformedInput, events: malformedEvents.toReversed() }), expectedMalformed);
  assert.deepEqual(expectedMalformed, {
    status: "unscorable",
    reason: { code: "invalid-event", eventId: "z-bad-time", field: "occurredAtMs" },
  });
});
