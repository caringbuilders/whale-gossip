import assert from "node:assert/strict";
import test from "node:test";

import {
  beginSubmission,
  createSubmissionGate,
  finishSubmission,
  invalidateSubmissions,
  isSubmissionCurrent,
  parseGuessApiResponse,
} from "../lib/game/client-contract";
import { getSyntheticReveal } from "../lib/server/synthetic-rounds";

function validSuccess() {
  const reveal = getSyntheticReveal("synthetic-round-01", "buy");
  assert.ok(reveal);
  return { ok: true, reveal } as const;
}

test("runtime parser accepts complete success and every typed error shape", () => {
  assert.deepEqual(parseGuessApiResponse(validSuccess()), validSuccess());
  for (const code of ["invalid-request", "invalid-round-id", "invalid-guess"] as const) {
    const value = { ok: false, error: { code, message: "Safe error" } };
    assert.deepEqual(parseGuessApiResponse(value), value);
  }
});

test("runtime parser rejects malformed or semantically contradictory 200 bodies", () => {
  const valid = validSuccess();
  const malformed: unknown[] = [
    null,
    {},
    { ok: true },
    { ...valid, extra: true },
    { ok: true, reveal: { ...valid.reveal, roundId: "" } },
    { ok: true, reveal: { ...valid.reveal, guess: "hold" } },
    { ok: true, reveal: { ...valid.reveal, recordedAction: "Hold" } },
    { ok: true, reveal: { ...valid.reveal, correct: false } },
    { ok: true, reveal: { ...valid.reveal, points: 0 } },
    { ok: true, reveal: { ...valid.reveal, sizeBand: null } },
    { ok: true, reveal: { ...valid.reveal, source: "Nansen data" } },
    { ok: true, reveal: { ...valid.reveal, explanation: "" } },
    { ok: false, error: { code: "unknown", message: "No" } },
    { ok: false, error: { code: "invalid-request", message: "", extra: true } },
  ];
  for (const value of malformed) assert.equal(parseGuessApiResponse(value), null);
});

test("synchronous gate blocks rapid duplicate activation and reopens after completion", () => {
  const gate = createSubmissionGate();
  const first = beginSubmission(gate);
  assert.ok(first);
  assert.equal(beginSubmission(gate), null);
  assert.equal(isSubmissionCurrent(gate, first), true);
  assert.equal(finishSubmission(gate, first), true);
  assert.ok(beginSubmission(gate));
});

test("invalidating a round makes late responses stale without clearing a newer request", () => {
  const gate = createSubmissionGate();
  const oldRequest = beginSubmission(gate);
  assert.ok(oldRequest);
  invalidateSubmissions(gate);
  assert.equal(isSubmissionCurrent(gate, oldRequest), false);

  const newRequest = beginSubmission(gate);
  assert.ok(newRequest);
  assert.equal(finishSubmission(gate, oldRequest), false);
  assert.equal(isSubmissionCurrent(gate, newRequest), true);
  assert.equal(finishSubmission(gate, newRequest), true);
});

test("a malformed response leaves score unchanged and allows a retry", () => {
  const gate = createSubmissionGate();
  const request = beginSubmission(gate);
  assert.ok(request);
  let score = 2;
  const parsed = parseGuessApiResponse({ ok: true, reveal: { points: 1 } });
  if (parsed?.ok) score += parsed.reveal.points;
  assert.equal(score, 2);
  assert.equal(finishSubmission(gate, request), true);
  assert.ok(beginSubmission(gate));
});
