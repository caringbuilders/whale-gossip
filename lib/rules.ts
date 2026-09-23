/**
 * Pure deterministic round rules.
 *
 * `NormalizedTradeEvent` is a provisional internal contract. It is not a
 * representation of a verified Nansen response. A future acquisition adapter
 * must validate provider semantics and normalize every event before calling
 * this module. See `docs/rules.md` for the adapter guarantees.
 */

export const RULES_VERSION = "3";
export const ETHEREUM_CHAIN = "ethereum";
export const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
export const ANSWER_WINDOW_MS = 48 * 60 * 60 * 1_000;
export const VISIBLE_TRADE_MIN_USD = 500;
export const MATERIAL_TRADE_MIN_USD = 2_500;
export const ADMISSION_TRADE_MIN_USD = 25_000;
export const VISIBLE_TAPE_LENGTH = 5;

const ETHEREUM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ETHEREUM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

export type TradeAction = "buy" | "sell";
export type Guess = TradeAction | "no-trade";

/**
 * Provisional normalized event. `eventId` identifies one transaction leg.
 * Repeated records with the same ID and identical normalized fields are
 * duplicates; different IDs remain distinct even when a transaction hash is
 * shared.
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

type InvalidEventField =
  | "event"
  | "eventId"
  | "chain"
  | "token"
  | "wallet"
  | "transactionHash"
  | "occurredAtMs"
  | "action"
  | "usdValue";

const EVENT_FIELD_ORDER: readonly InvalidEventField[] = [
  "event",
  "eventId",
  "chain",
  "token",
  "wallet",
  "transactionHash",
  "occurredAtMs",
  "action",
  "usdValue",
];

export type UnscorableReason =
  | {
      readonly code: "malformed-input";
      readonly field: "input" | "chain" | "featuredToken" | "wallet" | "cutoffMs" | "events";
    }
  | { readonly code: "unsupported-chain"; readonly chain: string }
  | { readonly code: "invalid-ethereum-address"; readonly field: "featuredToken" | "wallet" }
  | {
      readonly code: "coverage-invalid";
      readonly segment: "root" | "lookback" | "answer-window";
      readonly detail: "missing" | "malformed" | "unknown-status" | "contradictory";
    }
  | {
      readonly code: "coverage-incomplete";
      readonly segment: "lookback" | "answer-window";
      readonly detail: CoverageFailure | "range-mismatch";
    }
  | { readonly code: "invalid-event"; readonly eventId: string; readonly field: InvalidEventField }
  | { readonly code: "invalid-usd-value"; readonly eventId: string }
  | { readonly code: "conflicting-duplicate"; readonly eventId: string }
  | { readonly code: "insufficient-visible-tape"; readonly found: number; readonly required: number }
  | { readonly code: "admission-not-met" }
  | { readonly code: "ambiguous-potentially-material-transaction"; readonly transactionHash: string }
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

/**
 * A scorable compilation is private internal data. It includes wallet identity,
 * source identifiers, the answer, and outcome evidence and must never be used
 * directly as a public question payload.
 */
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

type JsonRecord = Record<string, unknown>;
type CompleteCoverage = Extract<SegmentCoverage, { status: "complete" }>;

interface EventValidationFailure {
  readonly reason: Extract<UnscorableReason, { code: "invalid-event" }>;
  readonly key: string;
}

interface ParsedCoverage {
  readonly coverage?: CompleteCoverage;
  readonly failure?: RoundCompilationResult;
}

interface TransactionGroup {
  readonly transactionHash: string;
  readonly events: readonly NormalizedTradeEvent[];
  readonly earliestAtMs: number;
  readonly combinedLegUsdValue: number;
}

