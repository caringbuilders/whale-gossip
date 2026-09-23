/**
 * Pure deterministic round rules.
 *
 * `NormalizedTradeEvent` is a provisional internal contract. It is not a
 * representation of a verified Nansen response. A future acquisition adapter
 * must validate provider semantics and normalize every event before calling
 * this module. See `docs/rules.md` for the adapter guarantees.
 */

export const RULES_VERSION = "1";
export const ETHEREUM_CHAIN = "ethereum";
export const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
export const ANSWER_WINDOW_MS = 48 * 60 * 60 * 1_000;
export const VISIBLE_TRADE_MIN_USD = 500;
export const MATERIAL_TRADE_MIN_USD = 2_500;
export const ADMISSION_TRADE_MIN_USD = 25_000;
export const VISIBLE_TAPE_LENGTH = 5;

export type TradeAction = "buy" | "sell";
export type Guess = TradeAction | "no-trade";

/**
 * Provisional normalized event. `eventId` identifies one transaction leg.
 * Repeated records with the same ID and identical fields are duplicates;
 * records with different IDs remain distinct even when they share a
 * transaction hash.
 */
export interface NormalizedTradeEvent {
  readonly eventId: string;
  readonly chain: string;
  readonly token: string;
  readonly wallet: string;
  readonly transactionHash: string;
  readonly occurredAtMs: number;
  readonly action: TradeAction;
  readonly usdValue: number | null;
}

export type CoverageFailure = "missing-pages" | "retrieval-failed";

export type SegmentCoverage =
  | {
      readonly status: "complete";
      readonly fromMs: number;
      readonly toMsExclusive: number;
    }
  | {
      readonly status: "incomplete";
      readonly reason: CoverageFailure;
    };

/**
 * Coverage evidence is mandatory. An event array cannot prove an empty range
 * or complete pagination, so compilation never infers coverage from events.
 */
export interface CoverageEvidence {
  readonly lookback: SegmentCoverage;
  readonly answerWindow: SegmentCoverage;
  readonly observedAtMs: number;
}

export interface RoundCompilationInput {
  readonly chain: string;
  readonly featuredToken: string;
  readonly wallet: string;
  readonly cutoffMs: number;
  readonly events: readonly NormalizedTradeEvent[];
  readonly coverage: CoverageEvidence;
}

export type UnscorableReason =
  | { readonly code: "unsupported-chain"; readonly chain: string }
  | { readonly code: "invalid-round-input"; readonly field: "featuredToken" | "wallet" | "cutoffMs" }
  | {
      readonly code: "coverage-incomplete";
      readonly segment: "lookback" | "answer-window";
      readonly detail: CoverageFailure | "range-mismatch";
    }
  | { readonly code: "answer-window-unfinished" }
  | { readonly code: "invalid-event"; readonly eventId: string; readonly field: "eventId" | "transactionHash" | "occurredAtMs" | "action" }
  | { readonly code: "invalid-usd-value"; readonly eventId: string }
  | { readonly code: "conflicting-duplicate"; readonly eventId: string }
  | { readonly code: "insufficient-visible-tape"; readonly found: number; readonly required: number }
  | { readonly code: "admission-not-met" }
  | { readonly code: "ambiguous-multi-leg-first-event"; readonly transactionHash: string }
  | { readonly code: "tied-first-events"; readonly occurredAtMs: number };

export interface VisibleTrade {
  readonly eventId: string;
  readonly occurredAtMs: number;
  readonly action: TradeAction;
  readonly usdValue: number;
  readonly transactionHash: string;
}

export type RoundAnswer =
  | {
      readonly action: TradeAction;
      readonly eventId: string;
      readonly occurredAtMs: number;
      readonly usdValue: number;
      readonly transactionHash: string;
    }
  | { readonly action: "no-trade" };

export type RoundCompilationResult =
  | {
      readonly status: "scorable";
      readonly rulesVersion: typeof RULES_VERSION;
      readonly chain: typeof ETHEREUM_CHAIN;
      readonly featuredToken: string;
      readonly wallet: string;
      readonly cutoffMs: number;
      readonly lookbackStartMs: number;
      readonly answerWindowEndMs: number;
      readonly visibleTape: readonly VisibleTrade[];
      readonly answer: RoundAnswer;
    }
  | { readonly status: "unscorable"; readonly reason: UnscorableReason };

