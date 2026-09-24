import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ACQUISITION_TOKEN_UNIVERSE,
  LEGACY_ACQUISITION_ADAPTER_VERSION,
  LEGACY_ACQUISITION_SCHEMA_VERSION,
  LEGACY_ACQUISITION_STATE_VERSION,
} from "../lib/server/nansen-acquisition";
import { resolveAcquisitionPaths, runAcquisitionCommand } from "../lib/server/nansen-acquisition-runner";
import {
  buildSanitizedCacheDiagnosticReport,
  diagnoseCanonicalDiscoveryCache,
} from "../lib/server/nansen-cache-diagnostic";

const WALLET = `0x${"1".repeat(40)}`;
const HASH = `0x${"2".repeat(64)}`;
const PRIVATE_SENTINELS = [
  WALLET,
  HASH,
  "PRIVATE LABEL",
  "2026-01-02T03:04:05.678Z",
  "98765.4321",
  "SYNTHETIC-PRIVATE-KEY",
] as const;

interface SyntheticFixture {
  readonly paths: ReturnType<typeof resolveAcquisitionPaths>;
  readonly statePath: string;
  readonly cachePaths: readonly string[];
}

function diagnosticPaths(paths: ReturnType<typeof resolveAcquisitionPaths>) {
  return {
    repositoryRoot: paths.repositoryRoot,
    state: paths.legacyState,
    cacheDirectory: paths.legacyCacheDirectory,
  };
}

function writePrivateJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function syntheticFixture(
  rows: readonly Record<string, unknown>[],
  options: { readonly includeCoverage?: boolean } = {},
): SyntheticFixture {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "whale-cache-diagnostic-"));
  const paths = resolveAcquisitionPaths(repositoryRoot);
  const privateRoot = join(repositoryRoot, "data", "private", "nansen-acquisition");
  mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  chmodSync(privateRoot, 0o700);
  mkdirSync(paths.legacyCacheDirectory, { mode: 0o700 });
  chmodSync(paths.legacyCacheDirectory, 0o700);

  const discoveryFingerprint = "a".repeat(64);
  const coverageFingerprint = "b".repeat(64);
  const discoveryReference = { page: 1, fingerprint: discoveryFingerprint, requestId: "diagnostic-discovery-1" };
  const coverageReference = { page: 1, fingerprint: coverageFingerprint, requestId: "diagnostic-coverage-1" };
  const work = [
    { purpose: "discovery", completedPages: [discoveryReference] },
    ...(options.includeCoverage ? [{ purpose: "coverage", completedPages: [coverageReference] }] : []),
  ];
  writePrivateJson(paths.legacyState, {
    stateVersion: LEGACY_ACQUISITION_STATE_VERSION,
    adapterVersion: LEGACY_ACQUISITION_ADAPTER_VERSION,
    schemaVersion: LEGACY_ACQUISITION_SCHEMA_VERSION,
    work,
    injectedWallet: WALLET,
    injectedKey: "SYNTHETIC-PRIVATE-KEY",
  });

  const cachePaths: string[] = [];
  const writeCache = (
    fingerprint: string,
    requestId: string,
    cacheRows: readonly Record<string, unknown>[],
  ) => {
    const path = join(paths.legacyCacheDirectory, `${fingerprint}.json`);
    writePrivateJson(path, {
      cacheVersion: 3,
      fingerprint,
      retrievalTimeMs: Date.parse("2026-09-24T12:00:00.000Z"),
      requestId,
      reportedCreditCost: 1,
      latencyMs: 100,
      response: {
        data: cacheRows,
        pagination: { page: 1, per_page: 100, is_last_page: false },
        nestedPrivate: { wallet: WALLET, hash: HASH, label: "PRIVATE LABEL" },
      },
      apiKey: "SYNTHETIC-PRIVATE-KEY",
      rawRow: rows[0],
    });
    cachePaths.push(path);
  };
  writeCache(discoveryFingerprint, discoveryReference.requestId, rows);
  if (options.includeCoverage) writeCache(coverageFingerprint, coverageReference.requestId, rows);
  return { paths, statePath: paths.legacyState, cachePaths };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    block_timestamp: "2026-01-02T03:04:05.678Z",
    estimated_value_usd: 100,
    trader_address: WALLET,
    token_address: ACQUISITION_TOKEN_UNIVERSE[0].address,
    transaction_hash: HASH,
    action: "BUY",
    trader_address_label: "PRIVATE LABEL",
    privateNested: { key: "SYNTHETIC-PRIVATE-KEY", exactValue: 98_765.4321 },
    ...overrides,
  };
}