function unscorable(reason: UnscorableReason): RoundCompilationResult {
  return { status: "unscorable", reason };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isEthereumAddress(value: string): boolean {
  return ETHEREUM_ADDRESS.test(value);
}

function canonicalAddress(value: string): string {
  return value.toLowerCase();
}

function isEthereumTransactionHash(value: string): boolean {
  return ETHEREUM_TRANSACTION_HASH.test(value);
}

function canonicalTransactionHash(value: string): string {
  return value.toLowerCase();
}

function invalidEvent(eventId: string, field: InvalidEventField): EventValidationFailure {
  const fieldIndex = EVENT_FIELD_ORDER.indexOf(field).toString().padStart(2, "0");
  return {
    reason: { code: "invalid-event", eventId, field },
    key: `${fieldIndex}:${eventId}`,
  };
}

function parseEvent(value: unknown): NormalizedTradeEvent | EventValidationFailure {
  if (!isRecord(value)) return invalidEvent("", "event");

  const candidateId = typeof value.eventId === "string" ? value.eventId : "";
  if (typeof value.eventId !== "string" || value.eventId.trim() === "") return invalidEvent(candidateId, "eventId");
  if (value.chain !== ETHEREUM_CHAIN) return invalidEvent(candidateId, "chain");
  if (typeof value.token !== "string" || !isEthereumAddress(value.token)) return invalidEvent(candidateId, "token");
  if (typeof value.wallet !== "string" || !isEthereumAddress(value.wallet)) return invalidEvent(candidateId, "wallet");
  if (typeof value.transactionHash !== "string" || !isEthereumTransactionHash(value.transactionHash)) {
    return invalidEvent(candidateId, "transactionHash");
  }
  if (!isSafeInteger(value.occurredAtMs)) return invalidEvent(candidateId, "occurredAtMs");
  if (value.action !== "buy" && value.action !== "sell") return invalidEvent(candidateId, "action");
  if (value.usdValue !== null && typeof value.usdValue !== "number") return invalidEvent(candidateId, "usdValue");

  return {
    eventId: value.eventId,
    chain: value.chain,
    token: canonicalAddress(value.token),
    wallet: canonicalAddress(value.wallet),
    transactionHash: canonicalTransactionHash(value.transactionHash),
    occurredAtMs: value.occurredAtMs,
    action: value.action,
    usdValue: value.usdValue,
  };
}

function parseCoverageSegment(value: unknown, segment: "lookback" | "answer-window"): ParsedCoverage {
  if (value === undefined) {
    return { failure: unscorable({ code: "coverage-invalid", segment, detail: "missing" }) };
  }
  if (!isRecord(value)) {
    return { failure: unscorable({ code: "coverage-invalid", segment, detail: "malformed" }) };
  }

  if (value.status === "incomplete") {
    if ("fromMs" in value || "toMsExclusive" in value) {
      return { failure: unscorable({ code: "coverage-invalid", segment, detail: "contradictory" }) };
    }
    if (value.reason !== "missing-pages" && value.reason !== "retrieval-failed") {
      return { failure: unscorable({ code: "coverage-invalid", segment, detail: "malformed" }) };
    }
    return { failure: unscorable({ code: "coverage-incomplete", segment, detail: value.reason }) };
  }

  if (value.status !== "complete") {
    return {
      failure: unscorable({
        code: "coverage-invalid",
        segment,
        detail: value.status === undefined ? "malformed" : "unknown-status",
      }),
    };
  }

  if ("reason" in value) {
    return { failure: unscorable({ code: "coverage-invalid", segment, detail: "contradictory" }) };
  }
  if (!isSafeInteger(value.fromMs) || !isSafeInteger(value.toMsExclusive)) {
    return { failure: unscorable({ code: "coverage-invalid", segment, detail: "malformed" }) };
  }
  if (value.fromMs >= value.toMsExclusive) {
    return { failure: unscorable({ code: "coverage-invalid", segment, detail: "contradictory" }) };
  }

  return { coverage: { status: "complete", fromMs: value.fromMs, toMsExclusive: value.toMsExclusive } };
}

function validateCoverageRange(
  coverage: CompleteCoverage,
  segment: "lookback" | "answer-window",
  requiredFromMs: number,
  requiredToMsExclusive: number,
): RoundCompilationResult | null {
  if (coverage.fromMs > requiredFromMs || coverage.toMsExclusive < requiredToMsExclusive) {
    return unscorable({ code: "coverage-incomplete", segment, detail: "range-mismatch" });
  }
  return null;
}

function numberSignature(value: number | null): string {
  if (value === null) return "null";
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "+infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function eventSignature(event: NormalizedTradeEvent): string {
  return [
    event.eventId,
    event.chain,
    event.token,
    event.wallet,
    event.transactionHash,
    String(event.occurredAtMs),
    event.action,
    numberSignature(event.usdValue),
  ].join("\u0000");
}

function byTimeThenId(left: NormalizedTradeEvent, right: NormalizedTradeEvent): number {
  const timeOrder = left.occurredAtMs - right.occurredAtMs;
  if (timeOrder !== 0) return timeOrder;
  if (left.eventId < right.eventId) return -1;
  if (left.eventId > right.eventId) return 1;
  const leftSignature = eventSignature(left);
  const rightSignature = eventSignature(right);
  if (leftSignature < rightSignature) return -1;
  if (leftSignature > rightSignature) return 1;
  return 0;
}

function deduplicateMatchingEvents(
  events: readonly NormalizedTradeEvent[],
): { readonly events?: readonly NormalizedTradeEvent[]; readonly failure?: RoundCompilationResult } {
  const eventsById = new Map<string, NormalizedTradeEvent[]>();
  for (const event of events) {
    const group = eventsById.get(event.eventId);
    if (group) group.push(event);
    else eventsById.set(event.eventId, [event]);
  }

  const deduplicated: NormalizedTradeEvent[] = [];
  for (const eventId of [...eventsById.keys()].sort()) {
    const group = eventsById.get(eventId) as NormalizedTradeEvent[];
    if (new Set(group.map(eventSignature)).size > 1) {
      return { failure: unscorable({ code: "conflicting-duplicate", eventId }) };
    }
    deduplicated.push([...group].sort(byTimeThenId)[0]);
  }

  return { events: deduplicated.sort(byTimeThenId) };
}

function groupAnswerTransactions(events: readonly NormalizedTradeEvent[]): readonly TransactionGroup[] {
  const byTransaction = new Map<string, NormalizedTradeEvent[]>();
  for (const event of events) {
    const group = byTransaction.get(event.transactionHash);
    if (group) group.push(event);
    else byTransaction.set(event.transactionHash, [event]);
  }

  return [...byTransaction.entries()]
    .map(([transactionHash, transactionEvents]) => {
      const sorted = [...transactionEvents].sort(byTimeThenId);
      return {
        transactionHash,
        events: sorted,
        earliestAtMs: sorted[0].occurredAtMs,
        combinedLegUsdValue: sorted.reduce((total, event) => total + (event.usdValue as number), 0),
      };
    })
    .sort((left, right) => {
      const timeOrder = left.earliestAtMs - right.earliestAtMs;
      if (timeOrder !== 0) return timeOrder;
      return left.transactionHash < right.transactionHash ? -1 : left.transactionHash > right.transactionHash ? 1 : 0;
    });
}

function toVisibleTrade(event: NormalizedTradeEvent): VisibleTrade {
  return {
    eventId: event.eventId,
    occurredAtMs: event.occurredAtMs,
    action: event.action,
    usdValue: event.usdValue as number,
    transactionHash: event.transactionHash,
  };
}

export function compileRound(input: unknown): RoundCompilationResult {
  if (!isRecord(input)) return unscorable({ code: "malformed-input", field: "input" });
  if (typeof input.chain !== "string") return unscorable({ code: "malformed-input", field: "chain" });
  if (input.chain !== ETHEREUM_CHAIN) return unscorable({ code: "unsupported-chain", chain: input.chain });
  if (typeof input.featuredToken !== "string") {
    return unscorable({ code: "malformed-input", field: "featuredToken" });
  }
  if (!isEthereumAddress(input.featuredToken)) {
    return unscorable({ code: "invalid-ethereum-address", field: "featuredToken" });
  }
  if (typeof input.wallet !== "string") return unscorable({ code: "malformed-input", field: "wallet" });
  if (!isEthereumAddress(input.wallet)) return unscorable({ code: "invalid-ethereum-address", field: "wallet" });
  if (!isSafeInteger(input.cutoffMs)) return unscorable({ code: "malformed-input", field: "cutoffMs" });
  if (!Array.isArray(input.events)) return unscorable({ code: "malformed-input", field: "events" });

  const cutoffMs = input.cutoffMs;
  const lookbackStartMs = cutoffMs - LOOKBACK_MS;
  const answerWindowEndMs = cutoffMs + ANSWER_WINDOW_MS;
  if (!Number.isSafeInteger(lookbackStartMs) || !Number.isSafeInteger(answerWindowEndMs)) {
    return unscorable({ code: "malformed-input", field: "cutoffMs" });
  }

  if (input.coverage === undefined) {
    return unscorable({ code: "coverage-invalid", segment: "root", detail: "missing" });
  }
  if (!isRecord(input.coverage)) {
    return unscorable({ code: "coverage-invalid", segment: "root", detail: "malformed" });
  }

  const lookbackCoverage = parseCoverageSegment(input.coverage.lookback, "lookback");
  if (lookbackCoverage.failure) return lookbackCoverage.failure;
  const answerCoverage = parseCoverageSegment(input.coverage.answerWindow, "answer-window");
  if (answerCoverage.failure) return answerCoverage.failure;
  if (!isSafeInteger(input.coverage.observedAtMs)) {
    return unscorable({ code: "coverage-invalid", segment: "root", detail: "malformed" });
  }

  const observedAtMs = input.coverage.observedAtMs;
  if ((lookbackCoverage.coverage as CompleteCoverage).toMsExclusive > observedAtMs) {
    return unscorable({ code: "coverage-invalid", segment: "lookback", detail: "contradictory" });
  }
  if ((answerCoverage.coverage as CompleteCoverage).toMsExclusive > observedAtMs) {
    return unscorable({ code: "coverage-invalid", segment: "answer-window", detail: "contradictory" });
  }

  const lookbackRangeFailure = validateCoverageRange(
    lookbackCoverage.coverage as CompleteCoverage,
    "lookback",
    lookbackStartMs,
    cutoffMs,
  );
  if (lookbackRangeFailure) return lookbackRangeFailure;
  const answerRangeFailure = validateCoverageRange(
    answerCoverage.coverage as CompleteCoverage,
    "answer-window",
    cutoffMs,
    answerWindowEndMs,
  );
  if (answerRangeFailure) return answerRangeFailure;
  const parsedEvents: NormalizedTradeEvent[] = [];
  const eventFailures: EventValidationFailure[] = [];
  for (const value of input.events) {
    const parsed = parseEvent(value);
    if ("reason" in parsed) eventFailures.push(parsed);
    else parsedEvents.push(parsed);
  }
  if (eventFailures.length > 0) {
    eventFailures.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    return unscorable(eventFailures[0].reason);
  }

  const featuredToken = canonicalAddress(input.featuredToken);
  const wallet = canonicalAddress(input.wallet);
  const matchingEvents = parsedEvents.filter(
    (event) => event.chain === ETHEREUM_CHAIN && event.token === featuredToken && event.wallet === wallet,
  );

  // Conflicts are checked across all matching events before time filtering.
  const deduplication = deduplicateMatchingEvents(matchingEvents);
  if (deduplication.failure) return deduplication.failure;
  const deduplicated = deduplication.events as readonly NormalizedTradeEvent[];

  const relevantEvents = deduplicated.filter(
    (event) => event.occurredAtMs >= lookbackStartMs && event.occurredAtMs < answerWindowEndMs,
  );
  const invalidValueEvents = relevantEvents
    .filter((event) => event.usdValue === null || !Number.isFinite(event.usdValue) || (event.usdValue as number) < 0)
    .sort(byTimeThenId);
  if (invalidValueEvents.length > 0) {
    return unscorable({ code: "invalid-usd-value", eventId: invalidValueEvents[0].eventId });
  }

  const lookbackEvents = relevantEvents.filter((event) => event.occurredAtMs < cutoffMs).sort(byTimeThenId);
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

  const visibleTape = qualifyingTape.slice(-VISIBLE_TAPE_LENGTH).map(toVisibleTrade);
  const answerEvents = relevantEvents.filter((event) => event.occurredAtMs >= cutoffMs).sort(byTimeThenId);
  const materialEvents = answerEvents.filter((event) => (event.usdValue as number) >= MATERIAL_TRADE_MIN_USD);
  const potentiallyMaterialAmbiguities = groupAnswerTransactions(answerEvents).filter(
    (transaction) => transaction.events.length > 1 && transaction.combinedLegUsdValue >= MATERIAL_TRADE_MIN_USD,
  );

  const firstMaterialEvent = materialEvents[0];
  const blockingAmbiguity = potentiallyMaterialAmbiguities.find(
    (transaction) => firstMaterialEvent === undefined || transaction.earliestAtMs <= firstMaterialEvent.occurredAtMs,
  );
  if (blockingAmbiguity) {
    return unscorable({
      code: "ambiguous-potentially-material-transaction",
      transactionHash: blockingAmbiguity.transactionHash,
    });
  }

  if (!firstMaterialEvent) {
    return {
      status: "scorable",
      rulesVersion: RULES_VERSION,
      chain: ETHEREUM_CHAIN,
      featuredToken,
      wallet,
      cutoffMs,
      lookbackStartMs,
      answerWindowEndMs,
      visibleTape,
      answer: { action: "no-trade" },
    };
  }

  if (materialEvents.some((event, index) => index > 0 && event.occurredAtMs === firstMaterialEvent.occurredAtMs)) {
    return unscorable({ code: "tied-first-events", occurredAtMs: firstMaterialEvent.occurredAtMs });
  }

  return {
    status: "scorable",
    rulesVersion: RULES_VERSION,
    chain: ETHEREUM_CHAIN,
    featuredToken,
    wallet,
    cutoffMs,
    lookbackStartMs,
    answerWindowEndMs,
    visibleTape,
    answer: {
      action: firstMaterialEvent.action,
      eventId: firstMaterialEvent.eventId,
      occurredAtMs: firstMaterialEvent.occurredAtMs,
      usdValue: firstMaterialEvent.usdValue as number,
      transactionHash: firstMaterialEvent.transactionHash,
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
