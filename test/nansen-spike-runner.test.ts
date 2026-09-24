/**
 * SYNTHETIC OFFLINE RUNNER TESTS ONLY.
 * Every runner request is an injected in-memory function. The standard test
 * command preloads an outbound-network guard, whose own sanity test invokes
 * controlled dummy fetch/socket calls and requires them to be blocked.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  ContractSpikeLedger,
  acquireContractSpikeLock,
  parseNonnegativeHeader,
  requestFingerprint,
  buildProbeRequest,
} from "../lib/server/nansen-contract";
import {
  REPOSITORY_ROOT,
  assertCanonicalEnvironmentIsIgnored,
  parseSpikeArguments,
  readNansenApiKey,
  resolveSpikePaths,
  runLiveSpike,
  runPaginationProbe,
  runSpikeCommand,
  type AttemptReport,
  type FetchLike,
  type SpikePaths,
} from "../lib/server/nansen-spike-runner";

function validEnvelope(page = 1, isLastPage = true) {
  return { data: [], pagination: { page, per_page: 3, is_last_page: isLastPage } };
}

function response(status: number, body: unknown = { error: "synthetic" }, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-nansen-credits-cost": "1", "x-nansen-credits-used": "1", ...headers },
  });
}

async function temporaryPaths(prefix: string): Promise<SpikePaths> {
  return resolveSpikePaths(await mkdtemp(join(tmpdir(), prefix)));
}

function idSequence(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}

function seedSuccessfulPageOne(paths: SpikePaths): void {
  const ledger = new ContractSpikeLedger(paths.ledger, undefined, () => "historical-page-1");
  const reservation = ledger.reserve(requestFingerprint(buildProbeRequest(1)), { page: 1, perPage: 3 });
  ledger.settle(reservation, {
    httpStatus: 200,
    latencyMs: 920,
    reportedCreditCost: 1,
    reportedCreditsUsed: 1,
    outcome: "success",
  });
}

test("canonical production paths do not depend on process.cwd", () => {
  const paths = resolveSpikePaths();
  assert.equal(paths.repositoryRoot, REPOSITORY_ROOT);
  assert.equal(paths.ledger, join(REPOSITORY_ROOT, "data", "ledgers", "nansen-contract-spike.jsonl"));
  assert.equal(paths.lock, `${paths.ledger}.lock`);
});

test("unknown and duplicate arguments are rejected", () => {
  assert.equal(parseSpikeArguments([]), "dry-run");
  assert.equal(parseSpikeArguments(["--live"]), "live");
  assert.equal(parseSpikeArguments(["--live", "--pagination-probe"]), "pagination-probe");
  assert.equal(parseSpikeArguments(["--status"]), "status");
  assert.throws(() => parseSpikeArguments(["--pagination-probe"]), /Unsupported argument/);
  assert.throws(() => parseSpikeArguments(["--pagination-probe", "--live"]), /Unsupported argument/);
  assert.throws(() => parseSpikeArguments(["--unknown"]), /Unsupported argument/);
  assert.throws(() => parseSpikeArguments(["--live", "--live"]), /Unsupported argument/);
});

test("sanitized status reads accounting without a key, lock, or fetch", async () => {
  const paths = await temporaryPaths("whale-gossip-status-");
  const ledger = new ContractSpikeLedger(paths.ledger, undefined, () => "status-attempt");
  ledger.reserve(requestFingerprint(buildProbeRequest()), { page: 1, perPage: 3 });
  let keyReads = 0;
  let fetchCalls = 0;
  const result = await runSpikeCommand(["--status"], {
    paths,
    readKey: () => {
      keyReads += 1;
      return "unused";
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return response(200, validEnvelope());
    },
  });
  assert.equal(result.mode, "status");
  assert.equal(result.networkRequestSent, false);
  assert.equal(result.ledger.attempts, 1);
  assert.equal(keyReads, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(existsSync(paths.lock), false);
});

test("canonical environment enforcement uses an ignored and untracked file in a dummy repository", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "whale-gossip-git-guard-"));
  const paths = resolveSpikePaths(repositoryRoot);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: repositoryRoot }).status, 0);
  writeFileSync(join(repositoryRoot, ".gitignore"), ".env.local\n");
  writeFileSync(paths.environmentFile, "NANSEN_API_KEY=dummy-only\n", { mode: 0o600 });
  assert.doesNotThrow(() => assertCanonicalEnvironmentIsIgnored(paths));

  assert.equal(spawnSync("git", ["add", "-f", "--", ".env.local"], { cwd: repositoryRoot }).status, 0);
  assert.throws(() => assertCanonicalEnvironmentIsIgnored(paths), /tracked/);

  const unignoredRoot = await mkdtemp(join(tmpdir(), "whale-gossip-git-unignored-"));
  const unignoredPaths = resolveSpikePaths(unignoredRoot);
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: unignoredRoot }).status, 0);
  writeFileSync(unignoredPaths.environmentFile, "NANSEN_API_KEY=dummy-only\n", { mode: 0o600 });
  assert.throws(() => assertCanonicalEnvironmentIsIgnored(unignoredPaths), /not ignored/);
});

test("pagination probe refuses every state except the single settled page-1 success", async () => {
  const paths = await temporaryPaths("whale-gossip-pagination-state-");
  let fetchCalls = 0;
  await assert.rejects(
    runPaginationProbe({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, validEnvelope(2));
      },
    }),
    /exactly one settled successful historical attempt/,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(existsSync(paths.lock), false);
});

test("pagination probe rejects contradictory page-1 accounting before fetch", async () => {
  const paths = await temporaryPaths("whale-gossip-pagination-accounting-");
  const ledger = new ContractSpikeLedger(paths.ledger, undefined, () => "uncertain-page-1");
  const reservation = ledger.reserve(requestFingerprint(buildProbeRequest(1)), { page: 1, perPage: 3 });
  ledger.settle(reservation, {
    httpStatus: 200,
    latencyMs: 1,
    reportedCreditCost: 1,
    reportedCreditsUsed: null,
    outcome: "success",
  });
  let fetchCalls = 0;
  await assert.rejects(
    runPaginationProbe({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, validEnvelope(2));
      },
    }),
    /does not match the expected safe page-1 state/,
  );
  assert.equal(fetchCalls, 0);
});

test("page-1 live mode cannot consume continuation attempts after the historical success", async () => {
  const paths = await temporaryPaths("whale-gossip-page-1-replay-");
  seedSuccessfulPageOne(paths);
  let fetchCalls = 0;
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, validEnvelope());
      },
    }),
    /requires an empty contract-spike ledger/,
  );
  assert.equal(fetchCalls, 0);
});

test("pagination probe stops after page 2 when page 2 is terminal", async () => {
  const paths = await temporaryPaths("whale-gossip-page-2-terminal-");
  seedSuccessfulPageOne(paths);
  const requestedPages: number[] = [];
  const reports = await runPaginationProbe({
    apiKey: "dummy-key",
    paths,
    fetchImpl: async (_input, init) => {
      requestedPages.push((JSON.parse(String(init.body)) as { pagination: { page: number } }).pagination.page);
      return response(200, validEnvelope(2, true));
    },
    createAttemptId: idSequence("page-2-terminal"),
    writeRawResponse: () => undefined,
  });
  assert.deepEqual(requestedPages, [2]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].mode, "pagination-probe");
  assert.equal(reports[0].ledger.attempts, 2);
});

test("pagination probe requests page 3 only after a valid nonterminal page 2 and then stops", async () => {
  const paths = await temporaryPaths("whale-gossip-pages-2-3-");
  seedSuccessfulPageOne(paths);
  const requestedPages: number[] = [];
  const reports = await runPaginationProbe({
    apiKey: "dummy-key",
    paths,
    fetchImpl: async (_input, init) => {
      const page = (JSON.parse(String(init.body)) as { pagination: { page: number } }).pagination.page;
      requestedPages.push(page);
      return response(200, validEnvelope(page, false));
    },
    createAttemptId: idSequence("pages-2-3"),
    writeRawResponse: () => undefined,
  });
  assert.deepEqual(requestedPages, [2, 3]);
  assert.equal(reports.length, 2);
  assert.equal(reports[1].ledger.attempts, 3);
  assert.equal(reports[1].contractSummary?.pagination.isLastPage, false);
});

test("pagination probe never retries a transient failure", async () => {
  const paths = await temporaryPaths("whale-gossip-pagination-no-retry-");
  seedSuccessfulPageOne(paths);
  let fetchCalls = 0;
  await assert.rejects(
    runPaginationProbe({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(503, { error: "synthetic transient" }, { "retry-after": "0" });
      },
      createAttemptId: idSequence("pagination-no-retry"),
      writeRawResponse: () => undefined,
    }),
    /retries are disabled/,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(new ContractSpikeLedger(paths.ledger).summarize().attempts, 2);
});

for (const status of [401, 402, 403]) {
  test(`live runner stops after one reserved attempt on HTTP ${status}`, async () => {
    const paths = await temporaryPaths(`whale-gossip-${status}-`);
    let fetchCalls = 0;
    const reports: AttemptReport[] = [];
    await assert.rejects(
      runLiveSpike({
        apiKey: "dummy-key",
        paths,
        fetchImpl: async () => {
          fetchCalls += 1;
          return response(status);
        },
        createAttemptId: idSequence(`status-${status}`),
        writeRawResponse: () => undefined,
        onAttempt: (report) => reports.push(report),
      }),
      /Stopped after/,
    );
    assert.equal(fetchCalls, 1);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].ledger.attempts, 1);
    assert.equal(existsSync(paths.lock), false);
  });
}

test("two eligible transient 503 responses produce exactly two attempts", async () => {
  const paths = await temporaryPaths("whale-gossip-503-");
  let fetchCalls = 0;
  const sleeps: number[] = [];
  const reports: AttemptReport[] = [];
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(503);
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      createAttemptId: idSequence("transient"),
      writeRawResponse: () => undefined,
      onAttempt: (report) => reports.push(report),
    }),
    /bounded retry limit/,
  );
  assert.equal(fetchCalls, 2);
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(reports.map((report) => report.ledger.attempts), [1, 2]);
});

test("normal live mode retries one 429 response according to a bounded Retry-After", async () => {
  const paths = await temporaryPaths("whale-gossip-429-");
  let fetchCalls = 0;
  const sleeps: number[] = [];
  const reports = await runLiveSpike({
    apiKey: "dummy-key",
    paths,
    fetchImpl: async () => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? response(429, { error: "synthetic rate limit" }, { "retry-after": "0.25" })
        : response(200, validEnvelope());
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    createAttemptId: idSequence("rate-limit"),
    writeRawResponse: () => undefined,
  });
  assert.equal(fetchCalls, 2);
  assert.deepEqual(sleeps, [500]);
  assert.deepEqual(reports.map((report) => report.outcome), ["rate-limited", "success"]);
});

test("oversized Retry-After stops without a second request", async () => {
  const paths = await temporaryPaths("whale-gossip-retry-after-");
  let fetchCalls = 0;
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(503, { error: "synthetic transient" }, { "retry-after": "31" });
      },
      createAttemptId: idSequence("retry-after"),
      writeRawResponse: () => undefined,
    }),
    /Retry-After was invalid or exceeded/,
  );
  assert.equal(fetchCalls, 1);
});

test("unexpected reported pricing stops after one attempt", async () => {
  const paths = await temporaryPaths("whale-gossip-pricing-");
  let fetchCalls = 0;
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, validEnvelope(), { "x-nansen-credits-cost": "2", "x-nansen-credits-used": "1" });
      },
      createAttemptId: idSequence("pricing"),
      writeRawResponse: () => undefined,
    }),
    /unexpected pricing/,
  );
  assert.equal(fetchCalls, 1);
});

test("redirects are rejected and one reservation can issue only one fetch", async () => {
  const paths = await temporaryPaths("whale-gossip-redirect-");
  let fetchCalls = 0;
  const reports: AttemptReport[] = [];
  let receivedRedirect: RequestRedirect | undefined;
  const fetchImpl: FetchLike = async (_input, init) => {
    fetchCalls += 1;
    receivedRedirect = init.redirect;
    throw new TypeError("synthetic redirect rejected");
  };
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl,
      createAttemptId: idSequence("redirect"),
      writeRawResponse: () => undefined,
      onAttempt: (report) => reports.push(report),
    }),
    /non-retryable/,
  );
  assert.equal(fetchCalls, 1);
  assert.equal(receivedRedirect, "error");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].outcome, "request-error");
  assert.equal(reports[0].ledger.attempts, 1);
});

test("malformed pagination cannot count as success", async () => {
  const paths = await temporaryPaths("whale-gossip-pagination-");
  const reports: AttemptReport[] = [];
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => response(200, { data: [], pagination: { page: "one" } }),
      createAttemptId: idSequence("pagination"),
      writeRawResponse: () => undefined,
      onAttempt: (report) => reports.push(report),
    }),
    /invalid provider response/,
  );
  assert.equal(reports[0].outcome, "invalid-response");
  assert.equal(reports[0].ledger.successful, 0);
});

test("response status and credit headers survive a raw-write failure", async () => {
  const paths = await temporaryPaths("whale-gossip-raw-write-");
  const reports: AttemptReport[] = [];
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => response(200, validEnvelope()),
      createAttemptId: idSequence("raw-write"),
      writeRawResponse: () => {
        throw new Error("synthetic disk failure");
      },
      onAttempt: (report) => reports.push(report),
    }),
    /non-retryable/,
  );
  assert.equal(reports[0].httpStatus, 200);
  assert.equal(reports[0].reportedCreditCost, 1);
  assert.equal(reports[0].reportedCreditsUsed, 1);
  assert.equal(reports[0].retainedCredits, 1);
  assert.equal(reports[0].outcome, "request-error");
});

test("a second concurrent live runner cannot lock, reserve, or send", async () => {
  const paths = await temporaryPaths("whale-gossip-concurrent-");
  let resolveFirst: ((value: Response) => void) | undefined;
  let firstFetchCalls = 0;
  let secondFetchCalls = 0;
  const first = runLiveSpike({
    apiKey: "dummy-key",
    paths,
    fetchImpl: async () => {
      firstFetchCalls += 1;
      return await new Promise<Response>((resolveResponse) => {
        resolveFirst = resolveResponse;
      });
    },
    createAttemptId: idSequence("first"),
    writeRawResponse: () => undefined,
  });

  assert.equal(firstFetchCalls, 1);
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        secondFetchCalls += 1;
        return response(200, validEnvelope());
      },
      createAttemptId: idSequence("second"),
      writeRawResponse: () => undefined,
    }),
    /lock is already held or unsafe/,
  );
  assert.equal(secondFetchCalls, 0);
  assert.equal(new ContractSpikeLedger(paths.ledger).summarize().attempts, 1);

  assert.ok(resolveFirst);
  resolveFirst(response(401));
  await assert.rejects(first, /authentication response/);
  assert.equal(new ContractSpikeLedger(paths.ledger).summarize().attempts, 1);
  assert.equal(existsSync(paths.lock), false);
});

test("a crash-left lock fails closed until manually removed", async () => {
  const paths = await temporaryPaths("whale-gossip-crash-lock-");
  const lock = acquireContractSpikeLock(paths.lock);
  assert.equal(statSync(paths.lock).mode & 0o077, 0);
  lock.release();
  writeFileSync(paths.lock, "synthetic crash-left lock\n", { mode: 0o600 });
  let fetchCalls = 0;
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, validEnvelope());
      },
      createAttemptId: idSequence("crash"),
      writeRawResponse: () => undefined,
    }),
    /lock is already held or unsafe/,
  );
  assert.equal(fetchCalls, 0);
  assert.equal(existsSync(paths.ledger), false);
  assert.equal(existsSync(paths.lock), true);
  unlinkSync(paths.lock);
});

test("run and lock-release failures preserve both sanitized errors", async () => {
  const paths = await temporaryPaths("whale-gossip-release-failure-");
  const movedLock = `${paths.lock}.original`;
  let captured: unknown;
  try {
    await runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        renameSync(paths.lock, movedLock);
        writeFileSync(paths.lock, "synthetic replacement\n", { mode: 0o600 });
        return response(401);
      },
      createAttemptId: idSequence("release-failure"),
      writeRawResponse: () => undefined,
    });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof AggregateError);
  assert.match(captured.message, /run failed and its lock could not be released/);
  assert.equal(captured.errors.length, 2);
  assert.match(String(captured.errors[0]), /authentication response/);
  assert.match(String(captured.errors[1]), /lock changed while held/);
  assert.equal(readFileSync(paths.lock, "utf8"), "synthetic replacement\n");
  unlinkSync(paths.lock);
  unlinkSync(movedLock);
});

test("key source ignores process.env and malformed sentinels never appear in diagnostics", async () => {
  const paths = await temporaryPaths("whale-gossip-key-");
  writeFileSync(paths.environmentFile, "NANSEN_API_KEY=file-only-dummy\nUNRELATED=ignored\n", { mode: 0o600 });
  const previous = process.env.NANSEN_API_KEY;
  process.env.NANSEN_API_KEY = "shell-must-not-win";
  try {
    assert.equal(readNansenApiKey(paths.environmentFile), "file-only-dummy");
  } finally {
    if (previous === undefined) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = previous;
  }

  const sentinel = "SENTINEL-KEY-MUST-NOT-LEAK";
  let captured = "";
  let fetchCalls = 0;
  try {
    await runLiveSpike({
      apiKey: `${sentinel}\n`,
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, validEnvelope());
      },
    });
  } catch (error) {
    captured = error instanceof Error ? error.message : String(error);
  }
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(captured, new RegExp(sentinel));
  assert.match(captured, /malformed/);
});

test("credential diagnostics distinguish missing files, unsafe files, missing keys, and invalid values", async () => {
  const paths = await temporaryPaths("whale-gossip-key-errors-");
  assert.throws(() => readNansenApiKey(paths.environmentFile), /credential file is missing/);

  writeFileSync(paths.environmentFile, "NANSEN_API_KEY=dummy\n", { mode: 0o644 });
  assert.throws(() => readNansenApiKey(paths.environmentFile), /unsafe permissions/);

  unlinkSync(paths.environmentFile);
  writeFileSync(paths.environmentFile, "UNRELATED=dummy\n", { mode: 0o600 });
  assert.throws(() => readNansenApiKey(paths.environmentFile), /NANSEN_API_KEY is missing/);

  writeFileSync(paths.environmentFile, "NANSEN_API_KEY=\n", { mode: 0o600 });
  assert.throws(() => readNansenApiKey(paths.environmentFile), /NANSEN_API_KEY.*invalid/);
});

test("negative, signed-zero, and malformed credit headers are unknown", () => {
  for (const value of ["-1", "-0", "not-a-number", "Infinity", "", " "]) {
    assert.equal(parseNonnegativeHeader(value), null);
  }
  assert.equal(parseNonnegativeHeader(null), null);
  assert.equal(parseNonnegativeHeader("0"), 0);
  assert.equal(parseNonnegativeHeader("1"), 1);
});

test("persisted attempt count never exceeds three", async () => {
  const paths = await temporaryPaths("whale-gossip-three-attempts-");
  const ledger = new ContractSpikeLedger(paths.ledger, undefined, idSequence("cap"));
  const fingerprint = requestFingerprint(buildProbeRequest());
  for (let count = 0; count < 3; count += 1) ledger.reserve(fingerprint, { page: 1, perPage: 3 });
  assert.throws(() => ledger.reserve(fingerprint, { page: 1, perPage: 3 }), /attempt cap/);
  assert.equal(ledger.summarize().attempts, 3);
});

test("importing the CLI module does not execute a command or mutate process status", async () => {
  const originalExitCode = process.exitCode;
  const originalLog = console.log;
  const originalError = console.error;
  const output: unknown[] = [];
  console.log = (...values: unknown[]) => output.push(values);
  console.error = (...values: unknown[]) => output.push(values);
  try {
    const importedScript = await import("../scripts/nansen-contract-spike");
    assert.equal(typeof importedScript.main, "function");
    assert.deepEqual(output, []);
    assert.equal(process.exitCode, originalExitCode);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});