export type ScoreResult =
  | { readonly status: "scored"; readonly guess: Guess; readonly correct: boolean; readonly points: 0 | 1 }
  | { readonly status: "invalid-guess"; readonly reason: "invalid-guess" };

function unscorable(reason: UnscorableReason): RoundCompilationResult {
  return { status: "unscorable", reason };
}

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function validateCoverage(
  coverage: SegmentCoverage,
  segment: "lookback" | "answer-window",
  requiredFromMs: number,
  requiredToMsExclusive: number,
): RoundCompilationResult | null {
  if (coverage.status === "incomplete") {
    return unscorable({ code: "coverage-incomplete", segment, detail: coverage.reason });
  }

  if (
    !isFiniteInteger(coverage.fromMs) ||
    !isFiniteInteger(coverage.toMsExclusive) ||
    coverage.fromMs > requiredFromMs ||
    coverage.toMsExclusive < requiredToMsExclusive
  ) {
    return unscorable({ code: "coverage-incomplete", segment, detail: "range-mismatch" });
  }

  return null;
}

function sameEvent(left: NormalizedTradeEvent, right: NormalizedTradeEvent): boolean {
  return (
    left.eventId === right.eventId &&
    left.chain === right.chain &&
    left.token === right.token &&
    left.wallet === right.wallet &&
    left.transactionHash === right.transactionHash &&
    left.occurredAtMs === right.occurredAtMs &&
    left.action === right.action &&
    Object.is(left.usdValue, right.usdValue)
  );
}

function byTimeThenId(left: NormalizedTradeEvent, right: NormalizedTradeEvent): number {
  const timeOrder = left.occurredAtMs - right.occurredAtMs;
  if (timeOrder !== 0) return timeOrder;
  if (left.eventId < right.eventId) return -1;
  if (left.eventId > right.eventId) return 1;
  return 0;
}

function toVisibleTrade(event: NormalizedTradeEvent & { usdValue: number }): VisibleTrade {
  return {
    eventId: event.eventId,
    occurredAtMs: event.occurredAtMs,
    action: event.action,
    usdValue: event.usdValue,
    transactionHash: event.transactionHash,
  };
}

