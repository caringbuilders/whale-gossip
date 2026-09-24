import "server-only";

import { createHash } from "node:crypto";

import {
  ADMISSION_TRADE_MIN_USD,
  ANSWER_WINDOW_MS,
  ETHEREUM_CHAIN,
  LOOKBACK_MS,
  RULES_VERSION,
  compileRound,
  type NormalizedTradeEvent,
  type RoundCompilationResult,
} from "../rules";
import { NANSEN_DEX_TRADES_ENDPOINT, PROBE_TOKEN_ADDRESS } from "./nansen-contract";

export { NANSEN_DEX_TRADES_ENDPOINT };

export const ACQUISITION_ADAPTER_VERSION = "1";
export const ACQUISITION_SCHEMA_VERSION = 1;
export const ACQUISITION_PER_PAGE = 100;
export const ACQUISITION_MAX_ATTEMPTS = 130;
export const ACQUISITION_MAX_RETAINED_CREDITS = 130;
export const ACQUISITION_EXPECTED_CREDIT_COST = 1;
export const CONTRACT_SPIKE_SUCCESSES = 3;
export const INTERNAL_TOTAL_SUCCESS_TARGET = 120;
export const MAX_ACQUISITION_SUCCESSES = 117;
export const DISCOVERY_WINDOW_MS = 10 * 24 * 60 * 60 * 1_000;
export const PROVIDER_BOUNDARY_OVERLAP_MS = 1;

const DAY_MS = 24 * 60 * 60 * 1_000;
const ETHEREUM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ETHEREUM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const EXACT_MILLISECOND_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface AcquisitionToken {
  readonly symbol: string;
  readonly address: string;
  readonly verification: string;
}

export const ACQUISITION_TOKEN_UNIVERSE: readonly AcquisitionToken[] = [
  {
    symbol: "WETH",
    address: PROBE_TOKEN_ADDRESS,
    verification: "Canonical Ethereum WETH9 address already reviewed for the closed contract spike.",
  },
];

export interface AcquisitionRequest {
  readonly chain: "ethereum";
  readonly token_address: string;
  readonly only_smart_money: false;
  readonly date: { readonly from: string; readonly to: string };
  readonly pagination: { readonly page: number; readonly per_page: number };
  readonly order_by: readonly [{ readonly field: "block_timestamp"; readonly direction: "ASC" }];
}

export interface PlannedRequest {
  readonly purpose: "discovery" | "coverage";
  readonly token: AcquisitionToken;
  readonly wallet: string | null;
  readonly cutoffMs: number | null;
  readonly localFromMs: number;
  readonly localToMsExclusive: number;
  readonly request: AcquisitionRequest;
}

export interface ProviderPage {
  readonly requestId: string;
  readonly requestFingerprint: string;
  readonly retrievalTimeMs: number;
  readonly page: number;
  readonly perPage: number;
  readonly isLastPage: boolean;
  readonly rows: readonly Record<string, unknown>[];
}

export type PageParseResult =
  | { readonly status: "valid"; readonly page: ProviderPage }
  | { readonly status: "invalid"; readonly reason: string };

export type NormalizationResult =
  | {
      readonly status: "complete";
      readonly events: readonly NormalizedTradeEvent[];
      readonly rowCount: number;
      readonly exactDuplicateRows: number;
      readonly retrievalTimeMs: number;
      readonly sourceRequestIds: readonly string[];
      readonly sourcePages: readonly {
        readonly requestId: string;
        readonly page: number;
        readonly requestFingerprint: string;
      }[];
    }
  | { readonly status: "rejected"; readonly reason: string };

export interface DiscoveredCandidate {
  readonly candidateId: string;
  readonly token: AcquisitionToken;
  readonly wallet: string;
  readonly proposedCutoffMs: number;
  readonly anchorEventId: string;
}

