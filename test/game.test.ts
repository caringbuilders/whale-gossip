/**
 * EXPLICITLY SYNTHETIC OFFLINE GAME FIXTURES ONLY.
 * These tests perform no provider or other external requests.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { POST } from "../app/api/guess/route";
import { compileRound } from "../lib/rules";
import { serializeQuestion, serializeReveal } from "../lib/game/serializer";
import { getPublicOfflineGame, PRIVATE_SYNTHETIC_ROUNDS } from "../lib/server/synthetic-rounds";

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

test("guess route accepts only a server-owned round ID and valid guess", async () => {
  const valid = await POST(new Request("http://offline.test/api/guess", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roundId: "synthetic-round-01", guess: "buy" }),
  }));
  assert.equal(valid.status, 200);
  const validBody = await valid.json();
  assert.equal(validBody.ok, true);
  assert.deepEqual(walkKeys(validBody), []);

  const cases = [
    { body: "not-json", code: "invalid-request" },
    { body: JSON.stringify({ roundId: "missing", guess: "buy" }), code: "invalid-round-id" },
    { body: JSON.stringify({ roundId: "synthetic-round-01", guess: "hold" }), code: "invalid-guess" },
    { body: JSON.stringify({ roundId: "synthetic-round-01", guess: "buy", events: [] }), code: "invalid-request" },
  ];

  for (const item of cases) {
    const response = await POST(new Request("http://offline.test/api/guess", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: item.body,
    }));
    assert.equal(response.status, 400);
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
});
