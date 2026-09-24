import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  ACQUISITION_MAX_ATTEMPTS,
  ACQUISITION_TOKEN_UNIVERSE,
  NANSEN_DEX_TRADES_ENDPOINT,
  acquisitionRequestFingerprint,
  buildAcquisitionRequest,
  buildDiscoveryPlan,
} from "../lib/server/nansen-acquisition";
import {
  AcquisitionLedger,
  parseAcquisitionArguments,
  resolveAcquisitionPaths,
  runAcquisitionCommand,
  runLiveAcquisition,
  summarizeAcquisitionLedger,
  type AcquisitionPaths,
} from "../lib/server/nansen-acquisition-runner";
import { acquireContractSpikeLock } from "../lib/server/nansen-contract";

const FIXED_NOW = new Date("2026-09-24T12:00:00.000Z");

function temporaryPaths(prefix: string): AcquisitionPaths {
  return resolveAcquisitionPaths(mkdtempSync(join(tmpdir(), prefix)));
}

function ids(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

function providerResponse(
  page: number,
  isLastPage: boolean,
  rows: readonly Record<string, unknown>[] = [],
  status = 200,
  headers: Record<string, string> = { "x-nansen-credits-cost": "1", "x-nansen-credits-used": "1" },
): Response {
  return new Response(JSON.stringify({ data: rows, pagination: { page, per_page: 100, is_last_page: isLastPage } }), {
    status,
    headers,
  });
}

function pageFromBody(init: RequestInit): number {
  return (JSON.parse(String(init.body)) as { pagination: { page: number } }).pagination.page;
}

test("argument parsing requires explicit bounded live flags and rejects contradictions", () => {
  assert.deepEqual(parseAcquisitionArguments([]), { mode: "dry-run" });
  assert.deepEqual(parseAcquisitionArguments(["--status"]), { mode: "status" });
  assert.deepEqual(
    parseAcquisitionArguments(["--live", "--max-new-calls", "10", "--target-total-success", "120"]),
    { mode: "live", maxNewCalls: 10, targetTotalSuccess: 120 },
  );
  for (const arguments_ of [
    ["--live"],
    ["--live", "--max-new-calls", "0", "--target-total-success", "120"],
    ["--live", "--max-new-calls", "131", "--target-total-success", "120"],
    ["--live", "--max-new-calls", "10", "--target-total-success", "1000"],
    ["--status", "--status"],
    ["--unknown"],
  ]) {
    assert.throws(() => parseAcquisitionArguments(arguments_), /Unsupported|must/);
  }
});

test("default dry-run and keyless status are network-free and non-mutating", async () => {
  const paths = temporaryPaths("whale-acquisition-offline-");
  let fetchCalls = 0;
  let keyReads = 0;
  const options = {
    paths,
    fetchImpl: async () => {
      fetchCalls += 1;
      return providerResponse(1, true);
    },
    readKey: () => {
      keyReads += 1;
      return "unused";
    },
  };
  const dry = await runAcquisitionCommand([], options);
  const status = await runAcquisitionCommand(["--status"], options);
  assert.equal(dry.mode, "dry-run");
  assert.equal(status.mode, "status");
  assert.equal(status.mode === "status" && status.ledger.combinedSuccessfulCalls, 3);
  assert.equal(fetchCalls, 0);
  assert.equal(keyReads, 0);
  for (const path of [paths.ledger, paths.lock, paths.state, paths.rawDirectory, paths.cacheDirectory]) {
    assert.equal(existsSync(path), false);
  }
});

test("the new ledger starts combined reporting at three without reading or mutating the spike ledger", () => {
  const paths = temporaryPaths("whale-acquisition-combined-");
  const historicalSpike = join(paths.repositoryRoot, "data", "ledgers", "nansen-contract-spike.jsonl");
  mkdirSync(join(paths.repositoryRoot, "data", "ledgers"), { recursive: true, mode: 0o700 });
  writeFileSync(historicalSpike, "DO NOT READ OR MODIFY\n", { mode: 0o000 });
  const before = statSync(historicalSpike);
  const summary = summarizeAcquisitionLedger(paths.ledger);
  const after = statSync(historicalSpike);
  assert.equal(summary.successful, 0);
  assert.equal(summary.combinedSuccessfulCalls, 3);
  assert.equal(before.size, after.size);
  assert.equal(before.mtimeMs, after.mtimeMs);
  chmodSync(historicalSpike, 0o600);
});

test("the durable ledger cannot reserve a 131st attempt or retained credit", () => {
  const paths = temporaryPaths("whale-acquisition-cap-");
  const ledger = new AcquisitionLedger(paths.ledger, () => FIXED_NOW, ids("cap"));
  const plan = buildDiscoveryPlan(FIXED_NOW.getTime())[0];
  for (let index = 0; index < ACQUISITION_MAX_ATTEMPTS; index += 1) ledger.reserve(plan);
  assert.throws(() => ledger.reserve(plan), /attempt cap|retained-credit cap/);
  const summary = ledger.summarize();
  assert.equal(summary.attempts, 130);
  assert.equal(summary.retainedCredits, 130);
});

test("a ten-call pilot cannot make an eleventh attempt", async () => {
  const paths = temporaryPaths("whale-acquisition-ten-");
  let fetchCalls = 0;
  const result = await runLiveAcquisition({
    paths,
    apiKey: "dummy-key",
    maxNewCalls: 10,
    targetTotalSuccess: 120,
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      return providerResponse(pageFromBody(init), false);
    },
    now: () => FIXED_NOW,
    monotonicNow: () => 0,
    sleep: async () => undefined,
    createAttemptId: ids("pilot"),
  });
  assert.equal(fetchCalls, 10);
  assert.equal(result.networkAttempts, 10);
  assert.equal(result.ledger.attempts, 10);
  assert.equal(result.ledger.successful, 10);
  assert.equal(result.stoppedBecause, "per-run-limit");
  assert.equal(statSync(paths.ledger).mode & 0o077, 0);
  assert.equal(statSync(paths.state).mode & 0o077, 0);
  assert.equal(statSync(paths.rawDirectory).mode & 0o077, 0);
  assert.equal(statSync(paths.cacheDirectory).mode & 0o077, 0);
});

