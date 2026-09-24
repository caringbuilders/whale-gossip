import "server-only";

import { randomUUID } from "node:crypto";
import { lstatSync, renameSync, unlinkSync } from "node:fs";
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
  ACQUISITION_TOKEN_UNIVERSE,
  CONTRACT_SPIKE_SUCCESSES,
  INTERNAL_TOTAL_SUCCESS_TARGET,
  MAX_ACQUISITION_SUCCESSES,
  assertAcquisitionEndpoint,
  acquisitionRequestFingerprint,
  buildAcquisitionRequest,
  buildCoveragePlan,
  buildDiscoveryPlan,
  compileCoveredCandidate,
  discoverCandidates,
  normalizeCompletePages,
  parseProviderPage,
  type AcquisitionToken,
  type DiscoveredCandidate,
  type PlannedRequest,
  type PrivateCandidateRecord,
  type ProviderPage,
  type SanitizedAcquisitionReport,
} from "./nansen-acquisition";
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
  readonly state: string;
  readonly rawDirectory: string;
  readonly cacheDirectory: string;
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
    state: join(privateRoot, "state.json"),
    rawDirectory: join(privateRoot, "raw"),
    cacheDirectory: join(privateRoot, "cache-v1"),
    candidateManifest: join(privateRoot, "candidate-manifest.json"),
    aggregateReport: join(privateRoot, "aggregate-report.json"),
  };
}

export type AcquisitionCommand =
  | { readonly mode: "dry-run" }
  | { readonly mode: "status" }
  | { readonly mode: "live"; readonly maxNewCalls: number; readonly targetTotalSuccess: 120 };

