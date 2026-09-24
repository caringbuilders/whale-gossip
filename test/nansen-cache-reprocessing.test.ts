import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ACQUISITION_TOKEN_UNIVERSE,
  buildAcquisitionRequest,
  buildDiscoveryPlan,
  legacyAcquisitionRequestFingerprintV3,
} from "../lib/server/nansen-acquisition";
import {
  resolveAcquisitionPaths,
  runAcquisitionCommand,
  type AcquisitionPaths,
} from "../lib/server/nansen-acquisition-runner";
import { acquireContractSpikeLock } from "../lib/server/nansen-contract";

const FIXED_NOW = new Date("2026-09-24T12:00:00.000Z");
const WALLET = `0x${"1".repeat(40)}`;
const PRIVATE_LABEL = "PRIVATE REPROCESSING LABEL";
const PRIVATE_KEY = "SYNTHETIC-PRIVATE-KEY";

interface LegacyFixture {
  readonly paths: AcquisitionPaths;
  readonly legacyFiles: readonly string[];
}

function writePrivateJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function hash(index: number): string {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function makeLegacyFixture(): LegacyFixture {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "whale-cache-reprocess-"));
  const paths = resolveAcquisitionPaths(repositoryRoot);
  const privateRoot = join(repositoryRoot, "data", "private", "nansen-acquisition");
  const ledgerRoot = join(repositoryRoot, "data", "ledgers");
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  chmodSync(privateRoot, 0o700);
  mkdirSync(paths.legacyCacheDirectory, { mode: 0o700 });
  chmodSync(paths.legacyCacheDirectory, 0o700);
  mkdirSync(ledgerRoot, { recursive: true, mode: 0o700 });
  chmodSync(ledgerRoot, 0o700);

  const work: Array<Record<string, unknown>> = [];
  const ledgerAttempts: Array<Record<string, unknown>> = [];
  const legacyFiles: string[] = [];
  let globalRow = 0;
  for (const [workIndex, plan] of buildDiscoveryPlan(FIXED_NOW.getTime()).entries()) {
    const completedPages: Array<{ page: number; fingerprint: string; requestId: string }> = [];
    for (const page of [1, 2]) {
      const request = buildAcquisitionRequest(plan.token, plan.localFromMs, plan.localToMsExclusive, page);
      const fingerprint = legacyAcquisitionRequestFingerprintV3(request, "discovery");
      const requestId = `legacy-discovery-${workIndex + 1}-${page}`;
      completedPages.push({ page, fingerprint, requestId });
      const rows = Array.from({ length: 100 }, (_, rowIndex) => {
        globalRow += 1;
        const occurredAtMs = plan.localFromMs + (page - 1) * 100_000 + rowIndex * 1_000;
        return {
          block_timestamp: new Date(occurredAtMs).toISOString().replace(".000Z", "Z"),
          transaction_hash: hash(globalRow),
          trader_address: WALLET,
          trader_address_label: PRIVATE_LABEL,
          token_address: ACQUISITION_TOKEN_UNIVERSE[0].address,
          action: globalRow % 2 === 0 ? "BUY" : "SELL",
          estimated_value_usd: 25_000,
          privateNested: { key: PRIVATE_KEY },
        };
      });
      const cachePath = join(paths.legacyCacheDirectory, `${fingerprint}.json`);
      writePrivateJson(cachePath, {
        cacheVersion: 3,
        fingerprint,
        retrievalTimeMs: FIXED_NOW.getTime(),
        requestId,
        reportedCreditCost: 1,
        latencyMs: 100,
        response: { data: rows, pagination: { page, per_page: 100, is_last_page: false } },
      });
      legacyFiles.push(cachePath);
      const common = {
        attemptId: requestId,
        requestFingerprint: fingerprint,
        purpose: "discovery",
        page,
        reservedCredits: 1,
        recordedAt: FIXED_NOW.toISOString(),
        failureReason: null,
      };
      ledgerAttempts.push({
        ...common,
        phase: "reserved",
        retainedCredits: 1,
        httpStatus: null,
        reportedCreditCost: null,
        reportedCreditsUsed: null,
        outcome: "pending",
      });
      ledgerAttempts.push({
        ...common,
        phase: "settled",
        retainedCredits: 1,
        httpStatus: 200,
        reportedCreditCost: 1,
        reportedCreditsUsed: 1,
        outcome: "success",
      });
    }
    const pageOneRequest = buildAcquisitionRequest(plan.token, plan.localFromMs, plan.localToMsExclusive, 1);
    work.push({
      workId: `discovery-${legacyAcquisitionRequestFingerprintV3(pageOneRequest, "discovery").slice(0, 24)}`,
      purpose: "discovery",
      candidateId: null,
      token: plan.token,
      wallet: null,
      cutoffMs: null,
      localFromMs: plan.localFromMs,
      localToMsExclusive: plan.localToMsExclusive,
      nextPage: 3,
      completedPages,
      complete: true,
      samplingStatus: "sampled",
    });
  }
  writePrivateJson(paths.legacyState, {
    stateVersion: 3,
    adapterVersion: "3",
    schemaVersion: 3,
    initializedAtMs: FIXED_NOW.getTime(),
    work,
    candidates: [],
    results: [],
    counters: { discoveryCalls: 6, coverageCalls: 0, rows: 600 },
    discoveryPages: Array.from({ length: 6 }, () => ({ historical: true })),
    coveragePages: [],
  });
  writePrivateJson(paths.ledger, { ledgerVersion: 2, attempts: ledgerAttempts });
  legacyFiles.push(paths.legacyState, paths.ledger);
  return { paths, legacyFiles };
}