test("a requested run allowance larger than remaining global capacity fails before fetch", async () => {
  const paths = temporaryPaths("whale-acquisition-remaining-");
  const ledger = new AcquisitionLedger(paths.ledger, () => FIXED_NOW, ids("remaining"));
  const plan = buildDiscoveryPlan(FIXED_NOW.getTime())[0];
  for (let index = 0; index < 125; index += 1) ledger.reserve(plan);
  let fetchCalls = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 10,
      targetTotalSuccess: 120,
      fetchImpl: async () => {
        fetchCalls += 1;
        return providerResponse(1, true);
      },
      now: () => FIXED_NOW,
    }),
    /remaining global/,
  );
  assert.equal(fetchCalls, 0);
});

test("direct live entry rejects invalid limits before creating state or fetching", async () => {
  const paths = temporaryPaths("whale-acquisition-invalid-limit-");
  let fetchCalls = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 0,
      targetTotalSuccess: 120,
      fetchImpl: async () => {
        fetchCalls += 1;
        return providerResponse(1, true);
      },
    }),
    /call limit/,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(existsSync(paths.state), false);
});

test("cache hits complete deterministic discovery work without an upstream call", async () => {
  const paths = temporaryPaths("whale-acquisition-cache-");
  mkdirSync(paths.cacheDirectory, { recursive: true, mode: 0o700 });
  for (const plan of buildDiscoveryPlan(FIXED_NOW.getTime())) {
    const fingerprint = acquisitionRequestFingerprint(plan.request);
    writeFileSync(
      join(paths.cacheDirectory, `${fingerprint}.json`),
      `${JSON.stringify({
        cacheVersion: 1,
        fingerprint,
        retrievalTimeMs: FIXED_NOW.getTime(),
        requestId: `cached-${fingerprint.slice(0, 8)}`,
        response: { data: [], pagination: { page: 1, per_page: 100, is_last_page: true } },
      })}\n`,
      { mode: 0o600 },
    );
  }
  let fetchCalls = 0;
  const result = await runLiveAcquisition({
    paths,
    apiKey: "dummy-key",
    maxNewCalls: 1,
    targetTotalSuccess: 120,
    fetchImpl: async () => {
      fetchCalls += 1;
      return providerResponse(1, true);
    },
    now: () => FIXED_NOW,
  });
  assert.equal(fetchCalls, 0);
  assert.equal(result.networkAttempts, 0);
  assert.equal(result.cacheHits, 3);
  assert.equal(result.ledger.attempts, 0);
  assert.equal(result.stoppedBecause, "work-complete");
});

test("a crash-left lock and concurrent lock fail closed before reserve or fetch", async () => {
  const paths = temporaryPaths("whale-acquisition-lock-");
  const lock = acquireContractSpikeLock(paths.lock, () => FIXED_NOW);
  let fetchCalls = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 1,
      targetTotalSuccess: 120,
      fetchImpl: async () => {
        fetchCalls += 1;
        return providerResponse(1, true);
      },
      now: () => FIXED_NOW,
    }),
    /lock is already held or unsafe/,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(existsSync(paths.ledger), false);
  assert.equal(existsSync(paths.lock), true);
  lock.release();
});

