import "server-only";

import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
  unlinkSync,
  type Dirent,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import {
  ACQUISITION_ADAPTER_VERSION,
  ACQUISITION_EXPECTED_CREDIT_COST,
  ACQUISITION_MAX_ATTEMPTS,
  ACQUISITION_MAX_RETAINED_CREDITS,
  ACQUISITION_SCHEMA_VERSION,
  ACQUISITION_STATE_VERSION,
  ACQUISITION_TOKEN_UNIVERSE,
  DISCOVERY_MAX_CALLS,
  DISCOVERY_MAX_PAGES_PER_WINDOW,
  CONTRACT_SPIKE_SUCCESSES,
  INTERNAL_TOTAL_SUCCESS_TARGET,
  MAX_ACQUISITION_SUCCESSES,
  assertAcquisitionEndpoint,
  acquisitionRequestFingerprint,
  buildAcquisitionRequest,
  buildCoveragePlan,
  buildDiscoveryPlan,
  buildSanitizedAcquisitionReport,
  compileCoveredCandidate,
  normalizeCompletePages,
  normalizeProviderTimestamp,
  parseProviderPage,
  summarizeDiscoveryPage,
  validateCoveragePage,
  legacyAcquisitionRequestFingerprintV3,
  type AcquisitionToken,
  type CoveragePageEvidence,
  type CoveragePageRejectionReason,
  type DiscoveredCandidate,
  type DiscoveryValidationReason,
  type DiscoveryPageEvidence,
  type PlannedRequest,
  type PrivateCandidateRecord,
  type ProviderPage,
  type SanitizedAcquisitionReport,
  type SourceTimestampPrecision,
} from "./nansen-acquisition";
import {
  diagnoseCanonicalDiscoveryCache,
  type CacheDiagnosticReport,
} from "./nansen-cache-diagnostic";
import {
  acquireContractSpikeLock,
  ensurePrivateDirectory,
  parseNonnegativeHeader,
  readCredentialTextFile,
  readPrivateTextFile,
  writePrivateTextFileExclusive,
  NANSEN_DEX_TRADES_ENDPOINT,
} from "./nansen-contract";

export const ACQUISITION_REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const ACQUISITION_REQUEST_TIMEOUT_MS = 20_000;
export const ACQUISITION_MIN_REQUEST_INTERVAL_MS = 500;
export const ACQUISITION_MAX_RETRY_AFTER_MS = 30_000;
export const ACQUISITION_MAX_RETRIES_PER_REQUEST = 1;

export interface AcquisitionPaths {
  readonly repositoryRoot: string;
  readonly environmentFile: string;
  readonly ledger: string;
  readonly lock: string;
  readonly legacyState: string;
  readonly state: string;
  readonly rawDirectory: string;
  readonly legacyCacheDirectory: string;
  readonly cacheDirectory: string;
  readonly reprocessingManifest: string;
  readonly candidateManifest: string;
  readonly aggregateReport: string;
}

export function resolveAcquisitionPaths(repositoryRoot = ACQUISITION_REPOSITORY_ROOT): AcquisitionPaths {
  const canonicalRoot = resolve(repositoryRoot);
  const privateRoot = join(canonicalRoot, "data", "private", "nansen-acquisition");
  const ledger = join(canonicalRoot, "data", "ledgers", "nansen-acquisition.json");
  return {
    repositoryRoot: canonicalRoot,
    environmentFile: join(canonicalRoot, ".env.local"),
    ledger,
    lock: `${ledger}.lock`,
    legacyState: join(privateRoot, "state.json"),
    state: join(privateRoot, "state-v4.json"),
    rawDirectory: join(privateRoot, "raw"),
    legacyCacheDirectory: join(privateRoot, "cache-v3"),
    cacheDirectory: join(privateRoot, "cache-v4"),
    reprocessingManifest: join(privateRoot, "reprocessing-v4.json"),
    candidateManifest: join(privateRoot, "candidate-manifest-v4.json"),
    aggregateReport: join(privateRoot, "aggregate-report-v4.json"),
  };
}

export type AcquisitionCommand =
  | { readonly mode: "dry-run" }
  | { readonly mode: "status" }
  | { readonly mode: "diagnose-cache" }
  | { readonly mode: "reprocess-cache" }
  | { readonly mode: "live"; readonly maxNewCalls: number; readonly targetTotalSuccess: 120 };

export function parseAcquisitionArguments(arguments_: readonly string[]): AcquisitionCommand {
  if (arguments_.length === 0) return { mode: "dry-run" };
  if (arguments_.length === 1 && arguments_[0] === "--status") return { mode: "status" };
  if (arguments_.length === 1 && arguments_[0] === "--diagnose-cache") return { mode: "diagnose-cache" };
  if (arguments_.length === 1 && arguments_[0] === "--reprocess-cache") return { mode: "reprocess-cache" };
  if (
    arguments_.length === 5 &&
    arguments_[0] === "--live" &&
    arguments_[1] === "--max-new-calls" &&
    arguments_[3] === "--target-total-success"
  ) {
    if (!/^(?:[1-9]|10)$/.test(arguments_[2])) {
      throw new Error("--max-new-calls must be a digits-only integer from 1 through 10");
    }
    if (arguments_[4] !== String(INTERNAL_TOTAL_SUCCESS_TARGET)) {
      throw new Error("--target-total-success must equal the reviewed target of 120");
    }
    return {
      mode: "live",
      maxNewCalls: Number(arguments_[2]),
      targetTotalSuccess: INTERNAL_TOTAL_SUCCESS_TARGET,
    };
  }
  throw new Error(
    "Unsupported arguments; use no arguments, --status, --diagnose-cache, --reprocess-cache, or --live --max-new-calls N --target-total-success 120",
  );
}

type AttemptOutcome =
  | "pending"
  | "success"
  | "authentication-error"
  | "authorization-or-credit-error"
  | "rate-limited"
  | "transient-error"
  | "request-error"
  | "invalid-response"
  | "unexpected-pricing";

type AttemptFailureReason = CoveragePageRejectionReason | null;

interface AcquisitionAttempt {
  readonly attemptId: string;
  readonly phase: "reserved" | "settled";
  readonly requestFingerprint: string;
  readonly purpose: "discovery" | "coverage";
  readonly page: number;
  readonly reservedCredits: 1;
  readonly retainedCredits: number;
  readonly recordedAt: string;
  readonly httpStatus: number | null;
  readonly reportedCreditCost: number | null;
  readonly reportedCreditsUsed: number | null;
  readonly outcome: AttemptOutcome;
  readonly failureReason: AttemptFailureReason;
}

interface AcquisitionLedgerFile {
  readonly ledgerVersion: 2;
  readonly attempts: readonly AcquisitionAttempt[];
}

export interface AcquisitionLedgerSummary {
  readonly attempts: number;
  readonly discoveryAttempts: number;
  readonly coverageAttempts: number;
  readonly settled: number;
  readonly successful: number;
  readonly reportedCreditsUsed: number;
  readonly unknownChargeAttempts: number;
  readonly retainedCredits: number;
  readonly combinedSuccessfulCalls: number;
  readonly failureReasons: Readonly<Record<CoveragePageRejectionReason, number>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function pathExistsWithoutFollowing(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw new Error("Unable to inspect a private acquisition path");
  }
}

function assertSafeExistingPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Private acquisition path is not a regular file");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("Private acquisition file has unsafe ownership");
  }
  if ((stat.mode & 0o077) !== 0) throw new Error("Private acquisition file permissions are too broad");
}

function assertSafeExistingPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Private acquisition path is not a real directory");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("Private acquisition directory has unsafe ownership");
  }
  if ((stat.mode & 0o077) !== 0) throw new Error("Private acquisition directory permissions are too broad");
}

export interface AcquisitionDurabilityHooks {
  readonly syncDirectory?: (path: string) => void;
}

function syncDirectoryDurably(path: string): void {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("Unable to open a private acquisition directory for durable sync");
  }
  try {
    fsyncSync(descriptor);
  } catch (error) {
    if (!(isRecord(error) && (error.code === "EINVAL" || error.code === "ENOTSUP"))) {
      throw new Error("Unable to durably sync a private acquisition directory");
    }
  } finally {
    closeSync(descriptor);
  }
}

