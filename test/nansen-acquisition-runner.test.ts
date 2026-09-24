import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
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

function requestFromBody(init: RequestInit): {
  date: { from: string; to: string };
  filters?: { trader_address: string };
  pagination: { page: number };
} {
  return JSON.parse(String(init.body)) as {
    date: { from: string; to: string };
    filters?: { trader_address: string };
    pagination: { page: number };
  };
}

function providerRow(wallet: string, timestamp: string, transactionSeed: string): Record<string, unknown> {
  return {
    block_timestamp: timestamp,
    transaction_hash: `0x${transactionSeed.repeat(64).slice(0, 64)}`,
    trader_address: wallet,
    token_address: ACQUISITION_TOKEN_UNIVERSE[0].address,
    action: "BUY",
    estimated_value_usd: 25_000,
  };
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
    ["--live", "--max-new-calls", "11", "--target-total-success", "120"],
    ["--live", "--max-new-calls", "1e1", "--target-total-success", "120"],
    ["--live", "--max-new-calls", "1.0", "--target-total-success", "120"],
    ["--live", "--max-new-calls", "+1", "--target-total-success", "120"],
    ["--live", "--max-new-calls", "01", "--target-total-success", "120"],
    ["--live", "--max-new-calls", " 1", "--target-total-success", "120"],
    ["--live", "--max-new-calls", "1 ", "--target-total-success", "120"],
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

test("an unknown charge retains its reservation in direct ledger accounting", () => {
  const paths = temporaryPaths("whale-acquisition-unknown-charge-");
  const ledger = new AcquisitionLedger(paths.ledger, () => FIXED_NOW, ids("unknown"));
  const reservation = ledger.reserve(buildDiscoveryPlan(FIXED_NOW.getTime())[0]);
  ledger.settle(reservation, {
    httpStatus: null,
    reportedCreditCost: null,
    reportedCreditsUsed: null,
    outcome: "request-error",
  });
  assert.deepEqual(ledger.summarize(), {
    attempts: 1,
    discoveryAttempts: 1,
    coverageAttempts: 0,
    settled: 1,
    successful: 0,
    reportedCreditsUsed: 0,
    unknownChargeAttempts: 1,
    retainedCredits: 1,
    combinedSuccessfulCalls: 3,
    failureReasons: { "invalid-coverage-row": 0, "wallet-filter-not-applied": 0 },
  });
});

test("the direct ledger retained-credit cap blocks reserve before the attempt cap", () => {
  const paths = temporaryPaths("whale-acquisition-retained-cap-");
  const ledger = new AcquisitionLedger(paths.ledger, () => FIXED_NOW, ids("retained"));
  const plan = buildDiscoveryPlan(FIXED_NOW.getTime())[0];
  const reservation = ledger.reserve(plan);
  ledger.settle(reservation, {
    httpStatus: 200,
    reportedCreditCost: 130,
    reportedCreditsUsed: 130,
    outcome: "unexpected-pricing",
  });
  assert.equal(ledger.summarize().attempts, 1);
  assert.equal(ledger.summarize().retainedCredits, 130);
  assert.throws(() => ledger.reserve(plan), /retained-credit cap/);
});

test("a nonterminal provider is sampled across every discovery window and stops after six useful calls", async () => {
  const paths = temporaryPaths("whale-acquisition-ten-");
  const requests: ReturnType<typeof requestFromBody>[] = [];
  let fetchCalls = 0;
  const result = await runLiveAcquisition({
    paths,
    apiKey: "dummy-key",
    maxNewCalls: 10,
    targetTotalSuccess: 120,
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      requests.push(requestFromBody(init));
      return providerResponse(pageFromBody(init), false);
    },
    now: () => FIXED_NOW,
    monotonicNow: () => 0,
    sleep: async () => undefined,
    createAttemptId: ids("pilot"),
  });
  assert.equal(fetchCalls, 6);
  assert.equal(result.networkAttempts, 6);
  assert.equal(result.ledger.attempts, 6);
  assert.equal(result.ledger.successful, 6);
  assert.equal(result.report.discoveryCalls, 6);
  assert.equal(result.report.coverageCalls, 0);
  assert.equal(result.stoppedBecause, "work-complete");
  assert.deepEqual(requests.map((request) => request.pagination.page), [1, 1, 1, 2, 2, 2]);
  assert.equal(new Set(requests.slice(0, 3).map((request) => request.date.from)).size, 3);
  assert.ok(requests.every((request) => request.filters === undefined));
  assert.equal(statSync(paths.ledger).mode & 0o077, 0);
  assert.equal(statSync(paths.state).mode & 0o077, 0);
  assert.equal(statSync(paths.rawDirectory).mode & 0o077, 0);
  assert.equal(statSync(paths.cacheDirectory).mode & 0o077, 0);
});