function snapshots(paths: readonly string[]) {
  return paths.map((path) => ({
    path,
    contents: readFileSync(path, "utf8"),
    size: lstatSync(path).size,
    mtimeMs: lstatSync(path).mtimeMs,
  }));
}

function assertSnapshotsUnchanged(before: ReturnType<typeof snapshots>): void {
  for (const snapshot of before) {
    assert.equal(readFileSync(snapshot.path, "utf8"), snapshot.contents);
    assert.equal(lstatSync(snapshot.path).size, snapshot.size);
    assert.equal(lstatSync(snapshot.path).mtimeMs, snapshot.mtimeMs);
  }
}

test("synthetic v3 cache reprocessing is provenance-preserving, zero-cost, and idempotent", async () => {
  const fixture = makeLegacyFixture();
  const before = snapshots(fixture.legacyFiles);
  let fetchCalls = 0;
  let keyReads = 0;
  const options = {
    paths: fixture.paths,
    now: () => FIXED_NOW,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
    readKey: () => {
      keyReads += 1;
      throw new Error("key must not be read");
    },
  };
  const first = await runAcquisitionCommand(["--reprocess-cache"], options);
  assert.deepEqual(first, {
    reprocessingVersion: 1,
    mode: "reprocess-cache",
    cachePagesReprocessed: 6,
    rowsExamined: 600,
    validRows: 600,
    invalidRows: 0,
    timestampPrecision: { wholeSecond: 600, exactMillisecond: 0 },
    qualifyingRows: 600,
    distinctCandidates: 3,
    rejectionCounts: {
      "action-invalid": 0,
      "duplicate-row": 0,
      "timestamp-precision-or-value-invalid": 0,
      "token-address-mismatch": 0,
      "transaction-hash-invalid": 0,
      "usd-value-invalid": 0,
      "wallet-address-invalid": 0,
    },
    coverageWorkItemsPlanned: 3,
    networkAttempts: 0,
    newLedgerAttempts: 0,
    newLedgerSuccesses: 0,
    newCredits: 0,
  });
  assert.equal(fetchCalls, 0);
  assert.equal(keyReads, 0);
  assertSnapshotsUnchanged(before);
  assert.equal(existsSync(fixture.paths.state), true);
  assert.equal(existsSync(fixture.paths.reprocessingManifest), true);
  assert.equal(readdirSync(fixture.paths.cacheDirectory).length, 6);
  assert.equal(existsSync(fixture.paths.lock), false);

  const privateState = JSON.parse(readFileSync(fixture.paths.state, "utf8")) as {
    provenance: { kind: string; sourceAttemptIds: string[] };
    work: Array<{ purpose: string }>;
  };
  assert.equal(privateState.provenance.kind, "reprocessed-v3-discovery");
  assert.equal(privateState.provenance.sourceAttemptIds.length, 6);
  assert.equal(privateState.work.filter((item) => item.purpose === "coverage").length, 3);
  const manifest = JSON.parse(readFileSync(fixture.paths.reprocessingManifest, "utf8")) as {
    sourceAttemptIds: string[];
    pages: Array<{ sourceAttemptId: string }>;
  };
  assert.equal(manifest.sourceAttemptIds.length, 6);
  assert.equal(manifest.pages.every((page) => manifest.sourceAttemptIds.includes(page.sourceAttemptId)), true);

  const derivedFiles = [fixture.paths.state, fixture.paths.reprocessingManifest, ...readdirSync(fixture.paths.cacheDirectory).map((name) => join(fixture.paths.cacheDirectory, name))];
  const derivedBefore = snapshots(derivedFiles);
  const second = await runAcquisitionCommand(["--reprocess-cache"], options);
  assert.deepEqual(second, first);
  assertSnapshotsUnchanged(before);
  assertSnapshotsUnchanged(derivedBefore);

  const status = await runAcquisitionCommand(["--status"], options);
  assert.equal(status.mode, "status");
  assert.equal(status.mode === "status" && status.ledger.attempts, 6);
  assert.equal(status.mode === "status" && status.ledger.successful, 6);
  assert.equal(status.mode === "status" && status.ledger.reportedCreditsUsed, 6);
  assert.equal(status.mode === "status" && status.ledger.retainedCredits, 6);
  assert.equal(status.mode === "status" && status.ledger.combinedSuccessfulCalls, 9);

  const serialized = JSON.stringify(first);
  for (const forbidden of [WALLET, PRIVATE_LABEL, PRIVATE_KEY, "0x", "block_timestamp", "estimated_value_usd", "2026-"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  }
});

test("partial writes fail closed without retrying or mutating legacy evidence", async () => {
  const fixture = makeLegacyFixture();
  const before = snapshots(fixture.legacyFiles);
  let syncCalls = 0;
  await assert.rejects(
    runAcquisitionCommand(["--reprocess-cache"], {
      paths: fixture.paths,
      now: () => FIXED_NOW,
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
      readKey: () => {
        throw new Error("key must not be read");
      },
      durabilityHooks: {
        syncDirectory: () => {
          syncCalls += 1;
          throw new Error("synthetic directory sync failure");
        },
      },
    }),
    /synthetic directory sync failure/,
  );
  assert.equal(syncCalls, 1);
  assertSnapshotsUnchanged(before);
  await assert.rejects(
    runAcquisitionCommand(["--reprocess-cache"], { paths: fixture.paths, now: () => FIXED_NOW }),
    /Partial or unexpected version-4 acquisition outputs/,
  );
  assertSnapshotsUnchanged(before);
});

test("canonical lock contention blocks cache reprocessing before writes", async () => {
  const fixture = makeLegacyFixture();
  const lock = acquireContractSpikeLock(fixture.paths.lock, () => FIXED_NOW);
  try {
    await assert.rejects(
      runAcquisitionCommand(["--reprocess-cache"], { paths: fixture.paths, now: () => FIXED_NOW }),
      /lock is already held or unsafe/,
    );
    assert.equal(existsSync(fixture.paths.state), false);
    assert.equal(existsSync(fixture.paths.cacheDirectory), false);
  } finally {
    lock.release();
  }
});

test("malformed provenance, insecure permissions, and symlinked legacy cache entries fail closed", async () => {
  const malformed = makeLegacyFixture();
  const state = JSON.parse(readFileSync(malformed.paths.legacyState, "utf8")) as {
    counters: { rows: number };
  };
  state.counters.rows = 599;
  writePrivateJson(malformed.paths.legacyState, state);
  await assert.rejects(
    runAcquisitionCommand(["--reprocess-cache"], { paths: malformed.paths, now: () => FIXED_NOW }),
    /does not match the reviewed six-page provenance/,
  );

  const broadPermissions = makeLegacyFixture();
  chmodSync(broadPermissions.paths.legacyCacheDirectory, 0o755);
  await assert.rejects(
    runAcquisitionCommand(["--reprocess-cache"], { paths: broadPermissions.paths, now: () => FIXED_NOW }),
    /permissions are too broad/,
  );
  assert.equal(existsSync(broadPermissions.paths.state), false);

  const linked = makeLegacyFixture();
  const source = linked.legacyFiles.find((path) => path.endsWith(".json") && path.includes("cache-v3"));
  assert.ok(source);
  const target = join(linked.paths.repositoryRoot, "private-cache-target.json");
  writeFileSync(target, readFileSync(source), { mode: 0o600 });
  unlinkSync(source);
  symlinkSync(target, source);
  await assert.rejects(
    runAcquisitionCommand(["--reprocess-cache"], { paths: linked.paths, now: () => FIXED_NOW }),
    /unknown or unsafe entry/,
  );
  assert.equal(existsSync(linked.paths.state), false);
});