export function parseAcquisitionArguments(arguments_: readonly string[]): AcquisitionCommand {
  if (arguments_.length === 0) return { mode: "dry-run" };
  if (arguments_.length === 1 && arguments_[0] === "--status") return { mode: "status" };
  if (
    arguments_.length === 5 &&
    arguments_[0] === "--live" &&
    arguments_[1] === "--max-new-calls" &&
    arguments_[3] === "--target-total-success"
  ) {
    const maxNewCalls = Number(arguments_[2]);
    const targetTotalSuccess = Number(arguments_[4]);
    if (!Number.isSafeInteger(maxNewCalls) || maxNewCalls < 1 || maxNewCalls > ACQUISITION_MAX_ATTEMPTS) {
      throw new Error("--max-new-calls must be an integer from 1 through 130");
    }
    if (targetTotalSuccess !== INTERNAL_TOTAL_SUCCESS_TARGET) {
      throw new Error("--target-total-success must equal the reviewed target of 120");
    }
    return { mode: "live", maxNewCalls, targetTotalSuccess: INTERNAL_TOTAL_SUCCESS_TARGET };
  }
  throw new Error(
    "Unsupported arguments; use no arguments, --status, or --live --max-new-calls N --target-total-success 120",
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
}

interface AcquisitionLedgerFile {
  readonly ledgerVersion: 1;
  readonly attempts: readonly AcquisitionAttempt[];
}

export interface AcquisitionLedgerSummary {
  readonly attempts: number;
  readonly settled: number;
  readonly successful: number;
  readonly reportedCreditsUsed: number;
  readonly unknownChargeAttempts: number;
  readonly retainedCredits: number;
  readonly combinedSuccessfulCalls: number;
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

function writePrivateJsonAtomic(path: string, value: unknown): void {
  ensurePrivateDirectory(dirname(path));
  if (pathExistsWithoutFollowing(path)) assertSafeExistingPrivateFile(path);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writePrivateTextFileExclusive(temporary, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(temporary, path);
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
    Number.isFinite(Date.parse(value.recordedAt));
  if (!common) return false;
  if (value.phase === "reserved") {
    return (
      value.retainedCredits === 1 &&
      value.httpStatus === null &&
      value.reportedCreditCost === null &&
      value.reportedCreditsUsed === null &&
      value.outcome === "pending"
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
    ].includes(String(value.outcome))
  );
}

function readLedger(path: string): AcquisitionLedgerFile {
  const value = readPrivateJson(path);
  if (value === null) return { ledgerVersion: 1, attempts: [] };
  if (!isRecord(value) || value.ledgerVersion !== 1 || !Array.isArray(value.attempts) || !value.attempts.every(validateAttempt)) {
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
  return {
    attempts: latest.length,
    settled: settled.length,
    successful,
    reportedCreditsUsed: settled.reduce((sum, attempt) => sum + (attempt.reportedCreditsUsed ?? 0), 0),
    unknownChargeAttempts: settled.filter((attempt) => attempt.reportedCreditsUsed === null).length,
    retainedCredits: latest.reduce((sum, attempt) => sum + attempt.retainedCredits, 0),
    combinedSuccessfulCalls: CONTRACT_SPIKE_SUCCESSES + successful,
  };
}

export class AcquisitionLedger {
  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
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
      requestFingerprint: acquisitionRequestFingerprint(planned.request),
      purpose: planned.purpose,
      page: planned.request.pagination.page,
      reservedCredits: 1,
      retainedCredits: 1,
      recordedAt: this.now().toISOString(),
      httpStatus: null,
      reportedCreditCost: null,
      reportedCreditsUsed: null,
      outcome: "pending",
    };
    writePrivateJsonAtomic(this.path, { ...ledger, attempts: [...ledger.attempts, reservation] });
    return reservation;
  }

  settle(
    reservation: AcquisitionAttempt,
    result: {
      readonly httpStatus: number | null;
      readonly reportedCreditCost: number | null;
      readonly reportedCreditsUsed: number | null;
      readonly outcome: Exclude<AttemptOutcome, "pending">;
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
    };
    writePrivateJsonAtomic(this.path, { ...ledger, attempts: [...ledger.attempts, settlement] });
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
  readonly token: AcquisitionToken;
  readonly wallet: string | null;
  readonly cutoffMs: number | null;
  readonly localFromMs: number;
  readonly localToMsExclusive: number;
  readonly nextPage: number;
  readonly completedPages: readonly PageReference[];
  readonly complete: boolean;
}

interface WorkflowState {
  readonly stateVersion: 1;
  readonly adapterVersion: typeof ACQUISITION_ADAPTER_VERSION;
  readonly schemaVersion: typeof ACQUISITION_SCHEMA_VERSION;
  readonly initializedAtMs: number;
  readonly work: readonly WorkItem[];
  readonly candidates: readonly DiscoveredCandidate[];
  readonly results: readonly PrivateCandidateRecord[];
  readonly counters: { readonly discoveryCalls: number; readonly coverageCalls: number; readonly rows: number };
}

interface CachedPage {
  readonly cacheVersion: 1;
  readonly fingerprint: string;
  readonly retrievalTimeMs: number;
  readonly requestId: string;
  readonly response: unknown;
}

function planFromWork(item: WorkItem): PlannedRequest {
  return {
    purpose: item.purpose,
    token: item.token,
    wallet: item.wallet,
    cutoffMs: item.cutoffMs,
    localFromMs: item.localFromMs,
    localToMsExclusive: item.localToMsExclusive,
    request: buildAcquisitionRequest(item.token, item.localFromMs, item.localToMsExclusive, item.nextPage),
  };
}

function workFromPlan(plan: PlannedRequest): WorkItem {
  return {
    workId: `${plan.purpose}-${acquisitionRequestFingerprint(plan.request).slice(0, 24)}`,
    purpose: plan.purpose,
    token: plan.token,
    wallet: plan.wallet,
    cutoffMs: plan.cutoffMs,
    localFromMs: plan.localFromMs,
    localToMsExclusive: plan.localToMsExclusive,
    nextPage: 1,
    completedPages: [],
    complete: false,
  };
}

function createWorkflowState(nowMs: number): WorkflowState {
  return {
    stateVersion: 1,
    adapterVersion: ACQUISITION_ADAPTER_VERSION,
    schemaVersion: ACQUISITION_SCHEMA_VERSION,
    initializedAtMs: nowMs,
    work: buildDiscoveryPlan(nowMs).map(workFromPlan),
    candidates: [],
    results: [],
    counters: { discoveryCalls: 0, coverageCalls: 0, rows: 0 },
  };
}

function validateState(value: unknown): value is WorkflowState {
  return (
    isRecord(value) &&
    value.stateVersion === 1 &&
    value.adapterVersion === ACQUISITION_ADAPTER_VERSION &&
    value.schemaVersion === ACQUISITION_SCHEMA_VERSION &&
    typeof value.initializedAtMs === "number" &&
    Number.isSafeInteger(value.initializedAtMs) &&
    Array.isArray(value.work) &&
    Array.isArray(value.candidates) &&
    Array.isArray(value.results) &&
    isRecord(value.counters)
  );
}

function readState(paths: AcquisitionPaths, nowMs: number): WorkflowState {
  const value = readPrivateJson(paths.state);
  if (value === null) return createWorkflowState(nowMs);
  if (!validateState(value)) throw new Error("Acquisition workflow state is malformed or version-mismatched");
  return value;
}

function cachePath(paths: AcquisitionPaths, fingerprint: string): string {
  return join(paths.cacheDirectory, `${fingerprint}.json`);
}

function readCachedPage(paths: AcquisitionPaths, fingerprint: string): CachedPage | null {
  const value = readPrivateJson(cachePath(paths, fingerprint));
  if (value === null) return null;
  if (
    !isRecord(value) ||
    value.cacheVersion !== 1 ||
    value.fingerprint !== fingerprint ||
    typeof value.retrievalTimeMs !== "number" ||
    !Number.isSafeInteger(value.retrievalTimeMs) ||
    typeof value.requestId !== "string" ||
    !("response" in value)
  ) {
    throw new Error("Acquisition cache is malformed or mismatched");
  }
  return value as unknown as CachedPage;
}

function loadCompletedPages(paths: AcquisitionPaths, item: WorkItem): ProviderPage[] {
  return item.completedPages.map((reference) => {
    const cached = readCachedPage(paths, reference.fingerprint);
    if (!cached || cached.requestId !== reference.requestId) throw new Error("Acquisition cache page is missing");
    const pagePlan: PlannedRequest = {
      ...planFromWork({ ...item, nextPage: reference.page }),
      request: buildAcquisitionRequest(item.token, item.localFromMs, item.localToMsExclusive, reference.page),
    };
    const parsed = parseProviderPage(cached.response, pagePlan, cached.requestId, cached.retrievalTimeMs);
    if (parsed.status !== "valid") throw new Error("Cached acquisition page no longer validates");
    return parsed.page;
  });
}

function updateAfterPage(
  state: WorkflowState,
  item: WorkItem,
  page: ProviderPage,
  paths: AcquisitionPaths,
  wasUpstreamCall: boolean,
): WorkflowState {
  const reference = { page: page.page, fingerprint: page.requestFingerprint, requestId: page.requestId };
  const updatedItem: WorkItem = {
    ...item,
    nextPage: page.page + 1,
    completedPages: [...item.completedPages, reference],
    complete: page.isLastPage,
  };
  const candidates = [...state.candidates];
  let results = [...state.results];
  const work = state.work.map((candidate) => (candidate.workId === item.workId ? updatedItem : candidate));
  let rowsAdded = 0;

  if (page.isLastPage) {
    const pages = loadCompletedPages(paths, updatedItem);
    const normalized = normalizeCompletePages(pages, updatedItem);
    if (normalized.status === "complete") rowsAdded = normalized.rowCount;
    if (item.purpose === "discovery") {
      if (normalized.status !== "complete") throw new Error(`Discovery coverage rejected: ${normalized.reason}`);
      const found = discoverCandidates(normalized, updatedItem);
      const existing = new Set(candidates.map((candidate) => candidate.candidateId));
      for (const candidate of found) {
        if (existing.has(candidate.candidateId)) continue;
        existing.add(candidate.candidateId);
        candidates.push(candidate);
        work.push(workFromPlan(buildCoveragePlan(candidate)));
      }
      candidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    } else {
      const candidate = candidates.find((value) => value.candidateId === item.workId.replace(/^coverage-/, ""));
      const fallback = candidates.find(
        (value) => value.wallet === item.wallet && value.proposedCutoffMs === item.cutoffMs && value.token.address === item.token.address,
      );
      const selected = candidate ?? fallback;
      if (!selected) throw new Error("Coverage work has no private candidate");
      results = [...results.filter((result) => result.candidateId !== selected.candidateId), compileCoveredCandidate(selected, normalized)];
      results.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
    }
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
  };
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
  return {
    reportVersion: 1,
    discoveryCalls: state.counters.discoveryCalls,
    coverageCalls: state.counters.coverageCalls,
    rows: state.counters.rows,
    candidates: state.candidates.length,
    rejectionReasons,
    scorable,
    attempts: ledger.attempts,
    successes: ledger.successful,
    reportedCredits: ledger.reportedCreditsUsed,
    retainedCredits: ledger.retainedCredits,
  };
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
  const lock = acquireContractSpikeLock(paths.lock, now);
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      lock.release();
    } catch (releaseError) {
      if (operationError !== undefined) {
        throw new AggregateError([operationError, releaseError], "Acquisition failed and its lock could not be released safely");
      }
      throw releaseError;
    }
  }
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
  if (!Number.isSafeInteger(options.maxNewCalls) || options.maxNewCalls < 1 || options.maxNewCalls > ACQUISITION_MAX_ATTEMPTS) {
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
    const ledger = new AcquisitionLedger(options.paths.ledger, now, options.createAttemptId);
    const opening = ledger.summarize();
    const remainingAttempts = ACQUISITION_MAX_ATTEMPTS - opening.attempts;
    const remainingCredits = ACQUISITION_MAX_RETAINED_CREDITS - opening.retainedCredits;
    if (options.maxNewCalls > remainingAttempts || options.maxNewCalls > remainingCredits) {
      throw new Error("Per-run limit exceeds the remaining global attempt or retained-credit allowance");
    }
    let state = readState(options.paths, now().getTime());
    writePrivateJsonAtomic(options.paths.state, state);
    let networkAttempts = 0;
    let cacheHits = 0;
    let lastAttemptStarted: number | null = null;
    let stoppedBecause: AcquisitionRunResult["stoppedBecause"] = "work-complete";

    while (true) {
      if (ledger.summarize().combinedSuccessfulCalls >= options.targetTotalSuccess) {
        stoppedBecause = "target-reached";
        break;
      }
      const item = state.work.find((work) => !work.complete);
      if (!item) break;
      const planned = planFromWork(item);
      const fingerprint = acquisitionRequestFingerprint(planned.request);
      const cached = readCachedPage(options.paths, fingerprint);
      if (cached) {
        const parsed = parseProviderPage(cached.response, planned, cached.requestId, cached.retrievalTimeMs);
        if (parsed.status !== "valid") throw new Error("Cached provider page is invalid");
        state = updateAfterPage(state, item, parsed.page, options.paths, false);
        writePrivateJsonAtomic(options.paths.state, state);
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
        if (lastAttemptStarted !== null) {
          const wait = ACQUISITION_MIN_REQUEST_INTERVAL_MS - (monotonicNow() - lastAttemptStarted);
          if (wait > 0) await sleep(wait);
        }
        const reservation = ledger.reserve(planned);
        networkAttempts += 1;
        lastAttemptStarted = monotonicNow();
        let response: Response | null = null;
        let rawBody = "";
        let reportedCreditCost: number | null = null;
        let reportedCreditsUsed: number | null = null;
        let outcome: Exclude<AttemptOutcome, "pending"> = "request-error";
        let parsedPage: ProviderPage | null = null;

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
        }

        ledger.settle(reservation, { httpStatus: response?.status ?? null, reportedCreditCost, reportedCreditsUsed, outcome });
        if (outcome === "success" && parsedPage) {
          const cachedPage: CachedPage = {
            cacheVersion: 1,
            fingerprint,
            retrievalTimeMs: parsedPage.retrievalTimeMs,
            requestId: reservation.attemptId,
            response: JSON.parse(rawBody) as unknown,
          };
          writePrivateJsonAtomic(cachePath(options.paths, fingerprint), cachedPage);
          state = updateAfterPage(state, item, parsedPage, options.paths, true);
          writePrivateJsonAtomic(options.paths.state, state);
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
      manifestVersion: 1,
      adapterVersion: ACQUISITION_ADAPTER_VERSION,
      rulesVersion: "4",
      candidates: state.results,
    });
    writePrivateJsonAtomic(options.paths.aggregateReport, report);
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
  | AcquisitionRunResult;

export interface AcquisitionCommandOptions {
  readonly paths?: AcquisitionPaths;
  readonly fetchImpl?: AcquisitionFetch;
  readonly readKey?: (path: string) => string;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly createAttemptId?: () => string;
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
  });
}
