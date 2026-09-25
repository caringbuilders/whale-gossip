/**
 * EXPLICITLY SYNTHETIC OFFLINE GAME FIXTURES ONLY.
 * These tests perform no provider or other external requests.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { POST } from "../app/api/guess/route";
import { ANSWER_WINDOW_MS, compileRound, type Guess, type NormalizedTradeEvent } from "../lib/rules";
import {
  formatPublicSizeBand,
  formatRelativeAfterCutoff,
  formatRelativeBeforeCutoff,
  serializeQuestion,
  serializeReveal,
} from "../lib/game/serializer";
import { getPublicOfflineGame, getSyntheticReveal, PRIVATE_SYNTHETIC_ROUNDS } from "../lib/server/synthetic-rounds";

const HOUR_MS = 60 * 60 * 1_000;
const GUESSES: readonly Guess[] = ["buy", "sell", "no-trade"];
const EXPECTED_PLAYED_ACTIONS = new Map<string, Guess>([
  ["synthetic-round-01", "buy"],
  ["synthetic-round-03", "no-trade"],
  ["synthetic-round-05", "sell"],
  ["synthetic-round-07", "buy"],
  ["synthetic-round-09", "no-trade"],
]);

const FORBIDDEN_PUBLIC_KEYS = new Set([
  "wallet",
  "walletAddress",
  "featuredToken",
  "tokenAddress",
  "transactionHash",
  "eventId",
  "cutoffMs",
  "lookbackStartMs",
  "answerWindowEndMs",
  "occurredAtMs",
  "usdValue",
  "answer",
  "events",
  "coverage",
  "privateSentinel",
]);

const REVEAL_ONLY_KEYS = [
  "recordedAction",
  "guess",
  "correct",
  "points",
  "relativeElapsedTime",
  "explanation",
] as const;

function walkKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => walkKeys(item, found));
    return found;
  }
  if (typeof value !== "object" || value === null) return found;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) found.push(key);
    walkKeys(nested, found);
  }
  return found;
}

function privateValues(round: (typeof PRIVATE_SYNTHETIC_ROUNDS)[number]): readonly (string | number)[] {
  return [
    round.privateSentinel,
    round.compilation.wallet,
    round.compilation.featuredToken,
    round.compilation.cutoffMs,
    round.compilation.lookbackStartMs,
    round.compilation.answerWindowEndMs,
    ...round.sourceInput.events.flatMap((event) => [
      event.eventId,
      event.transactionHash,
      event.occurredAtMs,
      ...(event.usdValue !== null && event.usdValue >= 500 ? [event.usdValue] : []),
    ]),
  ];
}

test("all ten private synthetic fixtures compile through rules v4", () => {
  assert.equal(PRIVATE_SYNTHETIC_ROUNDS.length, 10);
  assert.deepEqual(
    PRIVATE_SYNTHETIC_ROUNDS.map((round) => round.compilation.status),
    Array.from({ length: 10 }, () => "scorable"),
  );
  assert.deepEqual(
    new Set(PRIVATE_SYNTHETIC_ROUNDS.map((round) => round.compilation.answer.action)),
    new Set(["buy", "sell", "no-trade"]),
  );
  for (const round of PRIVATE_SYNTHETIC_ROUNDS) {
    assert.equal(round.compilation.rulesVersion, "4");
    assert.equal(round.compilation.visibleTape.length, 5);
  }
});

test("five-round selection and question serialization are deterministic", () => {
  const first = getPublicOfflineGame();
  const second = getPublicOfflineGame();
  assert.equal(first.length, 5);
  assert.equal(new Set(first.map((round) => round.roundId)).size, 5);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(new Set(first.map((round) => EXPECTED_PLAYED_ACTIONS.get(round.roundId))), new Set(GUESSES));
});

test("question bytes are independent of answer action and all future events", () => {
  for (const [index, round] of PRIVATE_SYNTHETIC_ROUNDS.entries()) {
    const alternateAction = round.compilation.answer.action === "buy" ? "sell" : "buy";
    const alternateEvent: NormalizedTradeEvent = {
      eventId: `PRIVATE_ALTERNATE_ANSWER_${index + 1}`,
      chain: "ethereum",
      token: round.sourceInput.featuredToken,
      wallet: round.sourceInput.wallet,
      transactionHash: `0x${(90_000 + index).toString(16).padStart(64, "0")}`,
      occurredAtMs: round.sourceInput.cutoffMs + (index + 1) * HOUR_MS,
      action: alternateAction,
      usdValue: 2_500 + index,
    };
    const alternateInput = {
      ...round.sourceInput,
      events: [
        ...round.sourceInput.events.filter((event) => event.occurredAtMs < round.sourceInput.cutoffMs),
        alternateEvent,
      ],
    };
    const alternateCompilation = compileRound(alternateInput);
    assert.equal(alternateCompilation.status, "scorable");
    if (alternateCompilation.status !== "scorable") continue;
    assert.notEqual(alternateCompilation.answer.action, round.compilation.answer.action);

    const alternateRound = { ...round, compilation: alternateCompilation };
    const originalBytes = JSON.stringify(serializeQuestion(round, index + 1));
    const alternateBytes = JSON.stringify(serializeQuestion(alternateRound, index + 1));
    assert.equal(alternateBytes, originalBytes);
    assert.equal(originalBytes.includes(alternateEvent.eventId), false);
    assert.equal(originalBytes.includes(alternateEvent.transactionHash), false);
  }
});

test("public questions omit private keys and every private sentinel or exact source value", () => {
  for (const [index, round] of PRIVATE_SYNTHETIC_ROUNDS.entries()) {
    const question = serializeQuestion(round, index + 1);
    const serialized = JSON.stringify(question);
    assert.deepEqual(walkKeys(question), []);
    for (const key of REVEAL_ONLY_KEYS) assert.equal(key in question, false);
    assert.equal(question.visibleTape.length, 5);
    assert.equal(question.source, "Synthetic offline fixture");
    for (const value of privateValues(round)) {
      assert.equal(serialized.includes(String(value)), false, `Leaked private value for ${round.roundId}`);
    }
  }
});

test("post-guess reveals remain allowlisted, deterministic, and free of identifiers", () => {
  for (const round of PRIVATE_SYNTHETIC_ROUNDS) {
    const first = serializeReveal(round, "buy");
    const second = serializeReveal(round, "buy");
    assert.deepEqual(first, second);
    assert.deepEqual(walkKeys(first), []);
    const serialized = JSON.stringify(first);
    for (const value of privateValues(round)) {
      assert.equal(serialized.includes(String(value)), false, `Leaked reveal value for ${round.roundId}`);
    }
  }
});

test("all fifteen played-round guesses have fixed actions, correctness, and points", () => {
  const results = [];
  for (const question of getPublicOfflineGame()) {
    const expectedAction = EXPECTED_PLAYED_ACTIONS.get(question.roundId);
    assert.ok(expectedAction);
    for (const guess of GUESSES) {
      const reveal = getSyntheticReveal(question.roundId, guess);
      assert.ok(reveal);
      assert.equal(reveal.recordedAction, expectedAction === "buy" ? "Buy" : expectedAction === "sell" ? "Sell" : "No trade");
      assert.equal(reveal.correct, guess === expectedAction);
      assert.equal(reveal.points, guess === expectedAction ? 1 : 0);
      results.push(reveal);
    }
  }
  assert.equal(results.length, 15);
  assert.equal(results.filter((result) => result.correct).length, 5);
  assert.equal(results.reduce((total, result) => total + result.points, 0), 5);
  assert.notEqual(results.every((result) => result.correct), true);
  assert.notEqual(results.every((result) => result.points === 1), true);
  assert.notEqual(results.every((result) => result.recordedAction === "Buy"), true);
});

test("unplayed fixture IDs cannot be revealed", () => {
  const playedIds = new Set(getPublicOfflineGame().map((round) => round.roundId));
  const unplayed = PRIVATE_SYNTHETIC_ROUNDS.filter((round) => !playedIds.has(round.roundId));
  assert.equal(unplayed.length, 5);
  for (const round of unplayed) assert.equal(getSyntheticReveal(round.roundId, "buy"), null);
});

test("public time labels and size bands preserve their exact boundaries", () => {
  const cutoff = Date.UTC(2026, 8, 24, 12, 0, 0);
  assert.equal(formatRelativeBeforeCutoff(cutoff, cutoff - 5 * 24 * HOUR_MS), "5 days before cutoff");
  assert.equal(formatRelativeBeforeCutoff(cutoff, cutoff - 3 * 24 * HOUR_MS), "3 days before cutoff");
  assert.equal(formatRelativeBeforeCutoff(cutoff, cutoff - 36 * HOUR_MS), "36 hours before cutoff");
  assert.equal(formatRelativeBeforeCutoff(cutoff, cutoff - 12 * HOUR_MS), "12 hours before cutoff");
  assert.equal(formatRelativeBeforeCutoff(cutoff, cutoff - 2 * HOUR_MS), "2 hours before cutoff");
  assert.equal(formatRelativeAfterCutoff(cutoff, cutoff), "At the cutoff");
  assert.equal(formatRelativeAfterCutoff(cutoff, cutoff + HOUR_MS), "1 hour after cutoff");
  assert.equal(formatRelativeAfterCutoff(cutoff, cutoff + 24 * HOUR_MS), "1 day after cutoff");
  assert.equal(formatRelativeAfterCutoff(cutoff, cutoff + 47 * HOUR_MS), "47 hours after cutoff");

  assert.equal(formatPublicSizeBand(500), "$500–$999");
  assert.equal(formatPublicSizeBand(999.99), "$500–$999");
  assert.equal(formatPublicSizeBand(1_000), "$1k–$4.9k");
  assert.equal(formatPublicSizeBand(4_999.99), "$1k–$4.9k");
  assert.equal(formatPublicSizeBand(5_000), "$5k–$24.9k");
  assert.equal(formatPublicSizeBand(24_999.99), "$5k–$24.9k");
  assert.equal(formatPublicSizeBand(25_000), "$25k–$99k");
  assert.equal(formatPublicSizeBand(99_999.99), "$25k–$99k");
  assert.equal(formatPublicSizeBand(100_000), "$100k+");

  const expectedElapsed = [
    "At the cutoff",
    "11 hours after cutoff",
    "No material trade during the fully observed 48-hour window",
    "47 hours after cutoff",
    "1 hour after cutoff",
    "No material trade during the fully observed 48-hour window",
    "1 day after cutoff",
    "2 hours after cutoff",
    "No material trade during the fully observed 48-hour window",
    "9 hours after cutoff",
  ];
  const expectedBands = [
    "$1k–$4.9k",
    "$5k–$24.9k",
    null,
    "$5k–$24.9k",
    "$100k+",
    null,
    "$1k–$4.9k",
    "$1k–$4.9k",
    null,
    "$25k–$99k",
  ];
  PRIVATE_SYNTHETIC_ROUNDS.forEach((round, index) => {
    const reveal = serializeReveal(round, "buy");
    assert.equal(reveal.relativeElapsedTime, expectedElapsed[index]);
    assert.equal(reveal.sizeBand, expectedBands[index]);
  });
});

test("runtime-shaped outputs preserve t0, $2,500, and 48-hour boundaries", () => {
  const exactCutoffRound = PRIVATE_SYNTHETIC_ROUNDS[0];
  const exactAnswer = exactCutoffRound.compilation.answer;
  assert.equal(exactAnswer.action, "buy");
  assert.equal(exactAnswer.occurredAtMs, exactCutoffRound.compilation.cutoffMs);
  assert.equal(exactAnswer.usdValue, 2_500);
  const cutoffQuestion = serializeQuestion(exactCutoffRound, 1);
  assert.equal(cutoffQuestion.visibleTape.some((trade) => trade.relativeTime === "At the cutoff"), false);
  const cutoffReveal = serializeReveal(exactCutoffRound, "buy");
  assert.equal(cutoffReveal.recordedAction, "Buy");
  assert.equal(cutoffReveal.relativeElapsedTime, "At the cutoff");
  assert.equal(cutoffReveal.sizeBand, "$1k–$4.9k");

  const endpointRound = PRIVATE_SYNTHETIC_ROUNDS[8];
  assert.ok(endpointRound.sourceInput.events.some(
    (event) => event.occurredAtMs === endpointRound.sourceInput.cutoffMs + ANSWER_WINDOW_MS && event.usdValue === 90_000,
  ));
  const endpointReveal = serializeReveal(endpointRound, "no-trade");
  assert.equal(endpointReveal.recordedAction, "No trade");
  assert.equal(endpointReveal.correct, true);
  assert.equal(endpointReveal.sizeBand, null);
});

test("ordinary zero remains nonmaterial while signed zero remains invalid under rules v4", () => {
  const noTradeRound = PRIVATE_SYNTHETIC_ROUNDS.find((round) =>
    round.sourceInput.events.some((event) => Object.is(event.usdValue, 0)),
  );
  assert.ok(noTradeRound);
  assert.equal(noTradeRound.compilation.answer.action, "no-trade");
  assert.equal(noTradeRound.compilation.visibleTape.some((trade) => trade.usdValue === 0), false);

  const signedZeroInput = {
    ...noTradeRound.sourceInput,
    events: noTradeRound.sourceInput.events.map((event) =>
      Object.is(event.usdValue, 0) ? { ...event, usdValue: -0 } : event,
    ),
  };
  const result = compileRound(signedZeroInput);
  assert.equal(result.status, "unscorable");
  if (result.status === "unscorable") assert.equal(result.reason.code, "invalid-usd-value");
});

test("guess route covers all fifteen outcomes and sends no-store for every typed result", async () => {
  for (const question of getPublicOfflineGame()) {
    const expectedAction = EXPECTED_PLAYED_ACTIONS.get(question.roundId);
    assert.ok(expectedAction);
    for (const guess of GUESSES) {
      const response = await POST(new Request("http://offline.test/api/guess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roundId: question.roundId, guess }),
      }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.equal(result.reveal.correct, guess === expectedAction);
      assert.equal(result.reveal.points, guess === expectedAction ? 1 : 0);
      assert.deepEqual(walkKeys(result), []);
    }
  }

  const cases = [
    { body: "not-json", code: "invalid-request" },
    { body: JSON.stringify({ roundId: "missing", guess: "buy" }), code: "invalid-round-id" },
    { body: JSON.stringify({ roundId: "synthetic-round-01", guess: "hold" }), code: "invalid-guess" },
    { body: JSON.stringify({ roundId: "synthetic-round-01", guess: "buy", events: [] }), code: "invalid-request" },
  ] as const;

  for (const item of cases) {
    const response = await POST(new Request("http://offline.test/api/guess", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: item.body,
    }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, item.code);
  }
});

test("client components cannot import the private fixture module", () => {
  const appRoot = new URL("../app/", import.meta.url);
  const clientSources = readdirSync(appRoot, { recursive: true })
    .filter((path): path is string => typeof path === "string" && /\.[cm]?[jt]sx?$/.test(path))
    .map((path) => readFileSync(new URL(path, appRoot), "utf8"))
    .filter((source) => /^\s*["']use client["'];/.test(source));
  assert.ok(clientSources.length > 0);
  for (const clientSource of clientSources) {
    assert.match(clientSource, /^"use client";/);
    assert.doesNotMatch(clientSource, /lib\/server|synthetic-rounds|PrivateCompiledRound/);
  }

  const serverModule = readFileSync(new URL("../lib/server/synthetic-rounds.ts", import.meta.url), "utf8");
  assert.match(serverModule, /import "server-only";/);
});

test("homepage explains the synthetic token-specific game objective", () => {
  const homeSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(homeSource, /<section className="game-explainer" aria-labelledby="how-to-play-title">/);
  assert.match(homeSource, /Read five synthetic pre-cutoff trades from a pseudonymous large-trade wallet\./);
  assert.match(homeSource, /first material \(\$2\.5k\+\) trade in the same featured token during the next 48 hours/);
  assert.match(homeSource, /Buy, Sell, or No trade/);
  assert.match(homeSource, /one point for each correct call/);
  assert.match(homeSource, /activity in that token only—not its other assets or the token’s subsequent market price/);
  assert.match(homeSource, /fictional identifiers used in this deterministic demo—not real identities, Nansen labels, or live market data/);
});