test("cache diagnostic categorizes shapes and emits only allowlisted aggregates", () => {
  const missingValue = row({ block_timestamp: "not-a-date" });
  delete missingValue.estimated_value_usd;
  const fixture = syntheticFixture(
    [
      row(),
      row({ block_timestamp: "2026-01-02T03:04:05Z", estimated_value_usd: "10.5" }),
      row({ block_timestamp: "2026-01-02T03:04:05.12Z", estimated_value_usd: 0 }),
      row({ block_timestamp: "2026-01-02T03:04:05+00:00", estimated_value_usd: -1 }),
      row({ block_timestamp: "January 2, 2026", estimated_value_usd: null }),
      missingValue,
      row({
        block_timestamp: null,
        estimated_value_usd: { private: 98_765.4321 },
        trader_address: "invalid-private-wallet",
        token_address: "invalid-private-token",
        transaction_hash: "invalid-private-hash",
        action: "PRIVATE",
      }),
      row({ estimated_value_usd: null }),
    ],
    { includeCoverage: true },
  );

  const report = diagnoseCanonicalDiscoveryCache(diagnosticPaths(fixture.paths));
  assert.deepEqual(report, {
    diagnosticVersion: 1,
    mode: "diagnose-cache",
    networkRequestSent: false,
    persistentWritesPerformed: false,
    cacheEntries: { total: 2, discoveryAnalyzed: 1, coverageSkipped: 1 },
    rows: 8,
    timestampShapes: {
      isoZExactMilliseconds: 2,
      isoZWholeSeconds: 1,
      isoZOtherFractionalPrecision: 1,
      isoWithOffset: 1,
      parseableOtherFormat: 1,
      invalidString: 1,
      missingOrNonString: 1,
    },
    estimatedValueUsdShapes: {
      positiveFiniteNumber: 1,
      zeroNumber: 1,
      negativeNumber: 1,
      numericStringPositive: 1,
      null: 2,
      missing: 1,
      otherInvalidType: 1,
    },
    rejectionCauses: {
      timestampInvalidOnly: 1,
      valueInvalidOnly: 1,
      timestampAndValueInvalid: 5,
      timestampAndValueValid: 1,
      otherRequiredFieldInvalid: 1,
      rowsThatWouldOtherwisePassDiscoveryValidation: 7,
    },
    requiredFieldValidity: {
      walletAddress: { valid: 7, invalid: 1 },
      tokenAddress: { matchingConfiguredToken: 7, syntacticallyValidOther: 0, invalid: 1 },
      transactionHash: { valid: 7, invalid: 1 },
      action: { valid: 7, invalid: 1 },
    },
  });
  const serialized = JSON.stringify(report);
  for (const sentinel of PRIVATE_SENTINELS) assert.doesNotMatch(serialized, new RegExp(sentinel, "i"));
  for (const forbiddenKey of ["rawRow", "apiKey", "trader_address", "transaction_hash", "block_timestamp"]) {
    assert.doesNotMatch(serialized, new RegExp(forbiddenKey, "i"));
  }

  const rebuilt = buildSanitizedCacheDiagnosticReport({
    ...report,
    wallet: WALLET,
    hash: HASH,
    label: "PRIVATE LABEL",
    exactTimestamp: "2026-01-02T03:04:05.678Z",
    exactValue: 98_765.4321,
    rawRow: row(),
    key: "SYNTHETIC-PRIVATE-KEY",
    timestampShapes: { ...report.timestampShapes, nestedPrivate: { wallet: WALLET } },
  } as never);
  assert.deepEqual(rebuilt, report);
});

test("diagnostic command is keyless, network-free, and non-mutating", async () => {
  const fixture = syntheticFixture([row()]);
  const before = [fixture.statePath, ...fixture.cachePaths].map((path) => ({
    path,
    contents: readFileSync(path, "utf8"),
    size: lstatSync(path).size,
    mtimeMs: lstatSync(path).mtimeMs,
  }));
  let fetchCalls = 0;
  let keyReads = 0;
  const result = await runAcquisitionCommand(["--diagnose-cache"], {
    paths: fixture.paths,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
    readKey: () => {
      keyReads += 1;
      throw new Error("key must not be read");
    },
  });
  assert.equal(result.mode, "diagnose-cache");
  assert.equal(fetchCalls, 0);
  assert.equal(keyReads, 0);
  assert.equal(existsSync(fixture.paths.lock), false);
  assert.equal(existsSync(fixture.paths.ledger), false);
  assert.equal(existsSync(fixture.paths.aggregateReport), false);
  assert.equal(existsSync(fixture.paths.candidateManifest), false);
  for (const snapshot of before) {
    assert.equal(readFileSync(snapshot.path, "utf8"), snapshot.contents);
    assert.equal(lstatSync(snapshot.path).size, snapshot.size);
    assert.equal(lstatSync(snapshot.path).mtimeMs, snapshot.mtimeMs);
  }
});

test("unknown, malformed, and symlinked cache inputs fail closed without private output", () => {
  const unknown = syntheticFixture([row()]);
  writeFileSync(join(unknown.paths.legacyCacheDirectory, "PRIVATE-UNKNOWN.txt"), "PRIVATE UNKNOWN", { mode: 0o600 });
  assert.throws(
    () => diagnoseCanonicalDiscoveryCache(diagnosticPaths(unknown.paths)),
    (error: unknown) => error instanceof Error && /unknown or unsafe entry/.test(error.message) && !/PRIVATE/.test(error.message),
  );

  const malformed = syntheticFixture([row()]);
  writeFileSync(malformed.cachePaths[0], "PRIVATE MALFORMED CACHE", { mode: 0o600 });
  assert.throws(
    () => diagnoseCanonicalDiscoveryCache(diagnosticPaths(malformed.paths)),
    (error: unknown) => error instanceof Error && /malformed JSON/.test(error.message) && !/PRIVATE/.test(error.message),
  );

  const linked = syntheticFixture([row()]);
  const target = join(linked.paths.repositoryRoot, "private-symlink-target.json");
  writeFileSync(target, readFileSync(linked.cachePaths[0]), { mode: 0o600 });
  const cachePath = linked.cachePaths[0];
  unlinkSync(cachePath);
  symlinkSync(target, cachePath);
  assert.throws(
    () => diagnoseCanonicalDiscoveryCache(diagnosticPaths(linked.paths)),
    (error: unknown) => error instanceof Error && /unknown or unsafe entry/.test(error.message) && !/PRIVATE/.test(error.message),
  );
});

test("importing the diagnostic module has no runtime side effects", () => {
  const imported = spawnSync(
    process.execPath,
    [
      "--import=./test/server-only-resolver.mjs",
      "--import=./test/offline-network-guard.mjs",
      "--import=tsx",
      "--input-type=module",
      "-e",
      'await import("./lib/server/nansen-cache-diagnostic.ts")',
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");
});