export interface PrivateCandidateRecord {
  readonly candidateId: string;
  readonly token: AcquisitionToken;
  readonly wallet: string;
  readonly proposedCutoffMs: number;
  readonly sourceRequestIds: readonly string[];
  readonly sourcePages: readonly {
    readonly requestId: string;
    readonly page: number;
    readonly requestFingerprint: string;
  }[];
  readonly retrievalTimeMs: number;
  readonly coverage: {
    readonly lookback: { readonly fromMs: number; readonly toMsExclusive: number; readonly status: "complete" };
    readonly answerWindow: { readonly fromMs: number; readonly toMsExclusive: number; readonly status: "complete" };
  } | null;
  readonly compilerResult: RoundCompilationResult | null;
  readonly rejectionReason: string | null;
  readonly rulesVersion: typeof RULES_VERSION;
  readonly adapterVersion: typeof ACQUISITION_ADAPTER_VERSION;
}

export interface SanitizedAcquisitionReport {
  readonly reportVersion: 1;
  readonly discoveryCalls: number;
  readonly coverageCalls: number;
  readonly rows: number;
  readonly candidates: number;
  readonly rejectionReasons: Readonly<Record<string, number>>;
  readonly scorable: { readonly buy: number; readonly sell: number; readonly noTrade: number };
  readonly attempts: number;
  readonly successes: number;
  readonly reportedCredits: number;
  readonly retainedCredits: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSafeTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && ETHEREUM_ADDRESS.test(value) ? value.toLowerCase() : null;
}

function normalizeHash(value: unknown): string | null {
  return typeof value === "string" && ETHEREUM_TRANSACTION_HASH.test(value) ? value.toLowerCase() : null;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !EXACT_MILLISECOND_ISO.test(value)) return null;
  const parsed = Date.parse(value);
  return isSafeTimestamp(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function isValidUsd(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function assertToken(token: AcquisitionToken): void {
  if (!ACQUISITION_TOKEN_UNIVERSE.some((configured) => configured.address === token.address)) {
    throw new Error("Token is not in the reviewed acquisition universe");
  }
}

export function assertAcquisitionEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Acquisition endpoint is invalid");
  }
  if (
    endpoint !== NANSEN_DEX_TRADES_ENDPOINT ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "api.nansen.ai" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/api/v1/tgm/dex-trades" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Acquisition endpoint is not on the exact allowlist");
  }
}

export function acquisitionRequestFingerprint(request: AcquisitionRequest): string {
  return sha256(`${ACQUISITION_SCHEMA_VERSION}:${canonicalJson(request)}`);
}

export function buildAcquisitionRequest(
  token: AcquisitionToken,
  localFromMs: number,
  localToMsExclusive: number,
  page = 1,
): AcquisitionRequest {
  assertToken(token);
  if (!isSafeTimestamp(localFromMs) || !isSafeTimestamp(localToMsExclusive) || localFromMs >= localToMsExclusive) {
    throw new Error("Acquisition interval is invalid");
  }
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Acquisition page is invalid");
  return {
    chain: ETHEREUM_CHAIN,
    token_address: token.address,
    only_smart_money: false,
    date: {
      from: new Date(localFromMs - PROVIDER_BOUNDARY_OVERLAP_MS).toISOString(),
      to: new Date(localToMsExclusive).toISOString(),
    },
    pagination: { page, per_page: ACQUISITION_PER_PAGE },
    order_by: [{ field: "block_timestamp", direction: "ASC" }],
  };
}

export function buildDiscoveryPlan(retrievalTimeMs: number): readonly PlannedRequest[] {
  if (!isSafeTimestamp(retrievalTimeMs)) throw new Error("Retrieval time is invalid");
  const retrievalDayMs = Math.floor(retrievalTimeMs / DAY_MS) * DAY_MS;
  const earliest = retrievalDayMs - 40 * DAY_MS;
  return ACQUISITION_TOKEN_UNIVERSE.flatMap((token) =>
    [0, 1, 2].map((index) => {
      const localFromMs = earliest + index * DISCOVERY_WINDOW_MS;
      const localToMsExclusive = localFromMs + DISCOVERY_WINDOW_MS;
      return {
        purpose: "discovery" as const,
        token,
        wallet: null,
        cutoffMs: null,
        localFromMs,
        localToMsExclusive,
        request: buildAcquisitionRequest(token, localFromMs, localToMsExclusive),
      };
    }),
  );
}

