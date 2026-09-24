import {
  isGuess,
  type GuessApiResponse,
  type PublicReveal,
} from "./public-types";

type JsonRecord = Record<string, unknown>;

export interface SubmissionGate {
  activeRequestId: number | null;
  nextRequestId: number;
  generation: number;
}

export interface SubmissionToken {
  readonly requestId: number;
  readonly generation: number;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && expected.every((key, index) => actual[index] === key);
}

function isPublicReveal(value: unknown): value is PublicReveal {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, [
    "correct",
    "explanation",
    "guess",
    "points",
    "recordedAction",
    "relativeElapsedTime",
    "roundId",
    "sizeBand",
    "source",
  ])) return false;

  const actionMatchesGuess = (value.recordedAction === "Buy" && value.guess === "buy")
    || (value.recordedAction === "Sell" && value.guess === "sell")
    || (value.recordedAction === "No trade" && value.guess === "no-trade");

  return typeof value.roundId === "string"
    && value.roundId.length > 0
    && isGuess(value.guess)
    && (value.recordedAction === "Buy" || value.recordedAction === "Sell" || value.recordedAction === "No trade")
    && typeof value.correct === "boolean"
    && value.correct === actionMatchesGuess
    && (value.points === 0 || value.points === 1)
    && value.points === (value.correct ? 1 : 0)
    && typeof value.relativeElapsedTime === "string"
    && value.relativeElapsedTime.length > 0
    && (value.recordedAction === "No trade"
      ? value.sizeBand === null
      : typeof value.sizeBand === "string" && value.sizeBand.length > 0)
    && typeof value.explanation === "string"
    && value.explanation.length > 0
    && value.source === "Synthetic offline fixture";
}

export function parseGuessApiResponse(value: unknown): GuessApiResponse | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;

  if (value.ok) {
    if (!hasExactKeys(value, ["ok", "reveal"]) || !isPublicReveal(value.reveal)) return null;
    return { ok: true, reveal: value.reveal };
  }

  if (!hasExactKeys(value, ["error", "ok"]) || !isRecord(value.error)) return null;
  if (!hasExactKeys(value.error, ["code", "message"])) return null;
  if (
    value.error.code !== "invalid-request"
    && value.error.code !== "invalid-round-id"
    && value.error.code !== "invalid-guess"
  ) return null;
  if (typeof value.error.message !== "string" || value.error.message.length === 0) return null;

  return {
    ok: false,
    error: { code: value.error.code, message: value.error.message },
  };
}

export function createSubmissionGate(): SubmissionGate {
  return { activeRequestId: null, nextRequestId: 1, generation: 1 };
}

export function beginSubmission(gate: SubmissionGate): SubmissionToken | null {
  if (gate.activeRequestId !== null) return null;
  const requestId = gate.nextRequestId;
  gate.nextRequestId += 1;
  gate.activeRequestId = requestId;
  return { requestId, generation: gate.generation };
}

export function isSubmissionCurrent(gate: SubmissionGate, token: SubmissionToken): boolean {
  return gate.activeRequestId === token.requestId && gate.generation === token.generation;
}

export function finishSubmission(gate: SubmissionGate, token: SubmissionToken): boolean {
  if (!isSubmissionCurrent(gate, token)) return false;
  gate.activeRequestId = null;
  return true;
}

export function invalidateSubmissions(gate: SubmissionGate): void {
  gate.generation += 1;
  gate.activeRequestId = null;
}