test("redirect rejection issues one fetch under one reservation", async () => {
  const paths = temporaryPaths("whale-acquisition-redirect-");
  let fetchCalls = 0;
  let redirect: RequestRedirect | undefined;
  let signal: AbortSignal | null | undefined;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 1,
      targetTotalSuccess: 120,
      fetchImpl: async (input, init) => {
        assert.equal(input, NANSEN_DEX_TRADES_ENDPOINT);
        fetchCalls += 1;
        redirect = init.redirect;
        signal = init.signal;
        throw new TypeError("synthetic redirect rejected");
      },
      now: () => FIXED_NOW,
      createAttemptId: ids("redirect"),
    }),
    /non-retryable/,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(redirect, "error");
  assert.ok(signal instanceof AbortSignal);
  assert.equal(summarizeAcquisitionLedger(paths.ledger).attempts, 1);
});

for (const status of [401, 402, 403]) {
  test(`HTTP ${status} stops authentication, plan, or credit work immediately`, async () => {
    const paths = temporaryPaths(`whale-acquisition-${status}-`);
    let fetchCalls = 0;
    await assert.rejects(
      runLiveAcquisition({
        paths,
        apiKey: "dummy-key",
        maxNewCalls: 2,
        targetTotalSuccess: 120,
        fetchImpl: async () => {
          fetchCalls += 1;
          return providerResponse(1, true, [], status, {});
        },
        now: () => FIXED_NOW,
        createAttemptId: ids(`status-${status}`),
      }),
      /authentication, authorization, plan, payment, or credit/,
    );
    assert.equal(fetchCalls, 1);
  });
}

test("429 uses bounded Retry-After and every retry consumes an attempt", async () => {
  const paths = temporaryPaths("whale-acquisition-429-");
  let fetchCalls = 0;
  const sleeps: number[] = [];
  const result = await runLiveAcquisition({
    paths,
    apiKey: "dummy-key",
    maxNewCalls: 2,
    targetTotalSuccess: 120,
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? providerResponse(pageFromBody(init), false, [], 429, { "retry-after": "0.25" })
        : providerResponse(pageFromBody(init), false);
    },
    now: () => FIXED_NOW,
    monotonicNow: () => 0,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    createAttemptId: ids("rate"),
  });
  assert.equal(fetchCalls, 2);
  assert.equal(result.ledger.attempts, 2);
  assert.equal(result.ledger.successful, 1);
  assert.ok(sleeps.every((delay) => delay === 500));
});

test("bounded transient retry cannot exceed the per-run allowance", async () => {
  const paths = temporaryPaths("whale-acquisition-503-");
  let fetchCalls = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 2,
      targetTotalSuccess: 120,
      fetchImpl: async () => {
        fetchCalls += 1;
        return providerResponse(1, false, [], 503, { "retry-after": "0" });
      },
      now: () => FIXED_NOW,
      monotonicNow: () => 0,
      sleep: async () => undefined,
      createAttemptId: ids("transient"),
    }),
    /bounded retry/,
  );
  assert.equal(fetchCalls, 2);
  assert.equal(summarizeAcquisitionLedger(paths.ledger).attempts, 2);
});

test("missing, malformed, and unexpected credit headers stop after the first response", async () => {
  for (const [name, headers] of [
    ["missing", {}],
    ["malformed", { "x-nansen-credits-cost": "one", "x-nansen-credits-used": "1" }],
    ["unexpected", { "x-nansen-credits-cost": "2", "x-nansen-credits-used": "1" }],
    ["used", { "x-nansen-credits-cost": "1", "x-nansen-credits-used": "2" }],
  ] as const) {
    const paths = temporaryPaths(`whale-acquisition-price-${name}-`);
    let fetchCalls = 0;
    await assert.rejects(
      runLiveAcquisition({
        paths,
        apiKey: "dummy-key",
        maxNewCalls: 2,
        targetTotalSuccess: 120,
        fetchImpl: async () => {
          fetchCalls += 1;
          return providerResponse(1, true, [], 200, headers);
        },
        now: () => FIXED_NOW,
        createAttemptId: ids(name),
      }),
      /pricing/,
    );
    assert.equal(fetchCalls, 1);
    assert.equal(summarizeAcquisitionLedger(paths.ledger).successful, 0);
  }
});

test("malformed JSON and contradictory pagination never count as success", async () => {
  for (const response of [
    new Response("not json", { status: 200, headers: { "x-nansen-credits-cost": "1", "x-nansen-credits-used": "1" } }),
    providerResponse(2, true),
  ]) {
    const paths = temporaryPaths("whale-acquisition-invalid-");
    await assert.rejects(
      runLiveAcquisition({
        paths,
        apiKey: "dummy-key",
        maxNewCalls: 1,
        targetTotalSuccess: 120,
        fetchImpl: async () => response,
        now: () => FIXED_NOW,
        createAttemptId: ids("invalid"),
      }),
      /non-retryable/,
    );
    assert.equal(summarizeAcquisitionLedger(paths.ledger).successful, 0);
  }
});