function writePrivateJsonAtomic(path: string, value: unknown, hooks: AcquisitionDurabilityHooks = {}): void {
  ensurePrivateDirectory(dirname(path));
  if (pathExistsWithoutFollowing(path)) assertSafeExistingPrivateFile(path);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writePrivateTextFileExclusive(temporary, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temporary, path);
    (hooks.syncDirectory ?? syncDirectoryDurably)(dirname(path));
  } catch (error) {
    try {
      if (pathExistsWithoutFollowing(temporary)) unlinkSync(temporary);
    } catch {
      // Preserve the original fail-closed error.
    }
    throw error;
  }
}

function readPrivateJson(path: string): unknown | null {
  if (!pathExistsWithoutFollowing(path)) return null;
  assertSafeExistingPrivateFile(path);
  try {
    return JSON.parse(readPrivateTextFile(path)) as unknown;
  } catch {
    throw new Error("Private acquisition JSON is malformed");
  }
}

function validateAttempt(value: unknown): value is AcquisitionAttempt {
  if (!isRecord(value)) return false;
  const common =
    typeof value.attemptId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.attemptId) &&
    typeof value.requestFingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(value.requestFingerprint) &&
    (value.purpose === "discovery" || value.purpose === "coverage") &&
    typeof value.page === "number" &&
    Number.isSafeInteger(value.page) &&
    value.page >= 1 &&
    value.reservedCredits === 1 &&
    typeof value.retainedCredits === "number" &&
    Number.isFinite(value.retainedCredits) &&
    value.retainedCredits >= 0 &&
    typeof value.recordedAt === "string" &&
    Number.isFinite(Date.parse(value.recordedAt)) &&
    (value.failureReason === null ||
      value.failureReason === "invalid-coverage-row" ||
      value.failureReason === "wallet-filter-not-applied");
  if (!common) return false;
  if (value.phase === "reserved") {
    return (
      value.retainedCredits === 1 &&
      value.httpStatus === null &&
      value.reportedCreditCost === null &&
      value.reportedCreditsUsed === null &&
      value.outcome === "pending" &&
      value.failureReason === null
    );
  }
  return (
    value.phase === "settled" &&
    (value.httpStatus === null ||
      (typeof value.httpStatus === "number" && Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)) &&
    (value.reportedCreditCost === null ||
      (typeof value.reportedCreditCost === "number" && Number.isFinite(value.reportedCreditCost) && value.reportedCreditCost >= 0)) &&
    (value.reportedCreditsUsed === null ||
      (typeof value.reportedCreditsUsed === "number" && Number.isFinite(value.reportedCreditsUsed) && value.reportedCreditsUsed >= 0)) &&
    [
      "success",
      "authentication-error",
      "authorization-or-credit-error",
      "rate-limited",
      "transient-error",
      "request-error",
      "invalid-response",
      "unexpected-pricing",
    ].includes(String(value.outcome)) &&
    (value.failureReason === null || value.outcome === "invalid-response")
  );
}

function readLedger(path: string): AcquisitionLedgerFile {
  const value = readPrivateJson(path);
  if (value === null) return { ledgerVersion: 2, attempts: [] };
  if (!isRecord(value) || value.ledgerVersion !== 2 || !Array.isArray(value.attempts) || !value.attempts.every(validateAttempt)) {
    throw new Error("Acquisition ledger is malformed");
  }
  const phases = new Map<string, string>();
  for (const attempt of value.attempts) {
    const previous = phases.get(attempt.attemptId);
    if ((attempt.phase === "reserved" && previous !== undefined) || (attempt.phase === "settled" && previous !== "reserved")) {
      throw new Error("Acquisition ledger history is contradictory");
    }
    phases.set(attempt.attemptId, attempt.phase);
  }
  return value as unknown as AcquisitionLedgerFile;
}

function latestAttempts(ledger: AcquisitionLedgerFile): readonly AcquisitionAttempt[] {
  const latest = new Map<string, AcquisitionAttempt>();
  for (const attempt of ledger.attempts) latest.set(attempt.attemptId, attempt);
  return [...latest.values()];
}

export function summarizeAcquisitionLedger(path: string): AcquisitionLedgerSummary {
  const ledger = readLedger(path);
  const latest = latestAttempts(ledger);
  const settled = latest.filter((attempt) => attempt.phase === "settled");
  const successful = settled.filter((attempt) => attempt.outcome === "success").length;
  const failureReasons = {
    "invalid-coverage-row": settled.filter((attempt) => attempt.failureReason === "invalid-coverage-row").length,
    "wallet-filter-not-applied": settled.filter((attempt) => attempt.failureReason === "wallet-filter-not-applied").length,
  };
  return {
    attempts: latest.length,
    discoveryAttempts: latest.filter((attempt) => attempt.purpose === "discovery").length,
    coverageAttempts: latest.filter((attempt) => attempt.purpose === "coverage").length,
    settled: settled.length,
    successful,
    reportedCreditsUsed: settled.reduce((sum, attempt) => sum + (attempt.reportedCreditsUsed ?? 0), 0),
    unknownChargeAttempts: settled.filter((attempt) => attempt.reportedCreditsUsed === null).length,
    retainedCredits: latest.reduce((sum, attempt) => sum + attempt.retainedCredits, 0),
    combinedSuccessfulCalls: CONTRACT_SPIKE_SUCCESSES + successful,
    failureReasons,
  };
}

export class AcquisitionLedger {
  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly durabilityHooks: AcquisitionDurabilityHooks = {},
  ) {}

  summarize(): AcquisitionLedgerSummary {
    return summarizeAcquisitionLedger(this.path);
  }

  requestHistory(fingerprint: string): "none" | "successful" | "attempted" {
    const matching = latestAttempts(readLedger(this.path)).filter(
      (attempt) => attempt.requestFingerprint === fingerprint,
    );
    if (matching.some((attempt) => attempt.phase === "settled" && attempt.outcome === "success")) {
      return "successful";
    }
    return matching.length === 0 ? "none" : "attempted";
  }

  reserve(planned: PlannedRequest): AcquisitionAttempt {
    const ledger = readLedger(this.path);
    const summary = this.summarize();
    if (summary.attempts >= ACQUISITION_MAX_ATTEMPTS) throw new Error("Acquisition attempt cap is exhausted");
    if (summary.retainedCredits + 1 > ACQUISITION_MAX_RETAINED_CREDITS) {
      throw new Error("Acquisition retained-credit cap is exhausted");
    }
    const attemptId = this.createId();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(attemptId)) throw new Error("Attempt ID is invalid");
    if (latestAttempts(ledger).some((attempt) => attempt.attemptId === attemptId)) throw new Error("Attempt ID already exists");
    const reservation: AcquisitionAttempt = {
      attemptId,
      phase: "reserved",
      requestFingerprint: acquisitionRequestFingerprint(planned.request, planned.purpose),
      purpose: planned.purpose,
      page: planned.request.pagination.page,
      reservedCredits: 1,
      retainedCredits: 1,
      recordedAt: this.now().toISOString(),
      httpStatus: null,
      reportedCreditCost: null,
      reportedCreditsUsed: null,
      outcome: "pending",
      failureReason: null,
    };
    writePrivateJsonAtomic(this.path, { ...ledger, attempts: [...ledger.attempts, reservation] }, this.durabilityHooks);
    return reservation;
  }

  settle(
    reservation: AcquisitionAttempt,
    result: {
      readonly httpStatus: number | null;
      readonly reportedCreditCost: number | null;
      readonly reportedCreditsUsed: number | null;
      readonly outcome: Exclude<AttemptOutcome, "pending">;
      readonly failureReason?: AttemptFailureReason;
    },
  ): AcquisitionAttempt {
    const ledger = readLedger(this.path);
    const latest = latestAttempts(ledger).find((attempt) => attempt.attemptId === reservation.attemptId);
    if (!latest || latest.phase !== "reserved") throw new Error("Attempt reservation is missing or already settled");
    const settlement: AcquisitionAttempt = {
      ...reservation,
      phase: "settled",
      retainedCredits: result.reportedCreditsUsed ?? 1,
      recordedAt: this.now().toISOString(),
      httpStatus: result.httpStatus,
      reportedCreditCost: result.reportedCreditCost,
      reportedCreditsUsed: result.reportedCreditsUsed,
      outcome: result.outcome,
      failureReason: result.failureReason ?? null,
    };
    writePrivateJsonAtomic(this.path, { ...ledger, attempts: [...ledger.attempts, settlement] }, this.durabilityHooks);
    return settlement;
  }
}

interface PageReference {
  readonly page: number;
  readonly fingerprint: string;
  readonly requestId: string;
}

