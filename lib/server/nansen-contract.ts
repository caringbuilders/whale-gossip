import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

/**
 * Local/server-only Nansen contract-spike support. Application and browser code
 * must not import this module. The executable entry point lives under scripts/.
 */

export const NANSEN_DEX_TRADES_ENDPOINT = "https://api.nansen.ai/api/v1/tgm/dex-trades";
export const CONTRACT_SPIKE_MAX_ATTEMPTS = 5;
export const CONTRACT_SPIKE_MAX_RETAINED_CREDITS = 5;
export const EXPECTED_CREDITS_PER_ATTEMPT = 1;

// Canonical WETH9 on Ethereum. This fixed probe input is not a candidate round.
export const PROBE_TOKEN_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const PROBE_FROM_ISO = "2026-08-28T00:00:00.000Z";
export const PROBE_TO_ISO = "2026-08-28T01:00:00.000Z";
export const PROBE_PAGE = 1;
export const PROBE_PER_PAGE = 3;

const ETHEREUM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ETHEREUM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

export interface DexTradesRequest {
  readonly chain: "ethereum";
  readonly token_address: string;
  readonly only_smart_money: false;
  readonly date: {
    readonly from: string;
    readonly to: string;
  };
  readonly pagination: {
    readonly page: number;
    readonly per_page: number;
  };
  readonly order_by: readonly [
    {
      readonly field: "block_timestamp";
      readonly direction: "ASC";
    },
  ];
}

export function buildProbeRequest(): DexTradesRequest {
  return {
    chain: "ethereum",
    token_address: PROBE_TOKEN_ADDRESS,
    only_smart_money: false,
    date: { from: PROBE_FROM_ISO, to: PROBE_TO_ISO },
    pagination: { page: PROBE_PAGE, per_page: PROBE_PER_PAGE },
    order_by: [{ field: "block_timestamp", direction: "ASC" }],
  };
}

