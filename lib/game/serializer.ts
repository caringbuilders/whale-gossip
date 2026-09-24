import {
  ANSWER_WINDOW_MS,
  scoreGuess,
  type Guess,
  type RoundCompilationResult,
} from "../rules";
import {
  displayAction,
  type PublicQuestion,
  type PublicReveal,
} from "./public-types";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export type ScorableRound = Extract<RoundCompilationResult, { status: "scorable" }>;

export interface PrivateCompiledRound {
  readonly roundId: string;
  readonly tokenDisplay: { readonly symbol: string; readonly name: string };
  readonly walletPseudonym: string;
  readonly privateSentinel: string;
  readonly compilation: ScorableRound;
}

export function formatPublicSizeBand(usdValue: number): string {
  if (usdValue < 1_000) return "$500–$999";
  if (usdValue < 5_000) return "$1k–$4.9k";
  if (usdValue < 25_000) return "$5k–$24.9k";
  if (usdValue < 100_000) return "$25k–$99k";
  return "$100k+";
}

export function formatRelativeBeforeCutoff(cutoffMs: number, occurredAtMs: number): string {
  const elapsedMs = cutoffMs - occurredAtMs;
  if (elapsedMs % DAY_MS === 0) {
    const days = elapsedMs / DAY_MS;
    return `${days} day${days === 1 ? "" : "s"} before cutoff`;
  }

  const hours = Math.floor(elapsedMs / HOUR_MS);
  return `${hours} hour${hours === 1 ? "" : "s"} before cutoff`;
}

export function formatRelativeAfterCutoff(cutoffMs: number, occurredAtMs: number): string {
  const elapsedMs = occurredAtMs - cutoffMs;
  if (elapsedMs === 0) return "At the cutoff";
  if (elapsedMs % DAY_MS === 0) {
    const days = elapsedMs / DAY_MS;
    return `${days} day${days === 1 ? "" : "s"} after cutoff`;
  }

  const hours = Math.floor(elapsedMs / HOUR_MS);
  return `${hours} hour${hours === 1 ? "" : "s"} after cutoff`;
}

/** Allowlist serializer for the question payload sent to the browser. */
export function serializeQuestion(round: PrivateCompiledRound, roundNumber: number): PublicQuestion {
  return {
    roundId: round.roundId,
    roundNumber,
    token: round.tokenDisplay,
    walletPseudonym: round.walletPseudonym,
    prompt: "What was this wallet’s first material move in the next 48 hours?",
    visibleTape: round.compilation.visibleTape.map((trade, index) => ({
      position: index + 1,
      relativeTime: formatRelativeBeforeCutoff(round.compilation.cutoffMs, trade.occurredAtMs),
      action: displayAction(trade.action),
      sizeBand: formatPublicSizeBand(trade.usdValue),
    })),
    source: "Synthetic offline fixture",
    rulesVersion: round.compilation.rulesVersion,
  };
}

/** Post-guess allowlist serializer. Private identifiers remain omitted. */
export function serializeReveal(round: PrivateCompiledRound, guess: Guess): PublicReveal {
  const scored = scoreGuess(round.compilation.answer, guess);
  if (scored.status !== "scored") throw new Error("A validated guess unexpectedly failed scoring.");

  const answer = round.compilation.answer;
  const noTrade = answer.action === "no-trade";
  return {
    roundId: round.roundId,
    guess,
    recordedAction: displayAction(answer.action),
    correct: scored.correct,
    points: scored.points,
    relativeElapsedTime: noTrade
      ? `No material trade during the fully observed ${ANSWER_WINDOW_MS / HOUR_MS}-hour window`
      : formatRelativeAfterCutoff(round.compilation.cutoffMs, answer.occurredAtMs),
    sizeBand: noTrade ? null : formatPublicSizeBand(answer.usdValue),
    explanation: noTrade
      ? "The synthetic record contains no qualifying trade in the complete answer window."
      : `The first qualifying synthetic action was ${displayAction(answer.action).toLowerCase()}.`,
    source: "Synthetic offline fixture",
  };
}