interface WorkItem {
  readonly workId: string;
  readonly purpose: "discovery" | "coverage";
  readonly candidateId: string | null;
  readonly token: AcquisitionToken;
  readonly wallet: string | null;
  readonly cutoffMs: number | null;
  readonly localFromMs: number;
  readonly localToMsExclusive: number;
  readonly nextPage: number;
  readonly completedPages: readonly PageReference[];
  readonly complete: boolean;
  readonly samplingStatus: "pending" | "sampled" | null;
}

interface WorkflowState {
  readonly stateVersion: typeof ACQUISITION_STATE_VERSION;
  readonly adapterVersion: typeof ACQUISITION_ADAPTER_VERSION;
  readonly schemaVersion: typeof ACQUISITION_SCHEMA_VERSION;
  readonly initializedAtMs: number;
  readonly provenance:
    | { readonly kind: "fresh" }
    | {
        readonly kind: "reprocessed-v3-discovery";
        readonly reprocessedAtMs: number;
        readonly sourceStateVersion: 3;
        readonly sourceAttemptIds: readonly string[];
      };
  readonly work: readonly WorkItem[];
  readonly candidates: readonly DiscoveredCandidate[];
  readonly results: readonly PrivateCandidateRecord[];
  readonly counters: { readonly discoveryCalls: number; readonly coverageCalls: number; readonly rows: number };
  readonly discoveryPages: readonly DiscoveryPageEvidence[];
  readonly coveragePages: readonly CoveragePageEvidence[];
}

interface CachedPage {
  readonly cacheVersion: 4;
  readonly fingerprint: string;
  readonly retrievalTimeMs: number;
  readonly requestId: string;
  readonly reportedCreditCost: number | null;
  readonly latencyMs: number;
  readonly sourceTimestampPrecisions: readonly (SourceTimestampPrecision | null)[];
  readonly provenance:
    | { readonly kind: "provider-response" }
    | {
        readonly kind: "reprocessed-v3-cache";
        readonly sourceAttemptId: string;
        readonly sourceFingerprint: string;
        readonly sourceCacheVersion: 3;
      };
  readonly response: unknown;
}

interface LegacyCachedPageV3 {
  readonly cacheVersion: 3;
  readonly fingerprint: string;
  readonly retrievalTimeMs: number;
  readonly requestId: string;
  readonly reportedCreditCost: number | null;
  readonly latencyMs: number;
  readonly response: unknown;
}

interface LegacyWorkflowStateV3 {
  readonly stateVersion: 3;
  readonly adapterVersion: "3";
  readonly schemaVersion: 3;
  readonly initializedAtMs: number;
  readonly work: readonly WorkItem[];
  readonly candidates: readonly unknown[];
  readonly results: readonly unknown[];
  readonly counters: { readonly discoveryCalls: 6; readonly coverageCalls: 0; readonly rows: 600 };
  readonly discoveryPages: readonly unknown[];
  readonly coveragePages: readonly unknown[];
}

export interface CacheReprocessingReport {
  readonly reprocessingVersion: 1;
  readonly mode: "reprocess-cache";
  readonly cachePagesReprocessed: number;
  readonly rowsExamined: number;
  readonly validRows: number;
  readonly invalidRows: number;
  readonly timestampPrecision: {
    readonly wholeSecond: number;
    readonly exactMillisecond: number;
  };
  readonly qualifyingRows: number;
  readonly distinctCandidates: number;
  readonly rejectionCounts: Readonly<Record<DiscoveryValidationReason, number>>;
  readonly coverageWorkItemsPlanned: number;
  readonly networkAttempts: 0;
  readonly newLedgerAttempts: 0;
  readonly newLedgerSuccesses: 0;
  readonly newCredits: 0;
}

interface ReprocessingManifestV4 {
  readonly manifestVersion: 1;
  readonly adapterVersion: "4";
  readonly stateVersion: 4;
  readonly schemaVersion: 4;
  readonly sourceStateVersion: 3;
  readonly sourceCacheVersion: 3;
  readonly reprocessedAtMs: number;
  readonly sourceAttemptIds: readonly string[];
  readonly pages: readonly {
    readonly sourceFingerprint: string;
    readonly derivedFingerprint: string;
    readonly sourceAttemptId: string;
    readonly page: number;
  }[];
  readonly report: CacheReprocessingReport;
}

function planFromWork(item: WorkItem): PlannedRequest {
  return {
    purpose: item.purpose,
    candidateId: item.candidateId,
    token: item.token,
    wallet: item.wallet,
    cutoffMs: item.cutoffMs,
    localFromMs: item.localFromMs,
    localToMsExclusive: item.localToMsExclusive,
    request: buildAcquisitionRequest(
      item.token,
      item.localFromMs,
      item.localToMsExclusive,
      item.nextPage,
      item.wallet,
    ),
  };
}

function workFromPlan(plan: PlannedRequest): WorkItem {
  return {
    workId:
      plan.purpose === "coverage" && plan.candidateId
        ? `coverage-${plan.candidateId}`
        : `discovery-${acquisitionRequestFingerprint(plan.request, "discovery").slice(0, 24)}`,
    purpose: plan.purpose,
    candidateId: plan.candidateId,
    token: plan.token,
    wallet: plan.wallet,
    cutoffMs: plan.cutoffMs,
    localFromMs: plan.localFromMs,
    localToMsExclusive: plan.localToMsExclusive,
    nextPage: 1,
    completedPages: [],
    complete: false,
    samplingStatus: plan.purpose === "discovery" ? "pending" : null,
  };
}

function createWorkflowState(nowMs: number): WorkflowState {
  return {
    stateVersion: ACQUISITION_STATE_VERSION,
    adapterVersion: ACQUISITION_ADAPTER_VERSION,
    schemaVersion: ACQUISITION_SCHEMA_VERSION,
    initializedAtMs: nowMs,
    provenance: { kind: "fresh" },
    work: buildDiscoveryPlan(nowMs).map(workFromPlan),
    candidates: [],
    results: [],
    counters: { discoveryCalls: 0, coverageCalls: 0, rows: 0 },
    discoveryPages: [],
    coveragePages: [],
  };
}

function isPageReference(value: unknown): value is PageReference {
  return (
    isRecord(value) &&
    typeof value.page === "number" &&
    Number.isSafeInteger(value.page) &&
    value.page >= 1 &&
    typeof value.fingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(value.fingerprint) &&
    typeof value.requestId === "string"
  );
}

function isWorkItem(value: unknown): value is WorkItem {
  return (
    isRecord(value) &&
    typeof value.workId === "string" &&
    (value.purpose === "discovery" || value.purpose === "coverage") &&
    (value.candidateId === null || typeof value.candidateId === "string") &&
    isRecord(value.token) &&
    typeof value.token.symbol === "string" &&
    typeof value.token.address === "string" &&
    typeof value.token.verification === "string" &&
    (value.wallet === null || typeof value.wallet === "string") &&
    (value.cutoffMs === null || (typeof value.cutoffMs === "number" && Number.isSafeInteger(value.cutoffMs))) &&
    typeof value.localFromMs === "number" &&
    Number.isSafeInteger(value.localFromMs) &&
    typeof value.localToMsExclusive === "number" &&
    Number.isSafeInteger(value.localToMsExclusive) &&
    typeof value.nextPage === "number" &&
    Number.isSafeInteger(value.nextPage) &&
    value.nextPage >= 1 &&
    Array.isArray(value.completedPages) &&
    value.completedPages.every(isPageReference) &&
    typeof value.complete === "boolean" &&
    (value.samplingStatus === null || value.samplingStatus === "pending" || value.samplingStatus === "sampled")
  );
}

function validateState(value: unknown): value is WorkflowState {
  return (
    isRecord(value) &&
    value.stateVersion === ACQUISITION_STATE_VERSION &&
    value.adapterVersion === ACQUISITION_ADAPTER_VERSION &&
    value.schemaVersion === ACQUISITION_SCHEMA_VERSION &&
    typeof value.initializedAtMs === "number" &&
    Number.isSafeInteger(value.initializedAtMs) &&
    isRecord(value.provenance) &&
    (value.provenance.kind === "fresh" ||
      (value.provenance.kind === "reprocessed-v3-discovery" &&
        typeof value.provenance.reprocessedAtMs === "number" &&
        Number.isSafeInteger(value.provenance.reprocessedAtMs) &&
        value.provenance.sourceStateVersion === 3 &&
        Array.isArray(value.provenance.sourceAttemptIds) &&
        value.provenance.sourceAttemptIds.every((attemptId) => typeof attemptId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(attemptId)))) &&
    Array.isArray(value.work) &&
    value.work.every(isWorkItem) &&
    Array.isArray(value.candidates) &&
    Array.isArray(value.results) &&
    isRecord(value.counters) &&
    typeof value.counters.discoveryCalls === "number" &&
    Number.isSafeInteger(value.counters.discoveryCalls) &&
    typeof value.counters.coverageCalls === "number" &&
    Number.isSafeInteger(value.counters.coverageCalls) &&
    typeof value.counters.rows === "number" &&
    Number.isSafeInteger(value.counters.rows) &&
    Array.isArray(value.discoveryPages) &&
    Array.isArray(value.coveragePages)
  );
}