export function assertAllowedEndpoint(endpoint: string): void {
  if (endpoint !== NANSEN_DEX_TRADES_ENDPOINT) {
    throw new Error("Nansen endpoint is not on the contract-spike allowlist");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function requestFingerprint(request: DexTradesRequest): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

const RESPONSE_FIELDS = [
  "block_timestamp",
  "transaction_hash",
  "trader_address",
  "trader_address_label",
  "action",
  "token_address",
  "token_name",
  "token_amount",
  "traded_token_address",
  "traded_token_name",
  "traded_token_amount",
  "estimated_swap_price_usd",
  "estimated_value_usd",
] as const;

type ResponseField = (typeof RESPONSE_FIELDS)[number];
type JsonType = "array" | "boolean" | "null" | "number" | "object" | "string" | "undefined";

interface FieldShape {
  readonly present: number;
  readonly missing: number;
  readonly types: readonly JsonType[];
}

export interface DexTradesContractSummary {
  readonly contract: "tgm-dex-trades";
  readonly validEnvelope: boolean;
  readonly recordCount: number | null;
  readonly fields: Readonly<Record<ResponseField, FieldShape>>;
  readonly pagination: {
    readonly valid: boolean;
    readonly page: number | null;
    readonly perPage: number | null;
    readonly isLastPage: boolean | null;
  };
  readonly observations: {
    readonly actions: { readonly buy: number; readonly sell: number; readonly other: number };
    readonly timestamps: { readonly strings: number; readonly parseableIso: number; readonly ascending: boolean | null };
    readonly transactionHashes: { readonly strings: number; readonly validEthereumSyntax: number; readonly distinct: number };
    readonly traderAddresses: { readonly strings: number; readonly validEthereumSyntax: number; readonly distinct: number };
    readonly tokenAddresses: { readonly strings: number; readonly validEthereumSyntax: number; readonly matchingProbeToken: number };
    readonly estimatedUsdValues: { readonly numbers: number; readonly nulls: number; readonly other: number; readonly negative: number };
  };
  readonly issues: readonly string[];
}

function jsonType(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as Exclude<JsonType, "array" | "null">;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function summarizeDexTradesResponse(value: unknown): DexTradesContractSummary {
  const root = isRecord(value) ? value : null;
  const data = root && Array.isArray(root.data) ? root.data : null;
  const rows = data?.filter(isRecord) ?? [];
  const fields = Object.fromEntries(
    RESPONSE_FIELDS.map((field) => {
      const values = rows.map((row) => row[field]);
      const present = values.filter((item) => item !== undefined).length;
      const types = [...new Set(values.map(jsonType))].sort();
      return [field, { present, missing: rows.length - present, types }];
    }),
  ) as unknown as Record<ResponseField, FieldShape>;

  const pagination = root && isRecord(root.pagination) ? root.pagination : null;
  const page = pagination?.page;
  const perPage = pagination?.per_page;
  const isLastPage = pagination?.is_last_page;
  const validPagination =
    Number.isInteger(page) &&
    typeof page === "number" &&
    page >= 1 &&
    Number.isInteger(perPage) &&
    typeof perPage === "number" &&
    perPage >= 1 &&
    typeof isLastPage === "boolean";

  const issues: string[] = [];
  if (!root) issues.push("response-root-is-not-an-object");
  if (!data) issues.push("data-is-not-an-array");
  if (data && rows.length !== data.length) issues.push("data-contains-non-object-records");
  if (!validPagination) issues.push("pagination-shape-is-invalid");
  for (const field of RESPONSE_FIELDS) {
    if (rows.length > 0 && fields[field].missing > 0) issues.push(`missing-field:${field}`);
  }

  const timestampValues = rows.map((row) => row.block_timestamp).filter((item): item is string => typeof item === "string");
  const parsedTimestamps = timestampValues.map((item) => Date.parse(item));
  const parseableTimestamps = parsedTimestamps.filter(Number.isFinite);
  const ascending =
    parsedTimestamps.length === rows.length && rows.length > 0
      ? parsedTimestamps.every((timestamp, index) => index === 0 || parsedTimestamps[index - 1] <= timestamp)
      : rows.length === 0
        ? true
        : null;

  const hashes = rows.map((row) => row.transaction_hash).filter((item): item is string => typeof item === "string");
  const traders = rows.map((row) => row.trader_address).filter((item): item is string => typeof item === "string");
  const tokens = rows.map((row) => row.token_address).filter((item): item is string => typeof item === "string");
  const usdValues = rows.map((row) => row.estimated_value_usd);
  const hasSignedZeroUsd = usdValues.some((item) => typeof item === "number" && Object.is(item, -0));
  if (hasSignedZeroUsd) issues.push("invalid-estimated-value-usd:signed-zero");

  return {
    contract: "tgm-dex-trades",
    validEnvelope: Boolean(root && data && rows.length === data.length && validPagination && !hasSignedZeroUsd),
    recordCount: data?.length ?? null,
    fields,
    pagination: {
      valid: validPagination,
      page: typeof page === "number" && Number.isInteger(page) ? page : null,
      perPage: typeof perPage === "number" && Number.isInteger(perPage) ? perPage : null,
      isLastPage: typeof isLastPage === "boolean" ? isLastPage : null,
    },
    observations: {
      actions: {
        buy: rows.filter((row) => row.action === "BUY").length,
        sell: rows.filter((row) => row.action === "SELL").length,
        other: rows.filter((row) => row.action !== "BUY" && row.action !== "SELL").length,
      },
      timestamps: {
        strings: timestampValues.length,
        parseableIso: parseableTimestamps.length,
        ascending,
      },
      transactionHashes: {
        strings: hashes.length,
        validEthereumSyntax: hashes.filter((item) => ETHEREUM_TRANSACTION_HASH.test(item)).length,
        distinct: new Set(hashes.map((item) => item.toLowerCase())).size,
      },
      traderAddresses: {
        strings: traders.length,
        validEthereumSyntax: traders.filter((item) => ETHEREUM_ADDRESS.test(item)).length,
        distinct: new Set(traders.map((item) => item.toLowerCase())).size,
      },
      tokenAddresses: {
        strings: tokens.length,
        validEthereumSyntax: tokens.filter((item) => ETHEREUM_ADDRESS.test(item)).length,
        matchingProbeToken: tokens.filter((item) => item.toLowerCase() === PROBE_TOKEN_ADDRESS).length,
      },
      estimatedUsdValues: {
        numbers: usdValues.filter(
          (item) => typeof item === "number" && Number.isFinite(item) && !Object.is(item, -0),
        ).length,
        nulls: usdValues.filter((item) => item === null).length,
        other: usdValues.filter((item) => item !== null && (typeof item !== "number" || !Number.isFinite(item))).length,
        negative: usdValues.filter((item) => typeof item === "number" && (item < 0 || Object.is(item, -0))).length,
      },
    },
    issues: [...new Set(issues)].sort(),
  };
}

export type AttemptOutcome =
  | "pending"
  | "success"
  | "authentication-error"
  | "authorization-or-credit-error"
  | "rate-limited"
  | "transient-error"
  | "request-error"
  | "invalid-response";

interface LedgerBase {
  readonly ledgerVersion: 1;
  readonly attemptId: string;
  readonly recordedAt: string;
  readonly endpoint: typeof NANSEN_DEX_TRADES_ENDPOINT;
  readonly requestFingerprint: string;
  readonly pagination: { readonly page: number; readonly perPage: number };
  readonly reservedCredits: number;
}

export interface LedgerReservation extends LedgerBase {
  readonly phase: "reserved";
  readonly httpStatus: null;
  readonly latencyMs: null;
  readonly reportedCreditCost: null;
  readonly reportedCreditsUsed: null;
  readonly retainedCredits: number;
  readonly outcome: "pending";
}

export interface LedgerSettlement extends LedgerBase {
  readonly phase: "settled";
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  readonly reportedCreditCost: number | null;
  readonly reportedCreditsUsed: number | null;
  readonly retainedCredits: number;
  readonly outcome: Exclude<AttemptOutcome, "pending">;
}

export type LedgerEntry = LedgerReservation | LedgerSettlement;

export interface LedgerSummary {
  readonly attempts: number;
  readonly settled: number;
  readonly successful: number;
  readonly reportedCreditsUsed: number;
  readonly unknownChargeAttempts: number;
  readonly retainedCredits: number;
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw new Error("Unable to inspect a private contract-spike path");
  }
}

function assertOwnedByCurrentUser(stat: Stats): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("Private contract-spike path is owned by another user");
  }
}

