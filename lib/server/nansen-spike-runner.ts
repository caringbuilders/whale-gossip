import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  CONTRACT_SPIKE_MAX_ATTEMPTS,
  CONTRACT_SPIKE_MAX_RETAINED_CREDITS,
  ContractSpikeLedger,
  EXPECTED_CREDITS_PER_ATTEMPT,
  NANSEN_DEX_TRADES_ENDPOINT,
  PROBE_PAGE,
  acquireContractSpikeLock,
  assertAllowedEndpoint,
  buildProbeRequest,
  classifyHttpOutcome,
  parseNonnegativeHeader,
  readCredentialTextFile,
  requestFingerprint,
  summarizeDexTradesResponse,
  writePrivateTextFileExclusive,
  type AttemptOutcome,
  type DexTradesRequest,
  type LedgerSummary,
} from "./nansen-contract";

export const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const MAX_TRANSIENT_RETRIES = 1;
export const MIN_REQUEST_INTERVAL_MS = 500;
export const MAX_RETRY_AFTER_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 20_000;

export interface SpikePaths {
  readonly repositoryRoot: string;
  readonly environmentFile: string;
  readonly ledger: string;
  readonly lock: string;
  readonly rawDirectory: string;
}

export function resolveSpikePaths(repositoryRoot = REPOSITORY_ROOT): SpikePaths {
  const canonicalRoot = resolve(repositoryRoot);
  const ledger = join(canonicalRoot, "data", "ledgers", "nansen-contract-spike.jsonl");
  return {
    repositoryRoot: canonicalRoot,
    environmentFile: join(canonicalRoot, ".env.local"),
    ledger,
    lock: `${ledger}.lock`,
    rawDirectory: join(canonicalRoot, "data", "private", "nansen-contract-spike"),
  };
}

export type SpikeMode = "dry-run" | "live" | "pagination-probe" | "status";

export function parseSpikeArguments(arguments_: readonly string[]): SpikeMode {
  if (arguments_.length === 0) return "dry-run";
  if (arguments_.length === 1 && arguments_[0] === "--live") return "live";
  if (arguments_.length === 2 && arguments_[0] === "--live" && arguments_[1] === "--pagination-probe") {
    return "pagination-probe";
  }
  if (arguments_.length === 1 && arguments_[0] === "--status") return "status";
  throw new Error(
    "Unsupported argument; use --live for the bounded page-1 probe, --live --pagination-probe for pagination, or --status for sanitized accounting",
  );
}

export function readNansenApiKey(environmentFile: string): string {
  const contents = readCredentialTextFile(environmentFile);
  let parsed: ReturnType<typeof parseEnv>;
  try {
    parsed = parseEnv(contents);
  } catch {
    throw new Error("The canonical credential file could not be parsed safely");
  }
  if (!Object.hasOwn(parsed, "NANSEN_API_KEY")) throw new Error("NANSEN_API_KEY is missing from the canonical credential file");
  const key = parsed.NANSEN_API_KEY;
  if (typeof key !== "string" || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error("NANSEN_API_KEY in the canonical credential file is invalid");
  }
  return key;
}

export function assertCanonicalEnvironmentIsIgnored(paths: SpikePaths): void {
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", ".env.local"], {
    cwd: paths.repositoryRoot,
    stdio: "ignore",
  });
  if (tracked.status === 0) throw new Error("Live mode is disabled because the canonical .env.local is tracked");
  if (tracked.status !== 1) throw new Error("Live mode is disabled because Git could not verify .env.local tracking");

  const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", ".env.local"], {
    cwd: paths.repositoryRoot,
    stdio: "ignore",
  });
  if (ignored.status !== 0) {
    throw new Error("Live mode is disabled because the canonical .env.local is not ignored");
  }
}

export interface FetchLike {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface AttemptReport {
  readonly mode: "live" | "pagination-probe";
  readonly attemptId: string;
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  readonly reportedCreditCost: number | null;
  readonly reportedCreditsUsed: number | null;
  readonly retainedCredits: number;
  readonly outcome: Exclude<AttemptOutcome, "pending">;
  readonly contractSummary: ReturnType<typeof summarizeDexTradesResponse> | null;
  readonly ledger: LedgerSummary;
}

export interface LiveSpikeOptions {
  readonly apiKey: string;
  readonly paths: SpikePaths;
  readonly fetchImpl: FetchLike;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly createAttemptId?: () => string;
  readonly writeRawResponse?: (path: string, contents: string) => void;
  readonly onAttempt?: (report: AttemptReport) => void;
}

function validateInjectedApiKey(apiKey: string): void {
  if (!/^[\x21-\x7e]+$/.test(apiKey)) {
    throw new Error("NANSEN_API_KEY is malformed; no request was attempted");
  }
}

function safeJsonParse(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function retryDelayMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return MIN_REQUEST_INTERVAL_MS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0 || Object.is(seconds, -0)) return null;
  const delay = Math.max(MIN_REQUEST_INTERVAL_MS, Math.ceil(seconds * 1_000));
  return delay <= MAX_RETRY_AFTER_MS ? delay : null;
}

