/**
 * SYNTHETIC OFFLINE RUNNER TESTS ONLY.
 * Every request is an injected in-memory function. The test command also
 * preloads an outbound-network guard.
 */
import assert from "node:assert/strict";
import { existsSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  parseSpikeArguments,
  readNansenApiKey,
  resolveSpikePaths,
  runLiveSpike,
  runSpikeCommand,
  type AttemptReport,
  type FetchLike,
  type SpikePaths,
} from "../lib/server/nansen-spike-runner";

function validEnvelope() {
  return { data: [], pagination: { page: 1, per_page: 3, is_last_page: true } };
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

test("canonical production paths do not depend on process.cwd", () => {
  const paths = resolveSpikePaths();
  assert.equal(paths.repositoryRoot, REPOSITORY_ROOT);
  assert.equal(paths.ledger, join(REPOSITORY_ROOT, "data", "ledgers", "nansen-contract-spike.jsonl"));
  assert.equal(paths.lock, `${paths.ledger}.lock`);
});

test("unknown and duplicate arguments are rejected", () => {
  assert.equal(parseSpikeArguments([]), "dry-run");
  assert.equal(parseSpikeArguments(["--live"]), "live");
  assert.equal(parseSpikeArguments(["--status"]), "status");
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

test("unexpected reported pricing stops after one attempt", async () => {
  const paths = await temporaryPaths("whale-gossip-pricing-");
  let fetchCalls = 0;
  await assert.rejects(
    runLiveSpike({
      apiKey: "dummy-key",
      paths,
      fetchImpl: async () => {
        fetchCalls += 1;
        return response(200, validEnvelope(), { "x-nansen-credits-cost": "2", "x-nansen-credits-used": "2" });
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
  const fetchImpl: FetchLike = async (_input, init) => {
    fetchCalls += 1;
    assert.equal(init.redirect, "error");
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

test("negative, signed-zero, and malformed credit headers are unknown", () => {
  for (const value of ["-1", "-0", "not-a-number", "Infinity", "", " "]) {
    assert.equal(parseNonnegativeHeader(value), null);
  }
  assert.equal(parseNonnegativeHeader(null), null);
  assert.equal(parseNonnegativeHeader("0"), 0);
  assert.equal(parseNonnegativeHeader("1"), 1);
});

test("persisted attempt count never exceeds five", async () => {
  const paths = await temporaryPaths("whale-gossip-five-attempts-");
  const ledger = new ContractSpikeLedger(paths.ledger, undefined, idSequence("cap"));
  const fingerprint = requestFingerprint(buildProbeRequest());
  for (let count = 0; count < 5; count += 1) ledger.reserve(fingerprint, { page: 1, perPage: 3 });
  assert.throws(() => ledger.reserve(fingerprint, { page: 1, perPage: 3 }), /attempt cap/);
  assert.equal(ledger.summarize().attempts, 5);
});