test("the six-call discovery cap also counts a transient attempt before retry", async () => {
  const paths = temporaryPaths("whale-acquisition-discovery-attempt-cap-");
  let fetchCalls = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 10,
      targetTotalSuccess: 120,
      fetchImpl: async (_input, init) => {
        fetchCalls += 1;
        return fetchCalls === 6
          ? providerResponse(pageFromBody(init), false, [], 503, { "retry-after": "0" })
          : providerResponse(pageFromBody(init), false);
      },
      now: () => FIXED_NOW,
      monotonicNow: () => 0,
      sleep: async () => undefined,
      createAttemptId: ids("discovery-cap"),
    }),
    /discovery sampling call cap/,
  );
  assert.equal(fetchCalls, 6);
  const summary = summarizeAcquisitionLedger(paths.ledger);
  assert.equal(summary.discoveryAttempts, 6);
  assert.equal(summary.successful, 5);
});

test("a ten-call pilot samples all windows then independently covers two same-cutoff candidates", async () => {
  const paths = temporaryPaths("whale-acquisition-candidates-");
  const wallets = [`0x${"1".repeat(40)}`, `0x${"2".repeat(40)}`];
  const requests: ReturnType<typeof requestFromBody>[] = [];
  let discoveryRequests = 0;
  const result = await runLiveAcquisition({
    paths,
    apiKey: "dummy-key",
    maxNewCalls: 10,
    targetTotalSuccess: 120,
    fetchImpl: async (_input, init) => {
      const request = requestFromBody(init);
      requests.push(request);
      if (!request.filters) {
        discoveryRequests += 1;
        const timestamp = new Date(Date.parse(request.date.from) + 1).toISOString();
        const rows = discoveryRequests === 1 && request.pagination.page === 1
          ? [providerRow(wallets[0], timestamp, "a"), providerRow(wallets[1], timestamp, "b")]
          : [];
        return providerResponse(request.pagination.page, false, rows);
      }
      return providerResponse(request.pagination.page, false);
    },
    now: () => FIXED_NOW,
    monotonicNow: () => 0,
    sleep: async () => undefined,
    createAttemptId: ids("candidate-pilot"),
  });
  assert.equal(result.networkAttempts, 10);
  assert.equal(result.report.discoveryCalls, 3);
  assert.equal(result.report.coverageCalls, 7);
  assert.equal(result.report.candidates, 2);
  assert.equal(result.stoppedBecause, "per-run-limit");
  assert.ok(requests.slice(0, 3).every((request) => request.filters === undefined));
  assert.ok(requests.slice(3).every((request) => wallets.includes(request.filters?.trader_address ?? "")));
  assert.deepEqual(new Set(requests.slice(3).map((request) => request.filters?.trader_address)), new Set(wallets));
  const state = JSON.parse(readFileSync(paths.state, "utf8")) as {
    work: { workId: string; purpose: string; cutoffMs: number | null }[];
  };
  const coverage = state.work.filter((work) => work.purpose === "coverage");
  assert.equal(coverage.length, 2);
  assert.equal(new Set(coverage.map((work) => work.workId)).size, 2);
  assert.equal(new Set(coverage.map((work) => work.cutoffMs)).size, 1);
});