function outcomeStopMessage(outcome: Exclude<AttemptOutcome, "pending">): string {
  if (outcome === "authentication-error") return "Stopped after an authentication response";
  if (outcome === "authorization-or-credit-error") {
    return "Stopped after an authorization, plan, payment, or credit response";
  }
  return "Stopped after a non-retryable or invalid provider response";
}

async function withContractSpikeLock<T>(
  paths: SpikePaths,
  now: () => Date,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = acquireContractSpikeLock(paths.lock, now);
  let operationFailed = false;
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    try {
      lock.release();
    } catch (releaseError) {
      if (operationFailed) {
        throw new AggregateError(
          [operationError, releaseError],
          "Contract-spike run failed and its lock could not be released safely",
        );
      }
      throw releaseError;
    }
  }
}

interface ExecuteAttemptOptions extends LiveSpikeOptions {
  readonly mode: "live" | "pagination-probe";
  readonly request: DexTradesRequest;
  readonly ledger: ContractSpikeLedger;
  readonly monotonicNow: () => number;
  readonly writeRawResponse: (path: string, contents: string) => void;
}

interface AttemptExecution {
  readonly report: AttemptReport;
  readonly response: Response | null;
}

async function executeAttempt(options: ExecuteAttemptOptions): Promise<AttemptExecution> {
  const fingerprint = requestFingerprint(options.request);
  const reservation = options.ledger.reserve(fingerprint, {
    page: options.request.pagination.page,
    perPage: options.request.pagination.per_page,
  });
  const started = options.monotonicNow();
  let response: Response | null = null;
  let outcome: Exclude<AttemptOutcome, "pending"> = "request-error";
  let reportedCreditCost: number | null = null;
  let reportedCreditsUsed: number | null = null;
  let summary: ReturnType<typeof summarizeDexTradesResponse> | null = null;

  try {
    response = await options.fetchImpl(NANSEN_DEX_TRADES_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: options.apiKey },
      body: JSON.stringify(options.request),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    reportedCreditCost = parseNonnegativeHeader(response.headers.get("x-nansen-credits-cost"));
    reportedCreditsUsed = parseNonnegativeHeader(response.headers.get("x-nansen-credits-used"));
    const rawBody = await response.text();
    summary = summarizeDexTradesResponse(safeJsonParse(rawBody));
    const expectedPagination =
      summary.pagination.page === options.request.pagination.page &&
      summary.pagination.perPage === options.request.pagination.per_page;
    outcome = classifyHttpOutcome(response.status, summary.validEnvelope && expectedPagination);
    options.writeRawResponse(join(options.paths.rawDirectory, `${reservation.attemptId}.json`), rawBody);
  } catch {
    outcome = "request-error";
  }

  const settlement = options.ledger.settle(reservation, {
    httpStatus: response?.status ?? null,
    latencyMs: options.monotonicNow() - started,
    reportedCreditCost,
    reportedCreditsUsed,
    outcome,
  });
  const report: AttemptReport = {
    mode: options.mode,
    attemptId: settlement.attemptId,
    httpStatus: settlement.httpStatus,
    latencyMs: settlement.latencyMs,
    reportedCreditCost: settlement.reportedCreditCost,
    reportedCreditsUsed: settlement.reportedCreditsUsed,
    retainedCredits: settlement.retainedCredits,
    outcome: settlement.outcome,
    contractSummary: outcome === "success" || outcome === "invalid-response" ? summary : null,
    ledger: options.ledger.summarize(),
  };
  options.onAttempt?.(report);
  return { report, response };
}

function assertExpectedPricing(report: AttemptReport): void {
  if (
    (report.reportedCreditCost !== null && report.reportedCreditCost !== EXPECTED_CREDITS_PER_ATTEMPT) ||
    (report.reportedCreditsUsed !== null && report.reportedCreditsUsed > EXPECTED_CREDITS_PER_ATTEMPT)
  ) {
    throw new Error("Stopped because the provider reported unexpected pricing");
  }
}