export function compileRound(input: RoundCompilationInput): RoundCompilationResult {
  if (input.chain !== ETHEREUM_CHAIN) {
    return unscorable({ code: "unsupported-chain", chain: input.chain });
  }
  if (input.featuredToken.trim() === "") {
    return unscorable({ code: "invalid-round-input", field: "featuredToken" });
  }
  if (input.wallet.trim() === "") {
    return unscorable({ code: "invalid-round-input", field: "wallet" });
  }
  if (!isFiniteInteger(input.cutoffMs)) {
    return unscorable({ code: "invalid-round-input", field: "cutoffMs" });
  }

  const lookbackStartMs = input.cutoffMs - LOOKBACK_MS;
  const answerWindowEndMs = input.cutoffMs + ANSWER_WINDOW_MS;

  const lookbackCoverageFailure = validateCoverage(input.coverage.lookback, "lookback", lookbackStartMs, input.cutoffMs);
  if (lookbackCoverageFailure) return lookbackCoverageFailure;

  const answerCoverageFailure = validateCoverage(
    input.coverage.answerWindow,
    "answer-window",
    input.cutoffMs,
    answerWindowEndMs,
  );
  if (answerCoverageFailure) return answerCoverageFailure;

  if (!isFiniteInteger(input.coverage.observedAtMs) || input.coverage.observedAtMs < answerWindowEndMs) {
    return unscorable({ code: "answer-window-unfinished" });
  }

  const matchingEvents = input.events.filter(
    (event) => event.chain === input.chain && event.token === input.featuredToken && event.wallet === input.wallet,
  );
  const relevantEvents: NormalizedTradeEvent[] = [];

  for (const event of matchingEvents) {
    if (!isFiniteInteger(event.occurredAtMs)) {
      return unscorable({ code: "invalid-event", eventId: event.eventId, field: "occurredAtMs" });
    }

    const isRelevant = event.occurredAtMs >= lookbackStartMs && event.occurredAtMs < answerWindowEndMs;
    if (!isRelevant) continue;

    if (event.eventId.trim() === "") {
      return unscorable({ code: "invalid-event", eventId: event.eventId, field: "eventId" });
    }
    if (event.transactionHash.trim() === "") {
      return unscorable({ code: "invalid-event", eventId: event.eventId, field: "transactionHash" });
    }
    if (event.action !== "buy" && event.action !== "sell") {
      return unscorable({ code: "invalid-event", eventId: event.eventId, field: "action" });
    }
    if (event.usdValue === null || !Number.isFinite(event.usdValue) || event.usdValue < 0) {
      return unscorable({ code: "invalid-usd-value", eventId: event.eventId });
    }

    relevantEvents.push(event);
  }

  const eventsById = new Map<string, NormalizedTradeEvent>();
  for (const event of relevantEvents) {
    const previous = eventsById.get(event.eventId);
    if (previous && !sameEvent(previous, event)) {
      return unscorable({ code: "conflicting-duplicate", eventId: event.eventId });
    }
    if (!previous) eventsById.set(event.eventId, event);
  }

  const deduplicated = [...eventsById.values()];
  const lookbackEvents = deduplicated
    .filter((event) => event.occurredAtMs >= lookbackStartMs && event.occurredAtMs < input.cutoffMs)
    .sort(byTimeThenId);

  const qualifyingTape = lookbackEvents.filter((event) => (event.usdValue as number) >= VISIBLE_TRADE_MIN_USD);
  if (qualifyingTape.length < VISIBLE_TAPE_LENGTH) {
    return unscorable({
      code: "insufficient-visible-tape",
      found: qualifyingTape.length,
      required: VISIBLE_TAPE_LENGTH,
    });
  }

  if (!lookbackEvents.some((event) => (event.usdValue as number) >= ADMISSION_TRADE_MIN_USD)) {
    return unscorable({ code: "admission-not-met" });
  }

  const visibleTape = qualifyingTape
    .slice(-VISIBLE_TAPE_LENGTH)
    .map((event) => toVisibleTrade(event as NormalizedTradeEvent & { usdValue: number }));

  const materialEvents = deduplicated
    .filter(
      (event) =>
        event.occurredAtMs >= input.cutoffMs &&
        event.occurredAtMs < answerWindowEndMs &&
        (event.usdValue as number) >= MATERIAL_TRADE_MIN_USD,
    )
    .sort(byTimeThenId);

  if (materialEvents.length === 0) {
    return {
      status: "scorable",
      rulesVersion: RULES_VERSION,
      chain: ETHEREUM_CHAIN,
      featuredToken: input.featuredToken,
      wallet: input.wallet,
      cutoffMs: input.cutoffMs,
      lookbackStartMs,
      answerWindowEndMs,
      visibleTape,
      answer: { action: "no-trade" },
    };
  }

  const first = materialEvents[0];
  const sameTransaction = materialEvents.filter((event) => event.transactionHash === first.transactionHash);
  if (sameTransaction.length > 1) {
    return unscorable({
      code: "ambiguous-multi-leg-first-event",
      transactionHash: first.transactionHash,
    });
  }

  if (materialEvents.some((event, index) => index > 0 && event.occurredAtMs === first.occurredAtMs)) {
    return unscorable({ code: "tied-first-events", occurredAtMs: first.occurredAtMs });
  }

  return {
    status: "scorable",
    rulesVersion: RULES_VERSION,
    chain: ETHEREUM_CHAIN,
    featuredToken: input.featuredToken,
    wallet: input.wallet,
    cutoffMs: input.cutoffMs,
    lookbackStartMs,
    answerWindowEndMs,
    visibleTape,
    answer: {
      action: first.action,
      eventId: first.eventId,
      occurredAtMs: first.occurredAtMs,
      usdValue: first.usdValue as number,
      transactionHash: first.transactionHash,
    },
  };
}

export function scoreGuess(answer: RoundAnswer, guess: unknown): ScoreResult {
  if (guess !== "buy" && guess !== "sell" && guess !== "no-trade") {
    return { status: "invalid-guess", reason: "invalid-guess" };
  }

  const correct = answer.action === guess;
  return { status: "scored", guess, correct, points: correct ? 1 : 0 };
}