function readState(paths: AcquisitionPaths, nowMs: number): WorkflowState {
  const value = readPrivateJson(paths.state);
  if (value === null) return createWorkflowState(nowMs);
  if (!validateState(value)) throw new Error("Acquisition workflow state is malformed or version-mismatched");
  return value;
}

function readLegacyStateV3(paths: AcquisitionPaths): LegacyWorkflowStateV3 {
  const value = readPrivateJson(paths.legacyState);
  if (
    !isRecord(value) ||
    value.stateVersion !== 3 ||
    value.adapterVersion !== "3" ||
    value.schemaVersion !== 3 ||
    typeof value.initializedAtMs !== "number" ||
    !Number.isSafeInteger(value.initializedAtMs) ||
    !Array.isArray(value.work) ||
    !value.work.every(isWorkItem) ||
    value.work.length !== 3 ||
    value.work.some(
      (work) =>
        work.purpose !== "discovery" ||
        work.candidateId !== null ||
        work.wallet !== null ||
        work.cutoffMs !== null ||
        work.nextPage !== 3 ||
        work.completedPages.length !== 2 ||
        work.completedPages[0].page !== 1 ||
        work.completedPages[1].page !== 2 ||
        !work.complete ||
        work.samplingStatus !== "sampled",
    ) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length !== 0 ||
    !Array.isArray(value.results) ||
    value.results.length !== 0 ||
    !isRecord(value.counters) ||
    value.counters.discoveryCalls !== 6 ||
    value.counters.coverageCalls !== 0 ||
    value.counters.rows !== 600 ||
    !Array.isArray(value.discoveryPages) ||
    value.discoveryPages.length !== 6 ||
    !Array.isArray(value.coveragePages) ||
    value.coveragePages.length !== 0
  ) {
    throw new Error("Legacy acquisition state does not match the reviewed six-page provenance");
  }
  return value as unknown as LegacyWorkflowStateV3;
}

function cachePath(paths: AcquisitionPaths, fingerprint: string): string {
  return join(paths.cacheDirectory, `${fingerprint}.json`);
}

function readCachedPage(paths: AcquisitionPaths, fingerprint: string): CachedPage | null {
  const value = readPrivateJson(cachePath(paths, fingerprint));
  if (value === null) return null;
  if (
    !isRecord(value) ||
    value.cacheVersion !== 4 ||
    value.fingerprint !== fingerprint ||
    typeof value.retrievalTimeMs !== "number" ||
    !Number.isSafeInteger(value.retrievalTimeMs) ||
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.requestId) ||
    (value.reportedCreditCost !== null &&
      (typeof value.reportedCreditCost !== "number" ||
        !Number.isFinite(value.reportedCreditCost) ||
        value.reportedCreditCost < 0 ||
        Object.is(value.reportedCreditCost, -0))) ||
    typeof value.latencyMs !== "number" ||
    !Number.isFinite(value.latencyMs) ||
    value.latencyMs < 0 ||
    !Array.isArray(value.sourceTimestampPrecisions) ||
    !value.sourceTimestampPrecisions.every(
      (precision) => precision === null || precision === "whole-second" || precision === "exact-millisecond",
    ) ||
    !isRecord(value.provenance) ||
    (value.provenance.kind !== "provider-response" &&
      !(
        value.provenance.kind === "reprocessed-v3-cache" &&
        typeof value.provenance.sourceAttemptId === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.provenance.sourceAttemptId) &&
        typeof value.provenance.sourceFingerprint === "string" &&
        /^[0-9a-f]{64}$/.test(value.provenance.sourceFingerprint) &&
        value.provenance.sourceCacheVersion === 3
      )) ||
    !isRecord(value.response) ||
    !Array.isArray(value.response.data) ||
    value.sourceTimestampPrecisions.length !== value.response.data.length
  ) {
    throw new Error("Acquisition cache is malformed or mismatched");
  }
  return value as unknown as CachedPage;
}

function readLegacyCachedPageV3(path: string, fingerprint: string): LegacyCachedPageV3 {
  const value = readPrivateJson(path);
  if (
    !isRecord(value) ||
    value.cacheVersion !== 3 ||
    value.fingerprint !== fingerprint ||
    typeof value.retrievalTimeMs !== "number" ||
    !Number.isSafeInteger(value.retrievalTimeMs) ||
    value.retrievalTimeMs < 0 ||
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.requestId) ||
    (value.reportedCreditCost !== null &&
      (typeof value.reportedCreditCost !== "number" ||
        !Number.isFinite(value.reportedCreditCost) ||
        value.reportedCreditCost < 0 ||
        Object.is(value.reportedCreditCost, -0))) ||
    typeof value.latencyMs !== "number" ||
    !Number.isFinite(value.latencyMs) ||
    value.latencyMs < 0 ||
    !("response" in value)
  ) {
    throw new Error("Legacy acquisition cache is malformed or mismatched");
  }
  return value as unknown as LegacyCachedPageV3;
}

function loadCompletedPages(paths: AcquisitionPaths, item: WorkItem): ProviderPage[] {
  return item.completedPages.map((reference) => {
    const cached = readCachedPage(paths, reference.fingerprint);
    if (!cached || cached.requestId !== reference.requestId) throw new Error("Acquisition cache page is missing");
    const pagePlan: PlannedRequest = {
      ...planFromWork({ ...item, nextPage: reference.page }),
      request: buildAcquisitionRequest(
        item.token,
        item.localFromMs,
        item.localToMsExclusive,
        reference.page,
        item.wallet,
      ),
    };
    const parsed = parseProviderPage(cached.response, pagePlan, cached.requestId, cached.retrievalTimeMs);
    if (parsed.status !== "valid") throw new Error(`cached-page-${parsed.reason}`);
    return parsed.page;
  });
}

function updateAfterPage(
  state: WorkflowState,
  item: WorkItem,
  page: ProviderPage,
  paths: AcquisitionPaths,
  wasUpstreamCall: boolean,
  reportedCreditCost: number | null,
  latencyMs: number,
): WorkflowState {
  const reference = { page: page.page, fingerprint: page.requestFingerprint, requestId: page.requestId };
  const updatedItem: WorkItem = {
    ...item,
    nextPage: page.page + 1,
    completedPages: [...item.completedPages, reference],
    complete:
      item.purpose === "discovery"
        ? page.isLastPage || page.page >= DISCOVERY_MAX_PAGES_PER_WINDOW
        : page.isLastPage,
    samplingStatus: item.purpose === "discovery" ? "sampled" : null,
  };
  const candidates = [...state.candidates];
  let results = [...state.results];
  const work = state.work.map((candidate) => (candidate.workId === item.workId ? updatedItem : candidate));
  let rowsAdded = 0;
  const discoveryPages = [...state.discoveryPages];

  if (item.purpose === "discovery") {
    const discovery = summarizeDiscoveryPage(page, updatedItem, reportedCreditCost, latencyMs);
    rowsAdded = discovery.evidence.rowCount;
    discoveryPages.push(discovery.evidence);
    const existing = new Set(candidates.map((candidate) => candidate.candidateId));
    for (const candidate of discovery.candidates) {
      if (existing.has(candidate.candidateId)) continue;
      existing.add(candidate.candidateId);
      candidates.push(candidate);
      work.push(workFromPlan(buildCoveragePlan(candidate)));
    }
    candidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  } else if (page.isLastPage) {
    const pages = loadCompletedPages(paths, updatedItem);
    const normalized = normalizeCompletePages(pages, updatedItem);
    if (normalized.status === "complete") rowsAdded = normalized.rowCount;
    const selected = candidates.find((value) => value.candidateId === item.candidateId);
    if (!selected) throw new Error("Coverage work has no private candidate");
    results = [...results.filter((result) => result.candidateId !== selected.candidateId), compileCoveredCandidate(selected, normalized)];
    results.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  }

  return {
    ...state,
    work,
    candidates,
    results,
    counters: {
      discoveryCalls: state.counters.discoveryCalls + (wasUpstreamCall && item.purpose === "discovery" ? 1 : 0),
      coverageCalls: state.counters.coverageCalls + (wasUpstreamCall && item.purpose === "coverage" ? 1 : 0),
      rows: state.counters.rows + rowsAdded,
    },
    discoveryPages,
  };
}