export function buildCoveragePlan(candidate: DiscoveredCandidate, page = 1): PlannedRequest {
  assertToken(candidate.token);
  if (!ETHEREUM_ADDRESS.test(candidate.wallet) || candidate.wallet !== candidate.wallet.toLowerCase()) {
    throw new Error("Candidate wallet is not normalized");
  }
  const localFromMs = candidate.proposedCutoffMs - LOOKBACK_MS;
  const localToMsExclusive = candidate.proposedCutoffMs + ANSWER_WINDOW_MS;
  return {
    purpose: "coverage",
    token: candidate.token,
    wallet: candidate.wallet,
    cutoffMs: candidate.proposedCutoffMs,
    localFromMs,
    localToMsExclusive,
    request: buildAcquisitionRequest(candidate.token, localFromMs, localToMsExclusive, page),
  };
}

export function parseProviderPage(
  value: unknown,
  planned: PlannedRequest,
  requestId: string,
  retrievalTimeMs: number,
): PageParseResult {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(requestId)) {
    return { status: "invalid", reason: "invalid-request-id" };
  }
  if (!isSafeTimestamp(retrievalTimeMs) || !isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) {
    return { status: "invalid", reason: "malformed-envelope" };
  }
  if (!value.data.every(isRecord)) return { status: "invalid", reason: "malformed-row" };
  const expectedPage = planned.request.pagination.page;
  const expectedPerPage = planned.request.pagination.per_page;
  if (
    value.pagination.page !== expectedPage ||
    value.pagination.per_page !== expectedPerPage ||
    typeof value.pagination.is_last_page !== "boolean"
  ) {
    return { status: "invalid", reason: "contradictory-pagination" };
  }
  if (value.data.length > expectedPerPage) return { status: "invalid", reason: "page-size-exceeded" };
  return {
    status: "valid",
    page: {
      requestId,
      requestFingerprint: acquisitionRequestFingerprint(planned.request),
      retrievalTimeMs,
      page: expectedPage,
      perPage: expectedPerPage,
      isLastPage: value.pagination.is_last_page,
      rows: value.data,
    },
  };
}

interface NormalizedRow {
  readonly event: NormalizedTradeEvent;
  readonly fingerprint: string;
  readonly conflictKey: string;
}

function normalizeRow(row: Record<string, unknown>, expectedToken: string): NormalizedRow | string {
  const occurredAtMs = normalizeTimestamp(row.block_timestamp);
  if (occurredAtMs === null) return "timestamp-precision-or-value-invalid";
  const transactionHash = normalizeHash(row.transaction_hash);
  if (transactionHash === null) return "transaction-hash-invalid";
  const wallet = normalizeAddress(row.trader_address);
  if (wallet === null) return "wallet-address-invalid";
  const token = normalizeAddress(row.token_address);
  if (token === null || token !== expectedToken) return "token-address-mismatch";
  const action = row.action === "BUY" ? "buy" : row.action === "SELL" ? "sell" : null;
  if (action === null) return "action-invalid";
  if (!isValidUsd(row.estimated_value_usd)) return "usd-value-invalid";

  const fingerprint = sha256(canonicalJson(row));
  const event: NormalizedTradeEvent = {
    eventId: `derived-v1:${fingerprint}`,
    chain: ETHEREUM_CHAIN,
    token,
    wallet,
    transactionHash,
    occurredAtMs,
    action,
    usdValue: row.estimated_value_usd,
  };
  return {
    event,
    fingerprint,
    conflictKey: [transactionHash, wallet, token, String(occurredAtMs), action].join(":"),
  };
}