test("an ignored wallet filter stops after the first nonterminal coverage attempt", async () => {
  const paths = temporaryPaths("whale-acquisition-ignored-filter-");
  const candidateWallets = [`0x${"1".repeat(40)}`, `0x${"2".repeat(40)}`];
  const wrongWallet = `0x${"9".repeat(40)}`;
  const privateHash = `0x${"f".repeat(64)}`;
  const privateLabel = "PRIVATE SYNTHETIC FILTER LABEL";
  const privateKey = "SYNTHETIC-PRIVATE-KEY";
  const requests: ReturnType<typeof requestFromBody>[] = [];
  let fetchCalls = 0;
  let errorText = "";
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: privateKey,
      maxNewCalls: 10,
      targetTotalSuccess: 120,
      fetchImpl: async (_input, init) => {
        fetchCalls += 1;
        const request = requestFromBody(init);
        requests.push(request);
        if (!request.filters) {
          const timestamp = new Date(Date.parse(request.date.from) + 1).toISOString();
          return providerResponse(request.pagination.page, false, [
            providerRow(candidateWallets[0], timestamp, String(fetchCalls)),
            providerRow(candidateWallets[1], timestamp, String(fetchCalls + 3)),
          ]);
        }
        return providerResponse(request.pagination.page, false, [
          {
            ...providerRow(wrongWallet, "2026-09-01T00:00:00.000Z", "f"),
            transaction_hash: privateHash,
            trader_address_label: privateLabel,
            estimated_value_usd: 25_000,
          },
        ]);
      },
      now: () => FIXED_NOW,
      monotonicNow: () => 0,
      sleep: async () => undefined,
      createAttemptId: ids("ignored-filter"),
    }),
    (error: unknown) => {
      errorText = error instanceof Error ? error.message : String(error);
      return /coverage-page rejection: wallet-filter-not-applied/.test(errorText);
    },
  );

  assert.equal(fetchCalls, 4);
  assert.equal(requests.filter((request) => request.filters === undefined).length, 3);
  assert.equal(requests.filter((request) => request.filters !== undefined).length, 1);
  assert.equal(requests[3].pagination.page, 1);

  const ledger = summarizeAcquisitionLedger(paths.ledger);
  assert.equal(ledger.attempts, 4);
  assert.equal(ledger.discoveryAttempts, 3);
  assert.equal(ledger.coverageAttempts, 1);
  assert.equal(ledger.successful, 3);
  assert.equal(ledger.combinedSuccessfulCalls, 6);
  assert.equal(ledger.reportedCreditsUsed, 4);
  assert.equal(ledger.retainedCredits, 4);
  assert.equal(ledger.failureReasons["wallet-filter-not-applied"], 1);
  const ledgerFile = JSON.parse(readFileSync(paths.ledger, "utf8")) as {
    attempts: Array<{ phase: string; purpose: string; outcome: string; failureReason: string | null }>;
  };
  const rejectedAttempt = ledgerFile.attempts.findLast(
    (attempt) => attempt.phase === "settled" && attempt.purpose === "coverage",
  );
  assert.ok(rejectedAttempt);
  assert.equal(rejectedAttempt.outcome, "invalid-response");
  assert.equal(rejectedAttempt.failureReason, "wallet-filter-not-applied");

  const report = JSON.parse(readFileSync(paths.aggregateReport, "utf8")) as {
    successes: number;
    coveragePages: Array<Record<string, unknown>>;
  };
  assert.equal(report.successes, 3);
  assert.deepEqual(report.coveragePages, [
    {
      rowCount: 1,
      walletMatchCount: 0,
      tokenMatchCount: 1,
      structurallyValidRowCount: 1,
      structurallyInvalidRowCount: 0,
      rejectionReason: "wallet-filter-not-applied",
      timeSpanBand: "under-1-hour",
      pagination: { page: 1, perPage: 100, isLastPage: false },
      reportedCreditCost: 1,
      latencyBand: "under-250-ms",
    },
  ]);
  const state = JSON.parse(readFileSync(paths.state, "utf8")) as { results: unknown[] };
  assert.deepEqual(state.results, []);

  const sanitized = `${JSON.stringify(report)} ${errorText}`;
  for (const forbidden of [wrongWallet, ACQUISITION_TOKEN_UNIVERSE[0].address, privateHash, privateLabel, "25000", "2026-", privateKey]) {
    assert.doesNotMatch(sanitized, new RegExp(forbidden, "i"));
  }
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