function appendCoveragePageEvidence(
  state: WorkflowState,
  evidence: CoveragePageEvidence,
): WorkflowState {
  return { ...state, coveragePages: [...state.coveragePages, evidence] };
}

function selectNextWork(state: WorkflowState): WorkItem | undefined {
  const pending = state.work.filter((work) => !work.complete);
  const discoveryCallAvailable = state.counters.discoveryCalls < DISCOVERY_MAX_CALLS;
  const unsampledDiscovery = discoveryCallAvailable
    ? pending.find((work) => work.purpose === "discovery" && work.completedPages.length === 0)
    : undefined;
  if (unsampledDiscovery) return unsampledDiscovery;
  const coverage = pending
    .filter((work) => work.purpose === "coverage")
    .sort(
      (left, right) =>
        left.completedPages.length - right.completedPages.length || left.workId.localeCompare(right.workId),
    )[0];
  if (coverage) return coverage;
  return discoveryCallAvailable
    ? pending
        .filter((work) => work.purpose === "discovery")
        .sort(
          (left, right) =>
            left.completedPages.length - right.completedPages.length || left.workId.localeCompare(right.workId),
      )[0]
    : undefined;
}

function aggregateReport(state: WorkflowState, ledger: AcquisitionLedgerSummary): SanitizedAcquisitionReport {
  const rejectionReasons: Record<string, number> = {};
  const scorable = { buy: 0, sell: 0, noTrade: 0 };
  for (const result of state.results) {
    if (result.compilerResult?.status === "scorable") {
      if (result.compilerResult.answer.action === "buy") scorable.buy += 1;
      else if (result.compilerResult.answer.action === "sell") scorable.sell += 1;
      else scorable.noTrade += 1;
    } else {
      const reason = result.rejectionReason ?? "not-compiled";
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    }
  }
  return buildSanitizedAcquisitionReport({
    reportVersion: 4,
    discoveryCalls: ledger.discoveryAttempts,
    coverageCalls: ledger.coverageAttempts,
    rows: state.counters.rows,
    candidates: state.candidates.length,
    rejectionReasons,
    scorable,
    attempts: ledger.attempts,
    successes: ledger.successful,
    reportedCredits: ledger.reportedCreditsUsed,
    retainedCredits: ledger.retainedCredits,
    discoveryPages: state.discoveryPages,
    coveragePages: state.coveragePages,
  });
}

export function assertAcquisitionPrivatePathsIgnored(paths: AcquisitionPaths): void {
  for (const relative of [".env.local", "data/private/nansen-acquisition", "data/ledgers/nansen-acquisition.json"]) {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", relative], {
      cwd: paths.repositoryRoot,
      stdio: "ignore",
    });
    if (tracked.status === 0) throw new Error(`Live mode is disabled because ${relative} is tracked`);
    if (tracked.status !== 1) throw new Error("Live mode is disabled because Git tracking could not be verified");
    const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", relative], {
      cwd: paths.repositoryRoot,
      stdio: "ignore",
    });
    if (ignored.status !== 0) throw new Error(`Live mode is disabled because ${relative} is not ignored`);
  }
}

export function readAcquisitionApiKey(environmentFile: string): string {
  const text = readCredentialTextFile(environmentFile);
  let environment: ReturnType<typeof parseEnv>;
  try {
    environment = parseEnv(text);
  } catch {
    throw new Error("The canonical credential file could not be parsed safely");
  }
  if (!Object.hasOwn(environment, "NANSEN_API_KEY")) {
    throw new Error("NANSEN_API_KEY is missing from the canonical credential file");
  }
  const key = environment.NANSEN_API_KEY;
  if (typeof key !== "string" || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error("NANSEN_API_KEY in the canonical credential file is invalid");
  }
  return key;
}

export interface AcquisitionFetch {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface AcquisitionRunOptions {
  readonly paths: AcquisitionPaths;
  readonly apiKey: string;
  readonly maxNewCalls: number;
  readonly targetTotalSuccess: 120;
  readonly fetchImpl: AcquisitionFetch;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly createAttemptId?: () => string;
  readonly durabilityHooks?: AcquisitionDurabilityHooks;
}

function classifyStatus(status: number): Exclude<AttemptOutcome, "pending" | "success" | "unexpected-pricing"> {
  if (status === 401) return "authentication-error";
  if (status === 402 || status === 403) return "authorization-or-credit-error";
  if (status === 429) return "rate-limited";
  if ([408, 500, 502, 503, 504].includes(status)) return "transient-error";
  if (status < 200 || status >= 300) return "request-error";
  return "invalid-response";
}

function retryDelay(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return ACQUISITION_MIN_REQUEST_INTERVAL_MS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0 || Object.is(seconds, -0)) return null;
  const delay = Math.max(ACQUISITION_MIN_REQUEST_INTERVAL_MS, Math.ceil(seconds * 1_000));
  return delay <= ACQUISITION_MAX_RETRY_AFTER_MS ? delay : null;
}

async function withAcquisitionLock<T>(paths: AcquisitionPaths, now: () => Date, operation: () => Promise<T>): Promise<T> {
  let lock: ReturnType<typeof acquireContractSpikeLock>;
  try {
    lock = acquireContractSpikeLock(paths.lock, now);
  } catch {
    throw new Error("Acquisition lock is already held or unsafe; live mode remains disabled");
  }
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      lock.release();
    } catch {
      const releaseError = new Error("Acquisition lock could not be released safely");
      if (operationError !== undefined) {
        throw new AggregateError([operationError, releaseError], "Acquisition failed and its lock could not be released safely");
      }
      throw releaseError;
    }
  }
}

const REPROCESS_REJECTION_REASONS: readonly DiscoveryValidationReason[] = [
  "action-invalid",
  "duplicate-row",
  "timestamp-precision-or-value-invalid",
  "token-address-mismatch",
  "transaction-hash-invalid",
  "usd-value-invalid",
  "wallet-address-invalid",
];

function buildSanitizedReprocessingReport(input: CacheReprocessingReport): CacheReprocessingReport {
  const count = (value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Reprocessing aggregate count is invalid");
    return value;
  };
  return {
    reprocessingVersion: 1,
    mode: "reprocess-cache",
    cachePagesReprocessed: count(input.cachePagesReprocessed),
    rowsExamined: count(input.rowsExamined),
    validRows: count(input.validRows),
    invalidRows: count(input.invalidRows),
    timestampPrecision: {
      wholeSecond: count(input.timestampPrecision.wholeSecond),
      exactMillisecond: count(input.timestampPrecision.exactMillisecond),
    },
    qualifyingRows: count(input.qualifyingRows),
    distinctCandidates: count(input.distinctCandidates),
    rejectionCounts: Object.fromEntries(
      REPROCESS_REJECTION_REASONS.map((reason) => [reason, count(input.rejectionCounts[reason] ?? 0)]),
    ) as Record<DiscoveryValidationReason, number>,
    coverageWorkItemsPlanned: count(input.coverageWorkItemsPlanned),
    networkAttempts: 0,
    newLedgerAttempts: 0,
    newLedgerSuccesses: 0,
    newCredits: 0,
  };
}

function validateLegacyLedgerForReprocessing(path: string): Map<string, AcquisitionAttempt> {
  const summary = summarizeAcquisitionLedger(path);
  if (
    summary.attempts !== 6 ||
    summary.discoveryAttempts !== 6 ||
    summary.coverageAttempts !== 0 ||
    summary.settled !== 6 ||
    summary.successful !== 6 ||
    summary.reportedCreditsUsed !== 6 ||
    summary.unknownChargeAttempts !== 0 ||
    summary.retainedCredits !== 6 ||
    summary.combinedSuccessfulCalls !== 9
  ) {
    throw new Error("Acquisition ledger does not match the reviewed six-attempt provenance");
  }
  const latest = latestAttempts(readLedger(path));
  if (
    latest.some(
      (attempt) =>
        attempt.phase !== "settled" ||
        attempt.purpose !== "discovery" ||
        attempt.outcome !== "success" ||
        attempt.reportedCreditCost !== 1 ||
        attempt.reportedCreditsUsed !== 1 ||
        attempt.retainedCredits !== 1 ||
        attempt.failureReason !== null,
    )
  ) {
    throw new Error("Acquisition ledger settlements do not match the reviewed provenance");
  }
  return new Map(latest.map((attempt) => [attempt.attemptId, attempt]));
}