export function normalizeCompletePages(
  pages: readonly ProviderPage[],
  planned: Omit<PlannedRequest, "request">,
): NormalizationResult {
  if (pages.length === 0) return { status: "rejected", reason: "missing-pages" };
  if (new Set(pages.map((page) => page.page)).size !== pages.length) {
    return { status: "rejected", reason: "duplicate-page" };
  }
  for (const [index, page] of pages.entries()) {
    if (page.page !== index + 1) return { status: "rejected", reason: "missing-or-out-of-order-page" };
    if (page.perPage !== ACQUISITION_PER_PAGE) return { status: "rejected", reason: "per-page-mismatch" };
    const expectedFingerprint = acquisitionRequestFingerprint(
      buildAcquisitionRequest(planned.token, planned.localFromMs, planned.localToMsExclusive, page.page),
    );
    if (page.requestFingerprint !== expectedFingerprint) {
      return { status: "rejected", reason: "request-identity-mismatch" };
    }
    if (!isSafeTimestamp(page.retrievalTimeMs)) return { status: "rejected", reason: "retrieval-time-invalid" };
    if (index < pages.length - 1 && page.isLastPage) return { status: "rejected", reason: "premature-terminal-page" };
    if (index === pages.length - 1 && !page.isLastPage) return { status: "rejected", reason: "nonterminal-pagination" };
  }
  if (new Set(pages.map((page) => page.requestId)).size !== pages.length) {
    return { status: "rejected", reason: "duplicate-request-id" };
  }
  if (new Set(pages.map((page) => page.requestFingerprint)).size !== pages.length) {
    return { status: "rejected", reason: "duplicate-request-identity" };
  }

  const normalized: NormalizedRow[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      const result = normalizeRow(row, planned.token.address);
      if (typeof result === "string") return { status: "rejected", reason: result };
      normalized.push(result);
    }
  }

  const byFingerprint = new Map<string, NormalizedRow>();
  let exactDuplicateRows = 0;
  for (const row of normalized) {
    if (byFingerprint.has(row.fingerprint)) exactDuplicateRows += 1;
    else byFingerprint.set(row.fingerprint, row);
  }
  const uniqueRows = [...byFingerprint.values()];
  const conflicts = new Map<string, Set<string>>();
  for (const row of uniqueRows) {
    const fingerprints = conflicts.get(row.conflictKey) ?? new Set<string>();
    fingerprints.add(row.fingerprint);
    conflicts.set(row.conflictKey, fingerprints);
  }
  if ([...conflicts.values()].some((fingerprints) => fingerprints.size > 1)) {
    return { status: "rejected", reason: "conflicting-row" };
  }

  const inLocalWindow = uniqueRows
    .map((row) => row.event)
    .filter(
      (event) => event.occurredAtMs >= planned.localFromMs && event.occurredAtMs < planned.localToMsExclusive,
    )
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs || left.eventId.localeCompare(right.eventId));
  return {
    status: "complete",
    events: inLocalWindow,
    rowCount: normalized.length,
    exactDuplicateRows,
    retrievalTimeMs: Math.max(...pages.map((page) => page.retrievalTimeMs)),
    sourceRequestIds: pages.map((page) => page.requestId),
    sourcePages: pages.map((page) => ({
      requestId: page.requestId,
      page: page.page,
      requestFingerprint: page.requestFingerprint,
    })),
  };
}

