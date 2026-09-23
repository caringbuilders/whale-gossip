import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  ContractSpikeLedger,
  EXPECTED_CREDITS_PER_ATTEMPT,
  NANSEN_DEX_TRADES_ENDPOINT,
  assertAllowedEndpoint,
  buildProbeRequest,
  classifyHttpOutcome,
  parseNonnegativeHeader,
  requestFingerprint,
  summarizeDexTradesResponse,
  type AttemptOutcome,
} from "../lib/server/nansen-contract";

const ENV_PATH = resolve(".env.local");
const LEDGER_PATH = resolve("data/ledgers/nansen-contract-spike.jsonl");
const RAW_DIRECTORY = resolve("data/private/nansen-contract-spike");
const LIVE_FLAG = "--live";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_TRANSIENT_RETRIES = 1;
const MIN_REQUEST_INTERVAL_MS = 500;
const MAX_RETRY_AFTER_MS = 30_000;

function assertPrivateEnvironmentFile(): void {
  execFileSync("git", ["check-ignore", "--quiet", "--", ".env.local"], { stdio: "ignore" });
  let tracked = true;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", ".env.local"], { stdio: "ignore" });
  } catch {
    tracked = false;
  }
  if (tracked) throw new Error("Refusing live mode because .env.local is tracked");
}

function writePrivateRawResponse(attemptId: string, body: string): void {
  mkdirSync(RAW_DIRECTORY, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(RAW_DIRECTORY, `${attemptId}.json`), body, { encoding: "utf8", mode: 0o600, flag: "wx" });
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
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const delay = Math.max(MIN_REQUEST_INTERVAL_MS, Math.ceil(seconds * 1_000));
  return delay <= MAX_RETRY_AFTER_MS ? delay : null;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
}

async function main(): Promise<void> {
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== LIVE_FLAG);
  if (unknownArguments.length > 0) throw new Error("Unsupported argument; use --live for the bounded authenticated probe");

  const live = process.argv.includes(LIVE_FLAG);
  const request = buildProbeRequest();
  assertAllowedEndpoint(NANSEN_DEX_TRADES_ENDPOINT);
  const fingerprint = requestFingerprint(request);

  if (!live) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          networkRequestSent: false,
          endpoint: NANSEN_DEX_TRADES_ENDPOINT,
          requestFingerprint: fingerprint,
          request,
          caps: { attempts: 5, retainedCredits: 5, expectedCreditsPerAttempt: EXPECTED_CREDITS_PER_ATTEMPT },
        },
        null,
        2,
      ),
    );
    return;
  }

  assertPrivateEnvironmentFile();
  process.loadEnvFile(ENV_PATH);
  const apiKey = process.env.NANSEN_API_KEY;
  if (!apiKey) throw new Error("NANSEN_API_KEY is unavailable in the ignored local environment file");

  const ledger = new ContractSpikeLedger(LEDGER_PATH);
  let retryCount = 0;
  while (true) {
    const reservation = ledger.reserve(fingerprint, { page: request.pagination.page, perPage: request.pagination.per_page });
    const started = performance.now();
    let response: Response | null = null;
    let outcome: Exclude<AttemptOutcome, "pending"> = "request-error";
    let reportedCreditCost: number | null = null;
    let reportedCreditsUsed: number | null = null;
    let summary: ReturnType<typeof summarizeDexTradesResponse> | null = null;

    try {
      response = await fetch(NANSEN_DEX_TRADES_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: apiKey },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const rawBody = await response.text();
      writePrivateRawResponse(reservation.attemptId, rawBody);
      const parsed = safeJsonParse(rawBody);
      summary = summarizeDexTradesResponse(parsed);
      reportedCreditCost = parseNonnegativeHeader(response.headers.get("x-nansen-credits-cost"));
      reportedCreditsUsed = parseNonnegativeHeader(response.headers.get("x-nansen-credits-used"));
      outcome = classifyHttpOutcome(response.status, summary.validEnvelope);
    } catch {
      outcome = "request-error";
    }

    const settlement = ledger.settle(reservation, {
      httpStatus: response?.status ?? null,
      latencyMs: performance.now() - started,
      reportedCreditCost,
      reportedCreditsUsed,
      outcome,
    });

    console.log(
      JSON.stringify(
        {
          mode: "live",
          attemptId: settlement.attemptId,
          httpStatus: settlement.httpStatus,
          latencyMs: settlement.latencyMs,
          reportedCreditCost: settlement.reportedCreditCost,
          reportedCreditsUsed: settlement.reportedCreditsUsed,
          retainedCredits: settlement.retainedCredits,
          outcome: settlement.outcome,
          contractSummary: outcome === "success" || outcome === "invalid-response" ? summary : null,
          ledger: ledger.summarize(),
        },
        null,
        2,
      ),
    );

    if (
      (reportedCreditCost !== null && reportedCreditCost !== EXPECTED_CREDITS_PER_ATTEMPT) ||
      (reportedCreditsUsed !== null && reportedCreditsUsed > EXPECTED_CREDITS_PER_ATTEMPT)
    ) {
      throw new Error("Stopped because the provider reported unexpected pricing");
    }
    if (outcome === "authentication-error" || outcome === "authorization-or-credit-error") {
      throw new Error("Stopped after an authentication, authorization, plan, or credit response");
    }
    if (outcome === "success") return;
    if (outcome !== "transient-error" && outcome !== "rate-limited") {
      throw new Error("Stopped after a non-retryable or invalid provider response");
    }
    if (!response || retryCount >= MAX_TRANSIENT_RETRIES) throw new Error("Stopped after the bounded retry limit");
    const delay = retryDelayMs(response);
    if (delay === null) throw new Error("Stopped because Retry-After was invalid or exceeded the bounded wait");
    retryCount += 1;
    await pause(delay);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown contract-spike failure";
  console.error(message);
  process.exitCode = 1;
});