function listPrivateCacheEntries(path: string): Dirent<string>[] {
  assertSafeExistingPrivateDirectory(path);
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(path, { withFileTypes: true, encoding: "utf8" });
  } catch {
    throw new Error("Private acquisition cache could not be listed safely");
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f]{64}\.json$/.test(entry.name))) {
    throw new Error("Private acquisition cache contains an unknown or unsafe entry");
  }
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

interface PreparedReprocessing {
  readonly state: WorkflowState;
  readonly caches: readonly { readonly fingerprint: string; readonly value: CachedPage }[];
  readonly manifest: ReprocessingManifestV4;
  readonly report: CacheReprocessingReport;
}

function prepareCacheReprocessing(
  paths: AcquisitionPaths,
  legacyState: LegacyWorkflowStateV3,
  ledgerAttempts: ReadonlyMap<string, AcquisitionAttempt>,
  reprocessedAtMs: number,
): PreparedReprocessing {
  if (!Number.isSafeInteger(reprocessedAtMs) || reprocessedAtMs < 0) {
    throw new Error("Cache reprocessing time is invalid");
  }
  const legacyEntries = listPrivateCacheEntries(paths.legacyCacheDirectory);
  const references = legacyState.work.flatMap((work) => work.completedPages);
  if (legacyEntries.length !== 6 || references.length !== 6) {
    throw new Error("Legacy discovery cache does not contain exactly six reviewed pages");
  }
  const expectedFiles = new Set(references.map((reference) => `${reference.fingerprint}.json`));
  if (legacyEntries.some((entry) => !expectedFiles.has(entry.name)) || expectedFiles.size !== 6) {
    throw new Error("Legacy discovery cache does not match state provenance");
  }

  const expectedPlans = buildDiscoveryPlan(legacyState.initializedAtMs);
  const legacyWork = [...legacyState.work].sort((left, right) => left.localFromMs - right.localFromMs);
  const orderedPlans = [...expectedPlans].sort((left, right) => left.localFromMs - right.localFromMs);
  let state: WorkflowState = {
    ...createWorkflowState(legacyState.initializedAtMs),
    provenance: {
      kind: "reprocessed-v3-discovery",
      reprocessedAtMs,
      sourceStateVersion: 3,
      sourceAttemptIds: [],
    },
  };
  const caches: Array<{ fingerprint: string; value: CachedPage }> = [];
  const manifestPages: ReprocessingManifestV4["pages"][number][] = [];
  const sourceAttemptIds: string[] = [];
  let wholeSecond = 0;
  let exactMillisecond = 0;

  for (const [workIndex, oldWork] of legacyWork.entries()) {
    const basePlan = orderedPlans[workIndex];
    if (
      !basePlan ||
      oldWork.localFromMs !== basePlan.localFromMs ||
      oldWork.localToMsExclusive !== basePlan.localToMsExclusive ||
      oldWork.token.address !== basePlan.token.address ||
      oldWork.workId !== `discovery-${legacyAcquisitionRequestFingerprintV3(basePlan.request, "discovery").slice(0, 24)}`
    ) {
      throw new Error("Legacy discovery work does not match the deterministic version-3 plan");
    }

    for (const reference of [...oldWork.completedPages].sort((left, right) => left.page - right.page)) {
      const currentWork = state.work.find(
        (work) =>
          work.purpose === "discovery" &&
          work.localFromMs === oldWork.localFromMs &&
          work.localToMsExclusive === oldWork.localToMsExclusive,
      );
      if (!currentWork || currentWork.nextPage !== reference.page) {
        throw new Error("Version-4 discovery reconstruction is out of sequence");
      }
      const request = buildAcquisitionRequest(
        currentWork.token,
        currentWork.localFromMs,
        currentWork.localToMsExclusive,
        reference.page,
      );
      const sourceFingerprint = legacyAcquisitionRequestFingerprintV3(request, "discovery");
      if (reference.fingerprint !== sourceFingerprint) {
        throw new Error("Legacy discovery fingerprint does not match version-3 semantics");
      }
      const source = readLegacyCachedPageV3(
        join(paths.legacyCacheDirectory, `${sourceFingerprint}.json`),
        sourceFingerprint,
      );
      if (source.requestId !== reference.requestId) {
        throw new Error("Legacy cache request identity does not match state provenance");
      }
      const ledgerAttempt = ledgerAttempts.get(source.requestId);
      if (
        !ledgerAttempt ||
        ledgerAttempt.requestFingerprint !== sourceFingerprint ||
        ledgerAttempt.page !== reference.page
      ) {
        throw new Error("Legacy cache request identity does not match ledger provenance");
      }
      const planned: PlannedRequest = { ...planFromWork(currentWork), request };
      const parsed = parseProviderPage(source.response, planned, source.requestId, source.retrievalTimeMs);
      if (parsed.status !== "valid") throw new Error(`Legacy cached page is invalid: ${parsed.reason}`);
      const precisions = parsed.page.rows.map((row) => normalizeProviderTimestamp(row.block_timestamp)?.sourcePrecision ?? null);
      wholeSecond += precisions.filter((precision) => precision === "whole-second").length;
      exactMillisecond += precisions.filter((precision) => precision === "exact-millisecond").length;
      const derivedFingerprint = parsed.page.requestFingerprint;
      const derived: CachedPage = {
        cacheVersion: 4,
        fingerprint: derivedFingerprint,
        retrievalTimeMs: source.retrievalTimeMs,
        requestId: source.requestId,
        reportedCreditCost: source.reportedCreditCost,
        latencyMs: source.latencyMs,
        sourceTimestampPrecisions: precisions,
        provenance: {
          kind: "reprocessed-v3-cache",
          sourceAttemptId: source.requestId,
          sourceFingerprint,
          sourceCacheVersion: 3,
        },
        response: source.response,
      };
      caches.push({ fingerprint: derivedFingerprint, value: derived });
      manifestPages.push({
        sourceFingerprint,
        derivedFingerprint,
        sourceAttemptId: source.requestId,
        page: reference.page,
      });
      sourceAttemptIds.push(source.requestId);
      state = updateAfterPage(state, currentWork, parsed.page, paths, true, source.reportedCreditCost, source.latencyMs);
    }
  }

  if (state.counters.discoveryCalls !== 6 || state.counters.coverageCalls !== 0 || state.counters.rows !== 600) {
    throw new Error("Reprocessed discovery state does not preserve the reviewed source counts");
  }
  state = {
    ...state,
    provenance: {
      kind: "reprocessed-v3-discovery",
      reprocessedAtMs,
      sourceStateVersion: 3,
      sourceAttemptIds,
    },
  };
  const rejectionCounts = Object.fromEntries(
    REPROCESS_REJECTION_REASONS.map((reason) => [
      reason,
      state.discoveryPages.reduce((sum, page) => sum + (page.validationRejections[reason] ?? 0), 0),
    ]),
  ) as Record<DiscoveryValidationReason, number>;
  const report = buildSanitizedReprocessingReport({
    reprocessingVersion: 1,
    mode: "reprocess-cache",
    cachePagesReprocessed: caches.length,
    rowsExamined: state.discoveryPages.reduce((sum, page) => sum + page.rowCount, 0),
    validRows: state.discoveryPages.reduce((sum, page) => sum + page.validRowCount, 0),
    invalidRows: state.discoveryPages.reduce((sum, page) => sum + page.invalidRowCount, 0),
    timestampPrecision: { wholeSecond, exactMillisecond },
    qualifyingRows: state.discoveryPages.reduce((sum, page) => sum + page.qualifyingRows, 0),
    distinctCandidates: state.candidates.length,
    rejectionCounts,
    coverageWorkItemsPlanned: state.work.filter((work) => work.purpose === "coverage").length,
    networkAttempts: 0,
    newLedgerAttempts: 0,
    newLedgerSuccesses: 0,
    newCredits: 0,
  });
  const manifest: ReprocessingManifestV4 = {
    manifestVersion: 1,
    adapterVersion: "4",
    stateVersion: 4,
    schemaVersion: 4,
    sourceStateVersion: 3,
    sourceCacheVersion: 3,
    reprocessedAtMs,
    sourceAttemptIds,
    pages: manifestPages,
    report,
  };
  return { state, caches, manifest, report };
}