function assertSafeRegularFile(stat: Stats): void {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Private contract-spike file is not a regular file");
  assertOwnedByCurrentUser(stat);
  if ((stat.mode & 0o077) !== 0) throw new Error("Private contract-spike file permissions are too broad");
}

function assertDirectoryChainIsSafe(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part);
    const stat = lstatOrNull(current);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Private contract-spike path contains an unsafe parent");
    }
  }
}

export function ensurePrivateDirectory(path: string): void {
  const absolute = resolve(path);
  if (!isAbsolute(absolute)) throw new Error("Private contract-spike path must be absolute");
  const root = parse(absolute).root;
  let current = root;
  const relativeParts = absolute.slice(root.length).split(/[\\/]+/).filter(Boolean);
  for (const part of relativeParts) {
    current = join(current, part);
    let stat = lstatOrNull(current);
    if (stat === null) {
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch {
        throw new Error("Unable to create a private contract-spike directory");
      }
      stat = lstatOrNull(current);
    }
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Private contract-spike path contains an unsafe parent");
    }
  }

  const finalStat = lstatOrNull(absolute);
  if (!finalStat) throw new Error("Private contract-spike directory is unavailable");
  assertOwnedByCurrentUser(finalStat);
  if ((finalStat.mode & 0o077) !== 0) throw new Error("Private contract-spike directory permissions are too broad");
}

