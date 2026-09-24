/**
 * SERVER-ONLY PRIVATE MODULE.
 *
 * This module contains synthetic wallet/token identifiers, exact values,
 * timestamps, source events, compiled answers, and outcome evidence. Client
 * components must only receive the allowlisted serializer output.
 */
import {
  ANSWER_WINDOW_MS,
  LOOKBACK_MS,
  compileRound,
  type Guess,
  type NormalizedTradeEvent,
  type RoundCompilationInput,
} from "../rules";
import { OFFLINE_GAME_LENGTH, type PublicQuestion, type PublicReveal } from "../game/public-types";
import { serializeQuestion, serializeReveal, type PrivateCompiledRound } from "../game/serializer";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const PUBLIC_ROUND_ORDER = ["synthetic-round-01", "synthetic-round-03", "synthetic-round-05", "synthetic-round-07", "synthetic-round-09"] as const;

interface SyntheticSpec {
  readonly symbol: string;
  readonly name: string;
  readonly pseudonym: string;
  readonly answer: "buy" | "sell" | "no-trade";
  readonly answerOffsetHours?: number;
  readonly answerUsdValue?: number;
  readonly includeAtWindowEnd?: boolean;
}

const SPECS: readonly SyntheticSpec[] = [
  { symbol: "TIDE", name: "Tideglass", pseudonym: "Harbor Whale", answer: "buy", answerOffsetHours: 0, answerUsdValue: 2_500 },
  { symbol: "EMBER", name: "Ember Arcade", pseudonym: "Copper Whale", answer: "sell", answerOffsetHours: 11, answerUsdValue: 6_700 },
  { symbol: "MOSS", name: "Moss Circuit", pseudonym: "Fern Whale", answer: "no-trade" },
  { symbol: "LUMA", name: "Luma Harbor", pseudonym: "Beacon Whale", answer: "buy", answerOffsetHours: 47, answerUsdValue: 18_400 },
  { symbol: "PLUME", name: "Plume Works", pseudonym: "Cloud Whale", answer: "sell", answerOffsetHours: 1, answerUsdValue: 104_000 },
  { symbol: "NORI", name: "Nori Signal", pseudonym: "Kelp Whale", answer: "no-trade" },
  { symbol: "QUILL", name: "Quill Relay", pseudonym: "Ink Whale", answer: "buy", answerOffsetHours: 24, answerUsdValue: 3_100 },
  { symbol: "SONAR", name: "Sonar Garden", pseudonym: "Echo Whale", answer: "sell", answerOffsetHours: 2, answerUsdValue: 2_500 },
  { symbol: "VELLUM", name: "Vellum Point", pseudonym: "Paper Whale", answer: "no-trade", includeAtWindowEnd: true },
  { symbol: "WISP", name: "Wisp Foundry", pseudonym: "Lantern Whale", answer: "buy", answerOffsetHours: 9, answerUsdValue: 26_000 },
];

function addressFrom(seed: number): string {
  return `0x${seed.toString(16).padStart(40, "0")}`;
}

function hashFrom(seed: number): string {
  return `0x${seed.toString(16).padStart(64, "0")}`;
}

function event(
  round: number,
  sequence: number,
  token: string,
  wallet: string,
  occurredAtMs: number,
  action: "buy" | "sell",
  usdValue: number,
): NormalizedTradeEvent {
  return {
    eventId: `PRIVATE_EVENT_SENTINEL_R${round}_E${sequence}`,
    chain: "ethereum",
    token,
    wallet,
    transactionHash: hashFrom(round * 100 + sequence),
    occurredAtMs,
    action,
    usdValue,
  };
}