function validateExistingReprocessing(paths: AcquisitionPaths, prepared: PreparedReprocessing, storedManifest: unknown): void {
  if (JSON.stringify(storedManifest) !== JSON.stringify(prepared.manifest)) {
    throw new Error("Existing cache-reprocessing manifest does not match source provenance");
  }
  const storedState = readPrivateJson(paths.state);
  if (!validateState(storedState) || JSON.stringify(storedState) !== JSON.stringify(prepared.state)) {
    throw new Error("Existing reprocessed state is malformed or does not match provenance");
  }
  const entries = listPrivateCacheEntries(paths.cacheDirectory);
  if (entries.length !== prepared.caches.length) throw new Error("Existing reprocessed cache is incomplete");
  const expectedFiles = new Set(prepared.caches.map((cache) => `${cache.fingerprint}.json`));
  if (entries.some((entry) => !expectedFiles.has(entry.name))) {
    throw new Error("Existing reprocessed cache contains unexpected evidence");
  }
  for (const cache of prepared.caches) {
    const stored = readPrivateJson(join(paths.cacheDirectory, `${cache.fingerprint}.json`));
    if (JSON.stringify(stored) !== JSON.stringify(cache.value)) {
      throw new Error("Existing reprocessed cache does not match source provenance");
    }
  }
}

async function reprocessLegacyDiscoveryCache(
  paths: AcquisitionPaths,
  now: () => Date,
  durabilityHooks: AcquisitionDurabilityHooks = {},
): Promise<CacheReprocessingReport> {
  return withAcquisitionLock(paths, now, async () => {
    const ledgerAttempts = validateLegacyLedgerForReprocessing(paths.ledger);
    const legacyState = readLegacyStateV3(paths);
    const storedManifest = readPrivateJson(paths.reprocessingManifest);
    let reprocessedAtMs: number;
    if (storedManifest === null) {
      if (
        pathExistsWithoutFollowing(paths.state) ||
        pathExistsWithoutFollowing(paths.cacheDirectory) ||
        pathExistsWithoutFollowing(paths.candidateManifest) ||
        pathExistsWithoutFollowing(paths.aggregateReport)
      ) {
        throw new Error("Partial or unexpected version-4 acquisition outputs require manual review");
      }
      reprocessedAtMs = now().getTime();
    } else {
      if (!isRecord(storedManifest) || !Number.isSafeInteger(storedManifest.reprocessedAtMs)) {
        throw new Error("Existing cache-reprocessing manifest is malformed");
      }
      reprocessedAtMs = storedManifest.reprocessedAtMs as number;
    }

    const prepared = prepareCacheReprocessing(paths, legacyState, ledgerAttempts, reprocessedAtMs);
    if (storedManifest !== null) {
      validateExistingReprocessing(paths, prepared, storedManifest);
      return prepared.report;
    }

    for (const cache of prepared.caches) {
      writePrivateJsonAtomic(
        join(paths.cacheDirectory, `${cache.fingerprint}.json`),
        cache.value,
        durabilityHooks,
      );
    }
    writePrivateJsonAtomic(paths.state, prepared.state, durabilityHooks);
    writePrivateJsonAtomic(paths.reprocessingManifest, prepared.manifest, durabilityHooks);
    return prepared.report;
  });
}

export interface AcquisitionRunResult {
  readonly mode: "live";
  readonly networkAttempts: number;
  readonly cacheHits: number;
  readonly ledger: AcquisitionLedgerSummary;
  readonly report: SanitizedAcquisitionReport;
  readonly stoppedBecause: "per-run-limit" | "target-reached" | "work-complete";
}