test("direct live entry rejects a limit above the reviewed pilot maximum", async () => {
  const paths = temporaryPaths("whale-acquisition-invalid-direct-limit-");
  let fetchCalls = 0;
  await assert.rejects(
    runLiveAcquisition({
      paths,
      apiKey: "dummy-key",
      maxNewCalls: 11,
      targetTotalSuccess: 120,
      fetchImpl: async () => {
        fetchCalls += 1;
        return providerResponse(1, true);
      },
    }),
    /call limit/,
  );
  assert.equal(fetchCalls, 0);
});

test("cache hits complete deterministic discovery work without an upstream call", async () => {
  const paths = temporaryPaths("whale-acquisition-cache-");
  mkdirSync(paths.cacheDirectory, { recursive: true, mode: 0o700 });
  for (const plan of buildDiscoveryPlan(FIXED_NOW.getTime())) {
    const fingerprint = acquisitionRequestFingerprint(plan.request, "discovery");
    writeFileSync(
      join(paths.cacheDirectory, `${fingerprint}.json`),
      `${JSON.stringify({
        cacheVersion: 3,
        fingerprint,
        retrievalTimeMs: FIXED_NOW.getTime(),
        requestId: `cached-${fingerprint.slice(0, 8)}`,
        reportedCreditCost: 1,
        latencyMs: 100,
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
  assert.equal(result.ledger.successful, 0);
  assert.equal(result.report.discoveryCalls, 0);
  assert.equal(result.report.coverageCalls, 0);
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

test("a lock held by another process blocks scratch acquisition before reserve or fetch", async () => {
  const paths = temporaryPaths("whale-acquisition-process-lock-");
  mkdirSync(join(paths.repositoryRoot, "data", "ledgers"), { recursive: true, mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');const p=process.argv[1];fs.writeFileSync(p,'synthetic lock\\n',{flag:'wx',mode:0o600});setInterval(()=>{},1000)",
      paths.lock,
    ],
    { stdio: "ignore" },
  );
  await once(child, "spawn");
  for (let tries = 0; tries < 100 && !existsSync(paths.lock); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(existsSync(paths.lock), true);
  let fetchCalls = 0;
  try {
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
      /Acquisition lock is already held or unsafe/,
    );
    assert.equal(fetchCalls, 0);
    assert.equal(existsSync(paths.ledger), false);
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});

test("malformed and truncated private workflow state fail closed before fetch", async () => {
  for (const [name, state] of [["malformed", "{}\n"], ["truncated", '{"stateVersion":3']] as const) {
    const paths = temporaryPaths(`whale-acquisition-state-${name}-`);
    mkdirSync(join(paths.repositoryRoot, "data", "private", "nansen-acquisition"), {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(paths.state, state, { mode: 0o600 });
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
      /JSON is malformed|state is malformed or version-mismatched/,
    );
    assert.equal(fetchCalls, 0);
    assert.equal(existsSync(paths.ledger), false);
  }
});

test("failure to fsync a durable reservation prevents the provider fetch", async () => {
  const paths = temporaryPaths("whale-acquisition-reservation-sync-");
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
      durabilityHooks: {
        syncDirectory: (path) => {
          if (path.endsWith(join("data", "ledgers"))) throw new Error("synthetic ledger directory sync failure");
        },
      },
    }),
    /synthetic ledger directory sync failure/,
  );
  assert.equal(fetchCalls, 0);
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
  const wallet = `0x${"3".repeat(40)}`;
  const coverageRequest = buildAcquisitionRequest(ACQUISITION_TOKEN_UNIVERSE[0], 1_000, 2_000, 1, wallet);
  assert.deepEqual(Object.keys(coverageRequest).sort(), [
    "chain",
    "date",
    "filters",
    "only_smart_money",
    "order_by",
    "pagination",
    "token_address",
  ]);
  assert.deepEqual(coverageRequest.filters, { trader_address: wallet });
});