export function readCredentialTextFile(path: string): string {
  assertDirectoryChainIsSafe(dirname(path));
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("Unable to read the repository credential file safely");
  }
  try {
    assertSafeRegularFile(fstatSync(descriptor));
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

function openPrivateFile(path: string, flags: number, mode = 0o600): number {
  ensurePrivateDirectory(dirname(path));
  let descriptor: number;
  try {
    descriptor = openSync(path, flags | constants.O_NOFOLLOW, mode);
  } catch {
    throw new Error("Unable to open a private contract-spike file safely");
  }
  try {
    assertSafeRegularFile(fstatSync(descriptor));
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export function readPrivateTextFile(path: string): string {
  const descriptor = openPrivateFile(path, constants.O_RDONLY);
  try {
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function writePrivateTextFileExclusive(path: string, contents: string): void {
  const descriptor = openPrivateFile(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
  try {
    writeSync(descriptor, contents);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function appendDurably(path: string, entry: LedgerEntry): void {
  const file = openPrivateFile(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT);
  try {
    writeSync(file, `${JSON.stringify(entry)}\n`);
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
}

const SETTLED_OUTCOMES = new Set<LedgerSettlement["outcome"]>([
  "success",
  "authentication-error",
  "authorization-or-credit-error",
  "rate-limited",
  "transient-error",
  "request-error",
  "invalid-response",
]);

function isNonnegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullableNonnegativeNumber(value: unknown): value is number | null {
  return value === null || isNonnegativeNumber(value);
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (!isRecord(value)) return false;
  const baseIsValid =
    value.ledgerVersion === 1 &&
    typeof value.attemptId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.attemptId) &&
    typeof value.recordedAt === "string" &&
    Number.isFinite(Date.parse(value.recordedAt)) &&
    value.endpoint === NANSEN_DEX_TRADES_ENDPOINT &&
    typeof value.requestFingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(value.requestFingerprint) &&
    isRecord(value.pagination) &&
    Number.isInteger(value.pagination.page) &&
    typeof value.pagination.page === "number" &&
    value.pagination.page >= 1 &&
    Number.isInteger(value.pagination.perPage) &&
    typeof value.pagination.perPage === "number" &&
    value.pagination.perPage >= 1 &&
    value.reservedCredits === EXPECTED_CREDITS_PER_ATTEMPT &&
    isNonnegativeNumber(value.retainedCredits);
  if (!baseIsValid) return false;

  if (value.phase === "reserved") {
    return (
      value.httpStatus === null &&
      value.latencyMs === null &&
      value.reportedCreditCost === null &&
      value.reportedCreditsUsed === null &&
      value.retainedCredits === EXPECTED_CREDITS_PER_ATTEMPT &&
      value.outcome === "pending"
    );
  }

  return (
    value.phase === "settled" &&
    (value.httpStatus === null ||
      (typeof value.httpStatus === "number" &&
        Number.isInteger(value.httpStatus) &&
        value.httpStatus >= 100 &&
        value.httpStatus <= 599)) &&
    isNonnegativeNumber(value.latencyMs) &&
    isNullableNonnegativeNumber(value.reportedCreditCost) &&
    isNullableNonnegativeNumber(value.reportedCreditsUsed) &&
    typeof value.outcome === "string" &&
    SETTLED_OUTCOMES.has(value.outcome as LedgerSettlement["outcome"])
  );
}

function readLedger(path: string): LedgerEntry[] {
  const stat = lstatOrNull(path);
  if (stat === null) return [];
  if (stat.isSymbolicLink()) throw new Error("Contract-spike ledger path is unsafe");
  const text = readPrivateTextFile(path);
  if (text.trim() === "") return [];
  const entries = text
    .trimEnd()
    .split("\n")
    .map((line, index) => {
      try {
        const value = JSON.parse(line) as unknown;
        if (!isLedgerEntry(value)) throw new Error();
        return value;
      } catch {
        throw new Error(`Contract-spike ledger is malformed at line ${index + 1}`);
      }
    });

  const phases = new Map<string, LedgerEntry["phase"]>();
  for (const [index, entry] of entries.entries()) {
    const previous = phases.get(entry.attemptId);
    if ((entry.phase === "reserved" && previous !== undefined) || (entry.phase === "settled" && previous !== "reserved")) {
      throw new Error(`Contract-spike ledger has invalid attempt history at line ${index + 1}`);
    }
    phases.set(entry.attemptId, entry.phase);
  }
  return entries;
}

function latestByAttempt(entries: readonly LedgerEntry[]): Map<string, LedgerEntry> {
  const latest = new Map<string, LedgerEntry>();
  for (const entry of entries) latest.set(entry.attemptId, entry);
  return latest;
}

export class ContractSpikeLedger {
  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  summarize(): LedgerSummary {
    const entries = readLedger(this.path);
    const reservations = new Set(entries.filter((entry) => entry.phase === "reserved").map((entry) => entry.attemptId));
    const latest = [...latestByAttempt(entries).values()];
    const settlements = latest.filter((entry): entry is LedgerSettlement => entry.phase === "settled");
    return {
      attempts: reservations.size,
      settled: settlements.length,
      successful: settlements.filter((entry) => entry.outcome === "success").length,
      reportedCreditsUsed: settlements.reduce((sum, entry) => sum + (entry.reportedCreditsUsed ?? 0), 0),
      unknownChargeAttempts: settlements.filter((entry) => entry.reportedCreditsUsed === null).length,
      retainedCredits: latest.reduce((sum, entry) => sum + entry.retainedCredits, 0),
    };
  }

  reserve(fingerprint: string, pagination: { readonly page: number; readonly perPage: number }): LedgerReservation {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("Request fingerprint is invalid");
    const summary = this.summarize();
    if (summary.attempts >= CONTRACT_SPIKE_MAX_ATTEMPTS) throw new Error("Contract-spike attempt cap is exhausted");
    if (summary.retainedCredits + EXPECTED_CREDITS_PER_ATTEMPT > CONTRACT_SPIKE_MAX_RETAINED_CREDITS) {
      throw new Error("Contract-spike retained-credit cap is exhausted");
    }
    const attemptId = this.createId();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(attemptId)) throw new Error("Attempt ID is invalid");
    if (latestByAttempt(readLedger(this.path)).has(attemptId)) throw new Error("Attempt ID already exists in the ledger");
    const reservation: LedgerReservation = {
      ledgerVersion: 1,
      phase: "reserved",
      attemptId,
      recordedAt: this.now().toISOString(),
      endpoint: NANSEN_DEX_TRADES_ENDPOINT,
      requestFingerprint: fingerprint,
      pagination,
      reservedCredits: EXPECTED_CREDITS_PER_ATTEMPT,
      httpStatus: null,
      latencyMs: null,
      reportedCreditCost: null,
      reportedCreditsUsed: null,
      retainedCredits: EXPECTED_CREDITS_PER_ATTEMPT,
      outcome: "pending",
    };
    appendDurably(this.path, reservation);
    return reservation;
  }

  settle(
    reservation: LedgerReservation,
    result: {
      readonly httpStatus: number | null;
      readonly latencyMs: number;
      readonly reportedCreditCost: number | null;
      readonly reportedCreditsUsed: number | null;
      readonly outcome: Exclude<AttemptOutcome, "pending">;
    },
  ): LedgerSettlement {
    const latest = latestByAttempt(readLedger(this.path)).get(reservation.attemptId);
    if (!latest || latest.phase !== "reserved") throw new Error("Attempt reservation is missing or already settled");
    const settlement: LedgerSettlement = {
      ...reservation,
      phase: "settled",
      recordedAt: this.now().toISOString(),
      httpStatus: result.httpStatus,
      latencyMs: Math.max(0, Math.round(result.latencyMs)),
      reportedCreditCost: result.reportedCreditCost,
      reportedCreditsUsed: result.reportedCreditsUsed,
      retainedCredits: result.reportedCreditsUsed ?? reservation.reservedCredits,
      outcome: result.outcome,
    };
    appendDurably(this.path, settlement);
    return settlement;
  }
}

export function parseNonnegativeHeader(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && !Object.is(parsed, -0) ? parsed : null;
}

export function classifyHttpOutcome(status: number, validEnvelope: boolean): Exclude<AttemptOutcome, "pending"> {
  if (status === 401) return "authentication-error";
  if (status === 402 || status === 403) return "authorization-or-credit-error";
  if (status === 429) return "rate-limited";
  if ([408, 500, 502, 503, 504].includes(status)) return "transient-error";
  if (status < 200 || status >= 300) return "request-error";
  return validEnvelope ? "success" : "invalid-response";
}

export interface ContractSpikeLock {
  readonly path: string;
  release(): void;
}

export function acquireContractSpikeLock(path: string, now: () => Date = () => new Date()): ContractSpikeLock {
  ensurePrivateDirectory(dirname(path));
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error("Contract-spike lock is already held or unsafe; live mode remains disabled");
  }

  let descriptorStat: Stats;
  try {
    descriptorStat = fstatSync(descriptor);
    assertSafeRegularFile(descriptorStat);
    writeSync(descriptor, `${JSON.stringify({ lockVersion: 1, pid: process.pid, startedAt: now().toISOString() })}\n`);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }

  let released = false;
  return {
    path,
    release() {
      if (released) throw new Error("Contract-spike lock was already released");
      released = true;
      closeSync(descriptor);
      const pathStat = lstatOrNull(path);
      if (
        !pathStat ||
        pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        pathStat.dev !== descriptorStat.dev ||
        pathStat.ino !== descriptorStat.ino
      ) {
        throw new Error("Contract-spike lock changed while held and was not removed");
      }
      try {
        unlinkSync(path);
      } catch {
        throw new Error("Contract-spike lock could not be removed safely");
      }
    },
  };
}