export async function runLiveAcquisition(options: AcquisitionRunOptions): Promise<AcquisitionRunResult> {
  if (!/^[\x21-\x7e]+$/.test(options.apiKey)) throw new Error("NANSEN_API_KEY is malformed; no request was attempted");
  if (!Number.isSafeInteger(options.maxNewCalls) || options.maxNewCalls < 1 || options.maxNewCalls > 10) {
    throw new Error("Per-run call limit is invalid");
  }
  if (options.targetTotalSuccess !== INTERNAL_TOTAL_SUCCESS_TARGET) {
    throw new Error("Combined success target is not the reviewed value");
  }
  assertAcquisitionEndpoint(NANSEN_DEX_TRADES_ENDPOINT);
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));

  return withAcquisitionLock(options.paths, now, async () => {
    const ledger = new AcquisitionLedger(
      options.paths.ledger,
      now,
      options.createAttemptId,
      options.durabilityHooks,
    );
    const opening = ledger.summarize();
    const remainingAttempts = ACQUISITION_MAX_ATTEMPTS - opening.attempts;
    const remainingCredits = ACQUISITION_MAX_RETAINED_CREDITS - opening.retainedCredits;
    if (options.maxNewCalls > remainingAttempts || options.maxNewCalls > remainingCredits) {
      throw new Error("Per-run limit exceeds the remaining global attempt or retained-credit allowance");
    }
    let state = readState(options.paths, now().getTime());
    writePrivateJsonAtomic(options.paths.state, state, options.durabilityHooks);
    let networkAttempts = 0;
    let cacheHits = 0;
    let lastAttemptStarted: number | null = null;
    let stoppedBecause: AcquisitionRunResult["stoppedBecause"] = "work-complete";

    while (true) {
      if (ledger.summarize().combinedSuccessfulCalls >= options.targetTotalSuccess) {
        stoppedBecause = "target-reached";
        break;
      }
      const item = selectNextWork(state);
      if (!item) break;
      const planned = planFromWork(item);
      const fingerprint = acquisitionRequestFingerprint(planned.request, planned.purpose);
      const cached = readCachedPage(options.paths, fingerprint);
      if (cached) {
        const parsed = parseProviderPage(cached.response, planned, cached.requestId, cached.retrievalTimeMs);
        if (parsed.status !== "valid") throw new Error(`cached-page-${parsed.reason}`);
        if (planned.purpose === "coverage") {
          const validation = validateCoveragePage(
            parsed.page,
            planned,
            cached.reportedCreditCost,
            cached.latencyMs,
          );
          state = appendCoveragePageEvidence(state, validation.evidence);
          writePrivateJsonAtomic(options.paths.state, state, options.durabilityHooks);
          if (validation.status === "rejected") {
            writePrivateJsonAtomic(
              options.paths.aggregateReport,
              aggregateReport(state, ledger.summarize()),
              options.durabilityHooks,
            );
            throw new Error(`Acquisition stopped after cached coverage-page rejection: ${validation.reason}`);
          }
        }
        state = updateAfterPage(
          state,
          item,
          parsed.page,
          options.paths,
          false,
          cached.reportedCreditCost,
          cached.latencyMs,
        );
        writePrivateJsonAtomic(options.paths.state, state, options.durabilityHooks);
        cacheHits += 1;
        continue;
      }
      const history = ledger.requestHistory(fingerprint);
      if (history !== "none") {
        throw new Error(
          history === "successful"
            ? "A successful request is missing its cache; refusing a duplicate upstream call"
            : "A prior or pending attempt lacks reusable evidence; refusing an uncertain repeat",
        );
      }
      if (networkAttempts >= options.maxNewCalls) {
        stoppedBecause = "per-run-limit";
        break;
      }
      if (planned.purpose === "discovery" && ledger.summarize().discoveryAttempts >= DISCOVERY_MAX_CALLS) {
        break;
      }

      let retryCount = 0;
      while (true) {
        if (networkAttempts >= options.maxNewCalls) {
          stoppedBecause = "per-run-limit";
          break;
        }
        const current = ledger.summarize();
        if (current.attempts >= ACQUISITION_MAX_ATTEMPTS || current.retainedCredits >= ACQUISITION_MAX_RETAINED_CREDITS) {
          throw new Error("Global acquisition allowance is exhausted");
        }
        if (planned.purpose === "discovery" && current.discoveryAttempts >= DISCOVERY_MAX_CALLS) {
          throw new Error("Acquisition stopped at the discovery sampling call cap");
        }
        if (lastAttemptStarted !== null) {
          const wait = ACQUISITION_MIN_REQUEST_INTERVAL_MS - (monotonicNow() - lastAttemptStarted);
          if (wait > 0) await sleep(wait);
        }
        const reservation = ledger.reserve(planned);
        networkAttempts += 1;
        const attemptStartedAt = monotonicNow();
        lastAttemptStarted = attemptStartedAt;
        let response: Response | null = null;
        let rawBody = "";
        let reportedCreditCost: number | null = null;
        let reportedCreditsUsed: number | null = null;
        let outcome: Exclude<AttemptOutcome, "pending"> = "request-error";
        let parsedPage: ProviderPage | null = null;
        let latencyMs = 0;
        let coverageValidation: ReturnType<typeof validateCoveragePage> | null = null;

        try {
          response = await options.fetchImpl(NANSEN_DEX_TRADES_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json", apikey: options.apiKey },
            body: JSON.stringify(planned.request),
            redirect: "error",
            signal: AbortSignal.timeout(ACQUISITION_REQUEST_TIMEOUT_MS),
          });
          reportedCreditCost = parseNonnegativeHeader(response.headers.get("x-nansen-credits-cost"));
          reportedCreditsUsed = parseNonnegativeHeader(response.headers.get("x-nansen-credits-used"));
          rawBody = await response.text();
          let decoded: unknown = null;
          try {
            decoded = JSON.parse(rawBody) as unknown;
          } catch {
            decoded = null;
          }
          const parsed = parseProviderPage(decoded, planned, reservation.attemptId, now().getTime());
          if (response.status >= 200 && response.status < 300 && parsed.status === "valid") {
            parsedPage = parsed.page;
            outcome = "success";
          } else {
            outcome = classifyStatus(response.status);
          }
          if (
            outcome === "success" &&
            (reportedCreditCost !== ACQUISITION_EXPECTED_CREDIT_COST ||
              reportedCreditsUsed !== ACQUISITION_EXPECTED_CREDIT_COST)
          ) {
            outcome = "unexpected-pricing";
          }
          writePrivateTextFileExclusive(join(options.paths.rawDirectory, `${reservation.attemptId}.json`), rawBody);
        } catch {
          outcome = "request-error";
        } finally {
          latencyMs = Math.max(0, monotonicNow() - attemptStartedAt);
        }

        if (parsedPage && planned.purpose === "coverage") {
          coverageValidation = validateCoveragePage(parsedPage, planned, reportedCreditCost, latencyMs);
          if (coverageValidation.status === "rejected") outcome = "invalid-response";
        }

        ledger.settle(reservation, {
          httpStatus: response?.status ?? null,
          reportedCreditCost,
          reportedCreditsUsed,
          outcome,
          failureReason: coverageValidation?.status === "rejected" ? coverageValidation.reason : null,
        });
        if (coverageValidation) {
          state = appendCoveragePageEvidence(state, coverageValidation.evidence);
          writePrivateJsonAtomic(options.paths.state, state, options.durabilityHooks);
          if (coverageValidation.status === "rejected") {
            writePrivateJsonAtomic(
              options.paths.aggregateReport,
              aggregateReport(state, ledger.summarize()),
              options.durabilityHooks,
            );
            throw new Error(`Acquisition stopped after coverage-page rejection: ${coverageValidation.reason}`);
          }
        }
        if (outcome === "success" && parsedPage) {
          const cachedPage: CachedPage = {
            cacheVersion: 4,
            fingerprint,
            retrievalTimeMs: parsedPage.retrievalTimeMs,
            requestId: reservation.attemptId,
            reportedCreditCost,
            latencyMs,
            sourceTimestampPrecisions: parsedPage.rows.map(
              (row) => normalizeProviderTimestamp(row.block_timestamp)?.sourcePrecision ?? null,
            ),
            provenance: { kind: "provider-response" },
            response: JSON.parse(rawBody) as unknown,
          };
          writePrivateJsonAtomic(cachePath(options.paths, fingerprint), cachedPage, options.durabilityHooks);
          state = updateAfterPage(
            state,
            item,
            parsedPage,
            options.paths,
            true,
            reportedCreditCost,
            latencyMs,
          );
          writePrivateJsonAtomic(options.paths.state, state, options.durabilityHooks);
          break;
        }
        if (outcome === "authentication-error" || outcome === "authorization-or-credit-error") {
          throw new Error("Acquisition stopped after authentication, authorization, plan, payment, or credit failure");
        }
        if (outcome === "unexpected-pricing") throw new Error("Acquisition stopped after missing, malformed, or unexpected pricing");
        if (outcome !== "rate-limited" && outcome !== "transient-error") {
          throw new Error("Acquisition stopped after a non-retryable provider or storage failure");
        }
        if (retryCount >= ACQUISITION_MAX_RETRIES_PER_REQUEST || networkAttempts >= options.maxNewCalls) {
          throw new Error("Acquisition stopped at its bounded retry or per-run attempt limit");
        }
        const delay = response ? retryDelay(response) : null;
        if (delay === null) throw new Error("Retry-After is invalid or exceeds the bounded delay");
        retryCount += 1;
        await sleep(delay);
      }
      if (stoppedBecause === "per-run-limit") break;
    }

    const finalLedger = ledger.summarize();
    const report = aggregateReport(state, finalLedger);
    writePrivateJsonAtomic(options.paths.candidateManifest, {
      manifestVersion: 4,
      adapterVersion: ACQUISITION_ADAPTER_VERSION,
      rulesVersion: "4",
      candidates: state.results,
    }, options.durabilityHooks);
    writePrivateJsonAtomic(options.paths.aggregateReport, report, options.durabilityHooks);
    return { mode: "live", networkAttempts, cacheHits, ledger: finalLedger, report, stoppedBecause };
  });
}

export type AcquisitionCommandResult =
  | {
      readonly mode: "dry-run";
      readonly networkRequestSent: false;
      readonly plan: {
        readonly endpoint: typeof NANSEN_DEX_TRADES_ENDPOINT;
        readonly tokens: readonly string[];
        readonly globalAttemptCap: 130;
        readonly globalRetainedCreditCap: 130;
        readonly expectedCreditCost: 1;
        readonly contractSpikeSuccesses: 3;
        readonly acquisitionSuccessTarget: 117;
        readonly combinedSuccessTarget: 120;
      };
    }
  | { readonly mode: "status"; readonly networkRequestSent: false; readonly ledger: AcquisitionLedgerSummary }
  | CacheDiagnosticReport
  | CacheReprocessingReport
  | AcquisitionRunResult;

export interface AcquisitionCommandOptions {
  readonly paths?: AcquisitionPaths;
  readonly fetchImpl?: AcquisitionFetch;
  readonly readKey?: (path: string) => string;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly createAttemptId?: () => string;
  readonly durabilityHooks?: AcquisitionDurabilityHooks;
}

export async function runAcquisitionCommand(
  arguments_: readonly string[],
  options: AcquisitionCommandOptions = {},
): Promise<AcquisitionCommandResult> {
  const command = parseAcquisitionArguments(arguments_);
  const paths = options.paths ?? resolveAcquisitionPaths();
  if (command.mode === "dry-run") {
    return {
      mode: "dry-run",
      networkRequestSent: false,
      plan: {
        endpoint: NANSEN_DEX_TRADES_ENDPOINT,
        tokens: ACQUISITION_TOKEN_UNIVERSE.map((token) => token.symbol),
        globalAttemptCap: ACQUISITION_MAX_ATTEMPTS,
        globalRetainedCreditCap: ACQUISITION_MAX_RETAINED_CREDITS,
        expectedCreditCost: ACQUISITION_EXPECTED_CREDIT_COST,
        contractSpikeSuccesses: CONTRACT_SPIKE_SUCCESSES,
        acquisitionSuccessTarget: MAX_ACQUISITION_SUCCESSES,
        combinedSuccessTarget: INTERNAL_TOTAL_SUCCESS_TARGET,
      },
    };
  }
  if (command.mode === "status") {
    return { mode: "status", networkRequestSent: false, ledger: summarizeAcquisitionLedger(paths.ledger) };
  }
  if (command.mode === "diagnose-cache") {
    return diagnoseCanonicalDiscoveryCache({
      repositoryRoot: paths.repositoryRoot,
      state: paths.legacyState,
      cacheDirectory: paths.legacyCacheDirectory,
    });
  }
  if (command.mode === "reprocess-cache") {
    return reprocessLegacyDiscoveryCache(paths, options.now ?? (() => new Date()), options.durabilityHooks);
  }
  assertAcquisitionPrivatePathsIgnored(paths);
  const readKey = options.readKey ?? readAcquisitionApiKey;
  return runLiveAcquisition({
    paths,
    apiKey: readKey(paths.environmentFile),
    maxNewCalls: command.maxNewCalls,
    targetTotalSuccess: command.targetTotalSuccess,
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now,
    monotonicNow: options.monotonicNow,
    sleep: options.sleep,
    createAttemptId: options.createAttemptId,
    durabilityHooks: options.durabilityHooks,
  });
}