function makeInput(spec: SyntheticSpec, index: number): RoundCompilationInput {
  const round = index + 1;
  const cutoffMs = Date.UTC(2025, index, 10 + index, 12, 0, 0, 0);
  const token = addressFrom(1_000 + round);
  const wallet = addressFrom(2_000 + round);
  const tapeOffsets = [-120, -72, -36, -12, -2];
  const tapeValues = [650 + index * 17, 1_400 + index * 41, 6_200 + index * 83, 27_000 + index * 107, 3_600 + index * 59];
  const events: NormalizedTradeEvent[] = [
    event(round, 1, token, wallet, cutoffMs - 20 * DAY_MS, "buy", 31_000 + index * 500),
    ...tapeOffsets.map((offset, tapeIndex) =>
      event(
        round,
        tapeIndex + 2,
        token,
        wallet,
        cutoffMs + offset * HOUR_MS,
        (tapeIndex + index) % 2 === 0 ? "buy" : "sell",
        tapeValues[tapeIndex],
      ),
    ),
  ];

  if (spec.answer === "no-trade") {
    events.push(event(round, 7, token, wallet, cutoffMs + 6 * HOUR_MS, "buy", 0));
    events.push(event(round, 8, token, wallet, cutoffMs + 30 * HOUR_MS, "sell", 2_499));
  } else {
    events.push(
      event(
        round,
        7,
        token,
        wallet,
        cutoffMs + (spec.answerOffsetHours as number) * HOUR_MS,
        spec.answer,
        spec.answerUsdValue as number,
      ),
    );
  }

  if (spec.includeAtWindowEnd) {
    events.push(event(round, 9, token, wallet, cutoffMs + ANSWER_WINDOW_MS, "sell", 90_000));
  }

  return {
    chain: "ethereum",
    featuredToken: token,
    wallet,
    cutoffMs,
    // Deliberately unsorted so the deck exercises deterministic compilation.
    events: [...events].reverse(),
    coverage: {
      lookback: { status: "complete", fromMs: cutoffMs - LOOKBACK_MS, toMsExclusive: cutoffMs },
      answerWindow: { status: "complete", fromMs: cutoffMs, toMsExclusive: cutoffMs + ANSWER_WINDOW_MS },
      observedAtMs: cutoffMs + ANSWER_WINDOW_MS,
    },
  };
}

function compileSyntheticRound(spec: SyntheticSpec, index: number): PrivateCompiledRound & { readonly sourceInput: RoundCompilationInput } {
  const sourceInput = makeInput(spec, index);
  const compilation = compileRound(sourceInput);
  if (compilation.status !== "scorable") {
    throw new Error(`Synthetic round ${index + 1} is not scorable: ${compilation.reason.code}`);
  }
  if (compilation.answer.action !== spec.answer) {
    throw new Error(`Synthetic round ${index + 1} compiled to an unexpected answer.`);
  }

  return {
    roundId: `synthetic-round-${String(index + 1).padStart(2, "0")}`,
    tokenDisplay: { symbol: spec.symbol, name: spec.name },
    walletPseudonym: spec.pseudonym,
    privateSentinel: `PRIVATE_ROUND_SENTINEL_${index + 1}`,
    compilation,
    sourceInput,
  };
}

export const PRIVATE_SYNTHETIC_ROUNDS = SPECS.map(compileSyntheticRound);

function selectedRounds(): readonly (typeof PRIVATE_SYNTHETIC_ROUNDS)[number][] {
  const byId = new Map(PRIVATE_SYNTHETIC_ROUNDS.map((round) => [round.roundId, round]));
  return PUBLIC_ROUND_ORDER.map((roundId) => {
    const round = byId.get(roundId);
    if (!round) throw new Error(`Missing configured synthetic round: ${roundId}`);
    return round;
  });
}

export function getPublicOfflineGame(): readonly PublicQuestion[] {
  const rounds = selectedRounds();
  if (rounds.length !== OFFLINE_GAME_LENGTH) throw new Error("Offline game must contain exactly five rounds.");
  return rounds.map((round, index) => serializeQuestion(round, index + 1));
}

export function getSyntheticReveal(roundId: string, guess: Guess): PublicReveal | null {
  const round = selectedRounds().find((candidate) => candidate.roundId === roundId);
  return round ? serializeReveal(round, guess) : null;
}
