/**
 * SYNTHETIC OFFLINE CONTRACT FIXTURES ONLY.
 * These tests never contact Nansen and do not validate provider behavior.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONTRACT_SPIKE_MAX_ATTEMPTS,
  ContractSpikeLedger,
  NANSEN_DEX_TRADES_ENDPOINT,
  PROBE_FROM_ISO,
  PROBE_PAGE,
  PROBE_PER_PAGE,
  PROBE_TO_ISO,
  acquireContractSpikeLock,
  assertAllowedEndpoint,
  buildProbeRequest,
  classifyHttpOutcome,
  ensurePrivateDirectory,
  readCredentialTextFile,
  requestFingerprint,
  summarizeDexTradesResponse,
  writePrivateTextFileExclusive,
} from "../lib/server/nansen-contract";
import { resolveSpikePaths, runSpikeCommand } from "../lib/server/nansen-spike-runner";

const TOKEN = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const TRADER = `0x${"ab".repeat(20)}`;
const HASH = `0x${"cd".repeat(32)}`;

function syntheticResponse() {
  return {
    data: [
      {
        block_timestamp: "2026-08-28T00:05:00.000Z",
        transaction_hash: HASH,
        trader_address: TRADER,
        trader_address_label: "SYNTHETIC LABEL",
        action: "BUY",
        token_address: TOKEN,
        token_name: "Synthetic Wrapped Ether",
        token_amount: 1,
        traded_token_address: `0x${"ef".repeat(20)}`,
        traded_token_name: "Synthetic Countertoken",
        traded_token_amount: 3_500,
        estimated_swap_price_usd: 3_500,
        estimated_value_usd: 3_500,
      },
      {
        block_timestamp: "2026-08-28T00:10:00.000Z",
        transaction_hash: `0x${"12".repeat(32)}`,
        trader_address: `0x${"34".repeat(20)}`,
        trader_address_label: null,
        action: "SELL",
        token_address: TOKEN.toUpperCase().replace("0X", "0x"),
        token_name: "Synthetic Wrapped Ether",
        token_amount: 2,
        traded_token_address: `0x${"56".repeat(20)}`,
        traded_token_name: "Synthetic Countertoken",
        traded_token_amount: 7_000,
        estimated_swap_price_usd: 3_500,
        estimated_value_usd: null,
      },
    ],
    pagination: { page: 1, per_page: 3, is_last_page: true },
  };
}

test("constructs only the fixed bounded Ethereum request", () => {
  assert.deepEqual(buildProbeRequest(), {
    chain: "ethereum",
    token_address: TOKEN,
    only_smart_money: false,
    date: { from: PROBE_FROM_ISO, to: PROBE_TO_ISO },
    pagination: { page: PROBE_PAGE, per_page: PROBE_PER_PAGE },
    order_by: [{ field: "block_timestamp", direction: "ASC" }],
  });
  assert.match(requestFingerprint(buildProbeRequest()), /^[0-9a-f]{64}$/);
});

test("hard allowlist rejects every other endpoint", () => {
  assert.doesNotThrow(() => assertAllowedEndpoint(NANSEN_DEX_TRADES_ENDPOINT));
  assert.throws(() => assertAllowedEndpoint("https://api.nansen.ai/api/v1/agent/fast"), /allowlist/);
  assert.throws(() => assertAllowedEndpoint(`${NANSEN_DEX_TRADES_ENDPOINT}?extra=true`), /allowlist/);
});

test("command defaults to an offline dry-run and does not create a ledger", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-dry-run-"));
  const paths = resolveSpikePaths(directory);
  let fetchCalls = 0;
  const output = await runSpikeCommand([], {
    paths,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("offline test fetch must not run");
    },
  });

  assert.equal(output.mode, "dry-run");
  assert.equal(output.networkRequestSent, false);
  assert.equal(fetchCalls, 0);
  assert.equal(existsSync(paths.ledger), false);
  assert.equal(existsSync(paths.lock), false);
  assert.equal(existsSync(paths.rawDirectory), false);
});

test("durable ledger reserves before settlement, enforces the attempt cap, and stays sanitized", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-ledger-"));
  const ledgerPath = join(directory, "ledger.jsonl");
  let id = 0;
  const ledger = new ContractSpikeLedger(
    ledgerPath,
    () => new Date("2026-09-23T12:00:00.000Z"),
    () => `attempt-${++id}`,
  );
  const fingerprint = requestFingerprint(buildProbeRequest());

  for (let index = 0; index < CONTRACT_SPIKE_MAX_ATTEMPTS; index += 1) {
    const reservation = ledger.reserve(fingerprint, { page: 1, perPage: 3 });
    assert.equal(ledger.summarize().attempts, index + 1);
    ledger.settle(reservation, {
      httpStatus: 200,
      latencyMs: 25,
      reportedCreditCost: 1,
      reportedCreditsUsed: 1,
      outcome: "success",
    });
  }

  assert.throws(() => ledger.reserve(fingerprint, { page: 1, perPage: 3 }), /attempt cap/);
  assert.deepEqual(ledger.summarize(), {
    attempts: 3,
    settled: 3,
    successful: 3,
    reportedCreditsUsed: 3,
    unknownChargeAttempts: 0,
    retainedCredits: 3,
  });

  const ledgerText = readFileSync(ledgerPath, "utf8");
  assert.doesNotMatch(ledgerText, /apikey|authorization|NANSEN_API_KEY/i);
  assert.doesNotMatch(ledgerText, new RegExp(TRADER, "i"));
  assert.doesNotMatch(ledgerText, new RegExp(TOKEN, "i"));
  assert.doesNotMatch(ledgerText, /token_address|trader_address|only_smart_money/);
});

test("unknown charges retain the reservation conservatively", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-ledger-unknown-"));
  const ledger = new ContractSpikeLedger(join(directory, "ledger.jsonl"), undefined, () => "unknown-charge");
  const reservation = ledger.reserve(requestFingerprint(buildProbeRequest()), { page: 1, perPage: 3 });
  ledger.settle(reservation, {
    httpStatus: 500,
    latencyMs: 10,
    reportedCreditCost: null,
    reportedCreditsUsed: null,
    outcome: "transient-error",
  });
  assert.equal(ledger.summarize().unknownChargeAttempts, 1);
  assert.equal(ledger.summarize().retainedCredits, 1);
});

test("malformed or contradictory ledger history fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-ledger-malformed-"));
  const ledgerPath = join(directory, "ledger.jsonl");
  writeFileSync(ledgerPath, '{"ledgerVersion":1,"phase":"reserved","attemptId":"truncated"}\n', { mode: 0o600 });
  assert.throws(() => new ContractSpikeLedger(ledgerPath).summarize(), /malformed at line 1/);

  const cleanPath = join(directory, "history.jsonl");
  const fingerprint = requestFingerprint(buildProbeRequest());
  const ledger = new ContractSpikeLedger(cleanPath, undefined, () => "duplicate-id");
  ledger.reserve(fingerprint, { page: 1, perPage: 3 });
  assert.throws(() => ledger.reserve(fingerprint, { page: 1, perPage: 3 }), /already exists/);
});

test("retained-credit cap blocks another reservation before the attempt cap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-retained-cap-"));
  const ledger = new ContractSpikeLedger(join(directory, "ledger.jsonl"), undefined, () => "retained-cap");
  const reservation = ledger.reserve(requestFingerprint(buildProbeRequest()), { page: 1, perPage: 3 });
  ledger.settle(reservation, {
    httpStatus: 200,
    latencyMs: 1,
    reportedCreditCost: 3,
    reportedCreditsUsed: 3,
    outcome: "success",
  });
  assert.throws(() => ledger.reserve(requestFingerprint(buildProbeRequest()), { page: 1, perPage: 3 }), /retained-credit cap/);
});

test("double settlement and out-of-order ledger history fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-ledger-order-"));
  const ledgerPath = join(directory, "ledger.jsonl");
  const ledger = new ContractSpikeLedger(ledgerPath, undefined, () => "ordered-attempt");
  const reservation = ledger.reserve(requestFingerprint(buildProbeRequest()), { page: 1, perPage: 3 });
  ledger.settle(reservation, {
    httpStatus: 200,
    latencyMs: 1,
    reportedCreditCost: 1,
    reportedCreditsUsed: 1,
    outcome: "success",
  });
  assert.throws(
    () =>
      ledger.settle(reservation, {
        httpStatus: 200,
        latencyMs: 1,
        reportedCreditCost: 1,
        reportedCreditsUsed: 1,
        outcome: "success",
      }),
    /already settled/,
  );

  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
  writeFileSync(ledgerPath, `${lines.toReversed().join("\n")}\n`, { mode: 0o600 });
  assert.throws(() => ledger.summarize(), /invalid attempt history at line 1/);
});

test("ledger and parent symlinks fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-symlink-"));
  const target = join(directory, "target.jsonl");
  writeFileSync(target, "", { mode: 0o600 });
  const ledgerPath = join(directory, "ledger.jsonl");
  symlinkSync(target, ledgerPath);
  assert.throws(() => new ContractSpikeLedger(ledgerPath).summarize(), /unsafe/);

  const realParent = join(directory, "real-parent");
  mkdirSync(realParent, { mode: 0o700 });
  const linkedParent = join(directory, "linked-parent");
  symlinkSync(realParent, linkedParent, "dir");
  const linkedLedger = new ContractSpikeLedger(join(linkedParent, "ledger.jsonl"));
  assert.throws(
    () => linkedLedger.reserve(requestFingerprint(buildProbeRequest()), { page: 1, perPage: 3 }),
    /unsafe parent/,
  );
});

test("credential reads reject unsafe parents, file types, symlinks, and broad permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-credential-safety-"));
  const missing = join(directory, "missing.env");
  assert.throws(() => readCredentialTextFile(missing), /credential file is missing/);

  const broad = join(directory, "broad.env");
  writeFileSync(broad, "dummy\n", { mode: 0o644 });
  assert.throws(() => readCredentialTextFile(broad), /unsafe permissions/);
  chmodSync(broad, 0o600);
  assert.equal(readCredentialTextFile(broad), "dummy\n");

  const directoryAsFile = join(directory, "directory.env");
  mkdirSync(directoryAsFile, { mode: 0o700 });
  assert.throws(() => readCredentialTextFile(directoryAsFile), /unsafe file type/);

  const linkedFile = join(directory, "linked.env");
  symlinkSync(broad, linkedFile);
  assert.throws(() => readCredentialTextFile(linkedFile), /unsafe file type/);

  const realParent = join(directory, "real-parent");
  mkdirSync(realParent, { mode: 0o700 });
  const linkedParent = join(directory, "linked-parent");
  symlinkSync(realParent, linkedParent, "dir");
  assert.throws(() => readCredentialTextFile(join(linkedParent, "key.env")), /unsafe parent/);
});

test("private directory creation tolerates a safe EEXIST race and preserves restrictive modes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-private-mode-"));
  const racedDirectory = join(directory, "created-concurrently");
  let simulatedRace = false;
  ensurePrivateDirectory(racedDirectory, (path, options) => {
    mkdirSync(path, options);
    simulatedRace = true;
    throw Object.assign(new Error("synthetic EEXIST"), { code: "EEXIST" });
  });
  assert.equal(simulatedRace, true);
  assert.equal(statSync(racedDirectory).mode & 0o077, 0);

  const privateFile = join(racedDirectory, "private.json");
  writePrivateTextFileExclusive(privateFile, "synthetic\n");
  assert.equal(statSync(privateFile).mode & 0o077, 0);
  assert.equal(readFileSync(privateFile, "utf8"), "synthetic\n");
});

test("lock release removes only the same inode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whale-gossip-lock-inode-"));
  const lockPath = join(directory, "spike.lock");
  const originalPath = join(directory, "original.lock");
  const lock = acquireContractSpikeLock(lockPath);
  renameSync(lockPath, originalPath);
  writeFileSync(lockPath, "replacement\n", { mode: 0o600 });
  assert.throws(() => lock.release(), /lock changed while held/);
  assert.equal(readFileSync(lockPath, "utf8"), "replacement\n");
  unlinkSync(lockPath);
  unlinkSync(originalPath);
});

test("synthetic response parsing reports shape without leaking response values", () => {
  const summary = summarizeDexTradesResponse(syntheticResponse());
  assert.equal(summary.validEnvelope, true);
  assert.equal(summary.recordCount, 2);
  assert.deepEqual(summary.pagination, { valid: true, page: 1, perPage: 3, isLastPage: true });
  assert.deepEqual(summary.observations.actions, { buy: 1, sell: 1, other: 0 });
  assert.deepEqual(summary.observations.timestamps, { strings: 2, parseableIso: 2, ascending: true });
  assert.equal(summary.observations.transactionHashes.validEthereumSyntax, 2);
  assert.equal(summary.observations.traderAddresses.validEthereumSyntax, 2);
  assert.equal(summary.observations.tokenAddresses.matchingProbeToken, 2);
  assert.deepEqual(summary.observations.estimatedUsdValues, { numbers: 1, nulls: 1, other: 0, negative: 0 });
  assert.deepEqual(summary.issues, []);

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, new RegExp(TRADER, "i"));
  assert.doesNotMatch(serialized, new RegExp(HASH, "i"));
  assert.doesNotMatch(serialized, /SYNTHETIC LABEL|Synthetic Wrapped Ether|3500/);
});

test("malformed synthetic response is summarized without throwing", () => {
  const summary = summarizeDexTradesResponse({ data: [null], pagination: { page: "one" } });
  assert.equal(summary.validEnvelope, false);
  assert.deepEqual(summary.issues, ["data-contains-non-object-records", "pagination-shape-is-invalid"]);
});

test("signed-zero observed USD is rejected by the contract summary", () => {
  const value = syntheticResponse();
  value.data[0].estimated_value_usd = -0;
  const summary = summarizeDexTradesResponse(value);
  assert.equal(summary.validEnvelope, false);
  assert.equal(summary.observations.estimatedUsdValues.numbers, 0);
  assert.equal(summary.observations.estimatedUsdValues.negative, 1);
  assert.deepEqual(summary.issues, ["invalid-estimated-value-usd:signed-zero"]);
});

test("HTTP outcome classification stops on auth and credit errors and retries only transient statuses", () => {
  assert.equal(classifyHttpOutcome(200, true), "success");
  assert.equal(classifyHttpOutcome(200, false), "invalid-response");
  assert.equal(classifyHttpOutcome(401, false), "authentication-error");
  assert.equal(classifyHttpOutcome(402, false), "authorization-or-credit-error");
  assert.equal(classifyHttpOutcome(403, false), "authorization-or-credit-error");
  assert.equal(classifyHttpOutcome(429, false), "rate-limited");
  for (const status of [408, 500, 502, 503, 504]) assert.equal(classifyHttpOutcome(status, false), "transient-error");
  for (const status of [300, 301, 302, 307, 308, 399]) assert.equal(classifyHttpOutcome(status, false), "request-error");
  assert.equal(classifyHttpOutcome(422, false), "request-error");
});