export async function runLiveSpike(options: LiveSpikeOptions): Promise<readonly AttemptReport[]> {
  validateInjectedApiKey(options.apiKey);
  assertAllowedEndpoint(NANSEN_DEX_TRADES_ENDPOINT);
  const request = buildProbeRequest();
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const writeRawResponse = options.writeRawResponse ?? writePrivateTextFileExclusive;
  const ledger = new ContractSpikeLedger(options.paths.ledger, now, options.createAttemptId);
  const reports: AttemptReport[] = [];

  return withContractSpikeLock(options.paths, now, async () => {
    if (ledger.summarize().attempts !== 0) {
      throw new Error("Page-1 live mode requires an empty contract-spike ledger; use the explicit pagination mode to continue");
    }
    let retryCount = 0;
    while (true) {
      const execution = await executeAttempt({
        ...options,
        mode: "live",
        request,
        ledger,
        monotonicNow,
        writeRawResponse,
      });
      const { report } = execution;
      reports.push(report);
      assertExpectedPricing(report);
      if (report.outcome === "success") return reports;
      if (report.outcome !== "transient-error" && report.outcome !== "rate-limited") {
        throw new Error(outcomeStopMessage(report.outcome));
      }
      if (retryCount >= MAX_TRANSIENT_RETRIES) {
        throw new Error("Stopped after the bounded retry limit");
      }
      if (!execution.response) throw new Error("Stopped after a request failure");
      const delay = retryDelayMs(execution.response);
      if (delay === null) throw new Error("Stopped because Retry-After was invalid or exceeded the bounded wait");
      retryCount += 1;
      await sleep(delay);
    }
  });
}

export async function runPaginationProbe(options: LiveSpikeOptions): Promise<readonly AttemptReport[]> {
  validateInjectedApiKey(options.apiKey);
  assertAllowedEndpoint(NANSEN_DEX_TRADES_ENDPOINT);
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const writeRawResponse = options.writeRawResponse ?? writePrivateTextFileExclusive;
  const ledger = new ContractSpikeLedger(options.paths.ledger, now, options.createAttemptId);
  const reports: AttemptReport[] = [];

  return withContractSpikeLock(options.paths, now, async () => {
    ledger.assertReadyForPaginationProbe(requestFingerprint(buildProbeRequest(PROBE_PAGE)));
    for (const page of [2, 3]) {
      const execution = await executeAttempt({
        ...options,
        mode: "pagination-probe",
        request: buildProbeRequest(page),
        ledger,
        monotonicNow,
        writeRawResponse,
      });
      const { report } = execution;
      reports.push(report);
      assertExpectedPricing(report);
      if (report.outcome !== "success") {
        throw new Error("Pagination probe stopped after one attempt; retries are disabled");
      }
      if (page === 2 && report.contractSummary?.pagination.isLastPage === true) return reports;
    }
    return reports;
  });
}

export interface SpikeCommandOptions {
  readonly paths?: SpikePaths;
  readonly fetchImpl?: FetchLike;
  readonly readKey?: (path: string) => string;
  readonly onAttempt?: (report: AttemptReport) => void;
}

export type SpikeCommandResult =
  | {
      readonly mode: "dry-run";
      readonly networkRequestSent: false;
      readonly endpoint: typeof NANSEN_DEX_TRADES_ENDPOINT;
      readonly requestFingerprint: string;
      readonly request: ReturnType<typeof buildProbeRequest>;
      readonly caps: { readonly attempts: number; readonly retainedCredits: number; readonly expectedCreditsPerAttempt: 1 };
    }
  | { readonly mode: "status"; readonly networkRequestSent: false; readonly ledger: LedgerSummary }
  | { readonly mode: "live" | "pagination-probe"; readonly reports: readonly AttemptReport[] };

export async function runSpikeCommand(
  arguments_: readonly string[],
  options: SpikeCommandOptions = {},
): Promise<SpikeCommandResult> {
  const mode = parseSpikeArguments(arguments_);
  const paths = options.paths ?? resolveSpikePaths();
  const request = buildProbeRequest();
  if (mode === "dry-run") {
    return {
      mode,
      networkRequestSent: false,
      endpoint: NANSEN_DEX_TRADES_ENDPOINT,
      requestFingerprint: requestFingerprint(request),
      request,
      caps: {
        attempts: CONTRACT_SPIKE_MAX_ATTEMPTS,
        retainedCredits: CONTRACT_SPIKE_MAX_RETAINED_CREDITS,
        expectedCreditsPerAttempt: 1,
      },
    };
  }
  if (mode === "status") {
    return {
      mode,
      networkRequestSent: false,
      ledger: new ContractSpikeLedger(paths.ledger).summarize(),
    };
  }

  assertCanonicalEnvironmentIsIgnored(paths);
  const apiKey = (options.readKey ?? readNansenApiKey)(paths.environmentFile);
  const liveOptions: LiveSpikeOptions = {
    apiKey,
    paths,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    onAttempt: options.onAttempt,
  };
  const reports =
    mode === "pagination-probe" ? await runPaginationProbe(liveOptions) : await runLiveSpike(liveOptions);
  return { mode, reports };
}