export function discoverCandidates(
  normalized: Extract<NormalizationResult, { status: "complete" }>,
  planned: Omit<PlannedRequest, "request">,
): readonly DiscoveredCandidate[] {
  if (planned.purpose !== "discovery") throw new Error("Discovery requires a discovery plan");
  const retrievalDay = Math.floor(normalized.retrievalTimeMs / DAY_MS) * DAY_MS;
  const byId = new Map<string, DiscoveredCandidate>();
  for (const event of normalized.events) {
    if ((event.usdValue as number) < ADMISSION_TRADE_MIN_USD) continue;
    const proposedCutoffMs = Math.floor(event.occurredAtMs / DAY_MS) * DAY_MS + DAY_MS;
    const age = retrievalDay - proposedCutoffMs;
    if (age < 10 * DAY_MS || age > 40 * DAY_MS) continue;
    const candidateId = `candidate-v1-${sha256(`${planned.token.address}:${event.wallet}:${proposedCutoffMs}`).slice(0, 24)}`;
    byId.set(candidateId, {
      candidateId,
      token: planned.token,
      wallet: event.wallet,
      proposedCutoffMs,
      anchorEventId: event.eventId,
    });
  }
  return [...byId.values()].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

export function compileCoveredCandidate(
  candidate: DiscoveredCandidate,
  normalized: NormalizationResult,
): PrivateCandidateRecord {
  const rejected = (reason: string): PrivateCandidateRecord => ({
    candidateId: candidate.candidateId,
    token: candidate.token,
    wallet: candidate.wallet,
    proposedCutoffMs: candidate.proposedCutoffMs,
    sourceRequestIds: [],
    sourcePages: [],
    retrievalTimeMs: 0,
    coverage: null,
    compilerResult: null,
    rejectionReason: reason,
    rulesVersion: RULES_VERSION,
    adapterVersion: ACQUISITION_ADAPTER_VERSION,
  });
  if (normalized.status !== "complete") return rejected(normalized.reason);

  const lookbackStart = candidate.proposedCutoffMs - LOOKBACK_MS;
  const answerEnd = candidate.proposedCutoffMs + ANSWER_WINDOW_MS;
  if (normalized.retrievalTimeMs < answerEnd) return rejected("answer-window-not-yet-observed");
  const coverage = {
    lookback: { status: "complete" as const, fromMs: lookbackStart, toMsExclusive: candidate.proposedCutoffMs },
    answerWindow: { status: "complete" as const, fromMs: candidate.proposedCutoffMs, toMsExclusive: answerEnd },
  };
  const matchingTransactions = new Map<string, number>();
  for (const event of normalized.events) {
    if (event.wallet !== candidate.wallet || event.token !== candidate.token.address) continue;
    matchingTransactions.set(event.transactionHash, (matchingTransactions.get(event.transactionHash) ?? 0) + 1);
  }
  if ([...matchingTransactions.values()].some((count) => count > 1)) {
    return {
      candidateId: candidate.candidateId,
      token: candidate.token,
      wallet: candidate.wallet,
      proposedCutoffMs: candidate.proposedCutoffMs,
      sourceRequestIds: normalized.sourceRequestIds,
      sourcePages: normalized.sourcePages,
      retrievalTimeMs: normalized.retrievalTimeMs,
      coverage,
      compilerResult: null,
      rejectionReason: "ambiguous-provider-transaction-legs",
      rulesVersion: RULES_VERSION,
      adapterVersion: ACQUISITION_ADAPTER_VERSION,
    };
  }
  const compilerResult = compileRound({
    chain: ETHEREUM_CHAIN,
    featuredToken: candidate.token.address,
    wallet: candidate.wallet,
    cutoffMs: candidate.proposedCutoffMs,
    events: normalized.events,
    coverage: { ...coverage, observedAtMs: normalized.retrievalTimeMs },
  });
  return {
    candidateId: candidate.candidateId,
    token: candidate.token,
    wallet: candidate.wallet,
    proposedCutoffMs: candidate.proposedCutoffMs,
    sourceRequestIds: normalized.sourceRequestIds,
    sourcePages: normalized.sourcePages,
    retrievalTimeMs: normalized.retrievalTimeMs,
    coverage,
    compilerResult,
    rejectionReason: compilerResult.status === "unscorable" ? compilerResult.reason.code : null,
    rulesVersion: RULES_VERSION,
    adapterVersion: ACQUISITION_ADAPTER_VERSION,
  };
}

export function sanitizeAggregateReport(input: SanitizedAcquisitionReport): SanitizedAcquisitionReport {
  return JSON.parse(JSON.stringify(input)) as SanitizedAcquisitionReport;
}