test("unsafe private-output symlinks fail closed while retaining accounting", async () => {
  const paths = temporaryPaths("whale-acquisition-symlink-");
  mkdirSync(join(paths.repositoryRoot, "data", "private", "nansen-acquisition"), { recursive: true, mode: 0o700 });
  const target = mkdtempSync(join(tmpdir(), "whale-acquisition-target-"));
  symlinkSync(target, paths.rawDirectory);
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 1,
      targetTotalSuccess: 120,
      fetchImpl: async () => providerResponse(1, true),
      now: () => FIXED_NOW,
      createAttemptId: ids("symlink"),
    }),
    /non-retryable/,
  );
  const summary = summarizeAcquisitionLedger(paths.ledger);
  assert.equal(summary.attempts, 1);
  assert.equal(summary.retainedCredits, 1);
  assert.equal(summary.reportedCreditsUsed, 1);
  assert.equal(summary.successful, 0);
});

test("a successful response missing its durable cache cannot be repeated on resume", async () => {
  const paths = temporaryPaths("whale-acquisition-cache-failure-");
  mkdirSync(join(paths.repositoryRoot, "data", "private", "nansen-acquisition"), { recursive: true, mode: 0o700 });
  const target = mkdtempSync(join(tmpdir(), "whale-acquisition-cache-target-"));
  symlinkSync(target, paths.cacheDirectory);
  let firstFetches = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 1,
      targetTotalSuccess: 120,
      fetchImpl: async () => {
        firstFetches += 1;
        return providerResponse(1, true);
      },
      now: () => FIXED_NOW,
      createAttemptId: ids("cache-failure"),
    }),
  );
  assert.equal(firstFetches, 1);
  assert.equal(summarizeAcquisitionLedger(paths.ledger).successful, 1);

  let resumedFetches = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 1,
      targetTotalSuccess: 120,
      fetchImpl: async () => {
        resumedFetches += 1;
        return providerResponse(1, true);
      },
      now: () => FIXED_NOW,
      createAttemptId: ids("resume"),
    }),
    /refusing a duplicate upstream call/,
  );
  assert.equal(resumedFetches, 0);
});

test("sanitized aggregate output contains counts but no provider-private values", async () => {
  const paths = temporaryPaths("whale-acquisition-report-");
  const result = await runLiveAcquisition({
    paths,
    apiKey: "SYNTHETIC-KEY-MUST-NOT-LEAK",
    maxNewCalls: 1,
    targetTotalSuccess: 120,
    fetchImpl: async (_input, init) => providerResponse(pageFromBody(init), true),
    now: () => FIXED_NOW,
    createAttemptId: ids("report"),
  });
  const publicReport = JSON.stringify(result.report);
  for (const forbidden of ["0x", "PRIVATE", "SYNTHETIC-KEY", "trader", "transaction", "estimated_value_usd"]) {
    assert.doesNotMatch(publicReport, new RegExp(forbidden, "i"));
  }
  assert.equal(result.report.discoveryCalls, 1);
  assert.equal(statSync(paths.aggregateReport).mode & 0o077, 0);
  assert.equal(statSync(paths.candidateManifest).mode & 0o077, 0);
});

test("application and public game modules cannot import acquisition or private modules", () => {
  assert.match(readFileSync("lib/server/nansen-acquisition.ts", "utf8"), /^import "server-only";/);
  assert.match(readFileSync("lib/server/nansen-acquisition-runner.ts", "utf8"), /^import "server-only";/);
  const roots = ["app", join("lib", "game")];
  const sourceFiles: string[] = [];
  const visit = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) sourceFiles.push(child);
    }
  };
  for (const root of roots) visit(root);
  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /nansen-acquisition|data\/private|data\/ledgers/);
  }
});

test("importing the acquisition CLI has no side effects", async () => {
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const originalError = console.error;
  const output: unknown[] = [];
  console.log = (...values: unknown[]) => output.push(values);
  console.error = (...values: unknown[]) => output.push(values);
  try {
    const importedScript = await import("../scripts/nansen-acquisition");
    assert.equal(typeof importedScript.main, "function");
    assert.deepEqual(output, []);
    assert.equal(process.exitCode, originalExitCode);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});

test("fixed requests cannot accept arbitrary endpoint, body, wallet, token, date, or budget input", () => {
  const request = buildAcquisitionRequest(ACQUISITION_TOKEN_UNIVERSE[0], 1_000, 2_000);
  assert.deepEqual(Object.keys(request).sort(), ["chain", "date", "only_smart_money", "order_by", "pagination", "token_address"]);
  assert.equal(request.chain, "ethereum");
  assert.equal(request.only_smart_money, false);
  assert.equal(request.token_address, ACQUISITION_TOKEN_UNIVERSE[0].address);
});
