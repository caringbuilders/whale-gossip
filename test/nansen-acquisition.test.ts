import assert from "node:assert/strict";
import test from "node:test";

import {
  ACQUISITION_PER_PAGE,
  ACQUISITION_TOKEN_UNIVERSE,
  NANSEN_DEX_TRADES_ENDPOINT,
  PROVIDER_BOUNDARY_OVERLAP_MS,
  acquisitionRequestFingerprint,
  assertAcquisitionEndpoint,
  buildAcquisitionRequest,
  buildCoveragePlan,
  buildDiscoveryPlan,
  buildSanitizedAcquisitionReport,
  compileCoveredCandidate,
  legacyAcquisitionRequestFingerprintV3,
  normalizeCompletePages,
  normalizeProviderTimestamp,
  parseProviderPage,
  summarizeDiscoveryPage,
  validateCoveragePage,
  type DiscoveredCandidate,
  type PlannedRequest,
  type ProviderPage,
} from "../lib/server/nansen-acquisition";
import { ANSWER_WINDOW_MS, LOOKBACK_MS } from "../lib/rules";

const TOKEN = ACQUISITION_TOKEN_UNIVERSE[0];
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const DAY = 24 * 60 * 60 * 1_000;
const CUTOFF = Date.parse("2026-09-01T00:00:00.000Z");
const RETRIEVED = CUTOFF + ANSWER_WINDOW_MS + DAY;

function hash(index: number): string {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    block_timestamp: new Date(CUTOFF - DAY).toISOString(),
    transaction_hash: hash(1),
    trader_address: WALLET,
    trader_address_label: "PRIVATE SYNTHETIC LABEL",
    action: "BUY",
    token_address: TOKEN.address,
    token_name: "Synthetic WETH",
    estimated_value_usd: 25_000,
    ...overrides,
  };
}

function coveragePlan(page = 1): PlannedRequest {
  return buildCoveragePlan(
    {
      candidateId: "candidate-v1-test",
      token: TOKEN,
      wallet: WALLET,
      proposedCutoffMs: CUTOFF,
      anchorEventId: "derived-v1-anchor",
    },
    page,
  );
}

function parsedPage(
  page: number,
  rows: readonly Record<string, unknown>[],
  isLastPage: boolean,
  id = `request-${page}`,
): ProviderPage {
  const plan = coveragePlan(page);
  const parsed = parseProviderPage(
    { data: rows, pagination: { page, per_page: ACQUISITION_PER_PAGE, is_last_page: isLastPage } },
    plan,
    id,
    RETRIEVED,
  );
  assert.equal(parsed.status, "valid");
  return parsed.page;
}

test("endpoint and fixed WETH-only universe enforce the reviewed boundary", () => {
  assert.equal(ACQUISITION_TOKEN_UNIVERSE.length, 1);
  assert.equal(TOKEN.symbol, "WETH");
  assert.match(TOKEN.verification, /contract spike/);
  assert.doesNotThrow(() => assertAcquisitionEndpoint(NANSEN_DEX_TRADES_ENDPOINT));
  for (const endpoint of [
    "http://api.nansen.ai/api/v1/tgm/dex-trades",
    "https://api.nansen.ai/api/v1/tgm/dex-trades?x=1",
    "https://example.com/api/v1/tgm/dex-trades",
    "https://api.nansen.ai/api/v1/profiler/dex-trades",
  ]) {
    assert.throws(() => assertAcquisitionEndpoint(endpoint), /allowlist/);
  }
});

test("discovery windows are deterministic, non-overlapping, normalized Ethereum requests", () => {
  const retrieval = Date.parse("2026-09-24T15:30:00.000Z");
  const first = buildDiscoveryPlan(retrieval);
  assert.deepEqual(first, buildDiscoveryPlan(retrieval));
  assert.equal(first.length, 3);
  for (const [index, plan] of first.entries()) {
    assert.equal(plan.request.chain, "ethereum");
    assert.equal(plan.request.only_smart_money, false);
    assert.equal(plan.request.token_address, TOKEN.address);
    assert.equal(plan.request.pagination.page, 1);
    assert.equal(plan.request.pagination.per_page, 100);
    assert.equal(Date.parse(plan.request.date.from), plan.localFromMs - PROVIDER_BOUNDARY_OVERLAP_MS);
    assert.equal(Date.parse(plan.request.date.to), plan.localToMsExclusive);
    assert.equal(plan.localToMsExclusive - plan.localFromMs, 6 * 60 * 60 * 1_000);
    assert.equal(plan.candidateId, null);
    assert.equal(plan.request.filters, undefined);
    if (index > 0) assert.ok(first[index - 1].localToMsExclusive < plan.localFromMs);
  }
});

test("requests reject arbitrary tokens, invalid intervals, and invalid pages", () => {
  assert.throws(
    () => buildAcquisitionRequest({ ...TOKEN, address: OTHER_WALLET }, 1, 2),
    /reviewed acquisition universe/,
  );
  assert.throws(() => buildAcquisitionRequest(TOKEN, 2, 2), /interval/);
  assert.throws(() => buildAcquisitionRequest(TOKEN, 1, 2, 0), /page/);
  assert.throws(() => buildAcquisitionRequest(TOKEN, 1, 2, 1, "0x1234"), /wallet filter/);
  assert.deepEqual(coveragePlan().request.filters, { trader_address: WALLET });
});

test("provider envelopes require exact page and per-page metadata", () => {
  const plan = coveragePlan();
  for (const value of [
    null,
    { data: [], pagination: { page: 2, per_page: 100, is_last_page: true } },
    { data: [], pagination: { page: 1, per_page: 99, is_last_page: true } },
    { data: [], pagination: { page: 1, per_page: 100, is_last_page: "yes" } },
    { data: [null], pagination: { page: 1, per_page: 100, is_last_page: true } },
    { data: Array.from({ length: 101 }, () => ({})), pagination: { page: 1, per_page: 100, is_last_page: true } },
  ]) {
    assert.equal(parseProviderPage(value, plan, "request-1", RETRIEVED).status, "invalid");
  }
});

test("pagination rejects missing, duplicate, out-of-order, premature, and nonterminal evidence", () => {
  const base = coveragePlan();
  const page1 = parsedPage(1, [], false);
  const page2 = parsedPage(2, [], true);
  assert.deepEqual(normalizeCompletePages([], base), { status: "rejected", reason: "missing-pages" });
  assert.deepEqual(normalizeCompletePages([page1, page1], base), { status: "rejected", reason: "duplicate-page" });
  assert.deepEqual(normalizeCompletePages([page2, page1], base), {
    status: "rejected",
    reason: "missing-or-out-of-order-page",
  });
  assert.deepEqual(normalizeCompletePages([{ ...page1, isLastPage: true }, page2], base), {
    status: "rejected",
    reason: "premature-terminal-page",
  });
  assert.deepEqual(normalizeCompletePages([page1], base), { status: "rejected", reason: "nonterminal-pagination" });
  assert.equal(normalizeCompletePages([page1, page2], base).status, "complete");
  assert.deepEqual(normalizeCompletePages([page1, { ...page2, requestFingerprint: page1.requestFingerprint }], base), {
    status: "rejected",
    reason: "request-identity-mismatch",
  });
  assert.deepEqual(normalizeCompletePages([page1, { ...page2, requestId: page1.requestId }], base), {
    status: "rejected",
    reason: "duplicate-request-id",
  });
});

test("event order is reconstructed locally rather than trusted across provider rows", () => {
  const later = row({ block_timestamp: new Date(CUTOFF - DAY).toISOString(), transaction_hash: hash(2) });
  const earlier = row({ block_timestamp: new Date(CUTOFF - 2 * DAY).toISOString(), transaction_hash: hash(1) });
  const normalized = normalizeCompletePages([parsedPage(1, [later, earlier], true)], coveragePlan());
  assert.equal(normalized.status, "complete");
  assert.deepEqual(normalized.events.map((event) => event.transactionHash), [hash(1), hash(2)]);
});

test("inclusive provider overlap is reduced to the required local half-open interval", () => {
  const plan = coveragePlan();
  const values = [
    row({ block_timestamp: new Date(plan.localFromMs - 1).toISOString(), transaction_hash: hash(1) }),
    row({ block_timestamp: new Date(plan.localFromMs).toISOString(), transaction_hash: hash(2) }),
    row({ block_timestamp: new Date(plan.localToMsExclusive - 1).toISOString(), transaction_hash: hash(3) }),
    row({ block_timestamp: new Date(plan.localToMsExclusive).toISOString(), transaction_hash: hash(4) }),
  ];
  const normalized = normalizeCompletePages([parsedPage(1, values, true)], plan);
  assert.equal(normalized.status, "complete");
  assert.deepEqual(
    normalized.events.map((event) => event.occurredAtMs),
    [plan.localFromMs, plan.localToMsExclusive - 1],
  );
});

test("timestamp normalization accepts only canonical whole seconds or exact milliseconds", () => {
  assert.deepEqual(normalizeProviderTimestamp("2026-09-01T00:00:00Z"), {
    occurredAtMs: Date.parse("2026-09-01T00:00:00.000Z"),
    canonicalIso: "2026-09-01T00:00:00.000Z",
    sourcePrecision: "whole-second",
  });
  assert.deepEqual(normalizeProviderTimestamp("2026-09-01T00:00:00.123Z"), {
    occurredAtMs: Date.parse("2026-09-01T00:00:00.123Z"),
    canonicalIso: "2026-09-01T00:00:00.123Z",
    sourcePrecision: "exact-millisecond",
  });
  for (const invalid of [
    undefined,
    null,
    0,
    "2026-09-01",
    "2026-09-01T00:00:00.1Z",
    "2026-09-01T00:00:00.12Z",
    "2026-09-01T00:00:00.1234Z",
    "2026-09-01T00:00:00+00:00",
    "2026-09-01T00:00:00.000+00:00",
    "2026-09-01T00:00:00.000Z ",
    " 2026-09-01T00:00:00Z",
    "2026-09-01 00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00.000Z",
    "2026-09-01T24:00:00Z",
  ]) {
    assert.equal(normalizeProviderTimestamp(invalid), null);
  }
});

test("normalization requires canonical timestamps, addresses, hashes, actions, and valid USD", () => {
  const invalidRows = [
    row({ block_timestamp: "2026-09-01T00:00:00.12Z" }),
    row({ trader_address: "0x1234" }),
    row({ transaction_hash: "0x1234" }),
    row({ token_address: OTHER_WALLET }),
    row({ action: "SWAP" }),
    row({ estimated_value_usd: null }),
    row({ estimated_value_usd: -1 }),
    row({ estimated_value_usd: Number.POSITIVE_INFINITY }),
    row({ estimated_value_usd: -0 }),
    row({ estimated_value_usd: "25000" }),
  ];
  for (const invalid of invalidRows) {
    assert.equal(normalizeCompletePages([parsedPage(1, [invalid], true)], coveragePlan()).status, "rejected");
  }
});

test("whole-second timestamps preserve half-open coverage boundaries", () => {
  const plan = coveragePlan();
  const lower = new Date(plan.localFromMs).toISOString().replace(".000Z", "Z");
  const upper = new Date(plan.localToMsExclusive).toISOString().replace(".000Z", "Z");
  const normalized = normalizeCompletePages(
    [
      parsedPage(
        1,
        [
          row({ block_timestamp: lower, transaction_hash: hash(31) }),
          row({ block_timestamp: upper, transaction_hash: hash(32) }),
        ],
        true,
      ),
    ],
    plan,
  );
  assert.equal(normalized.status, "complete");
  assert.deepEqual(normalized.events.map((event) => event.occurredAtMs), [plan.localFromMs]);
});

test("addresses and hashes normalize while derived IDs remain deterministic", () => {
  const mixed = row({
    trader_address: WALLET.toUpperCase().replace("0X", "0x"),
    token_address: TOKEN.address.toUpperCase().replace("0X", "0x"),
    transaction_hash: hash(10).toUpperCase().replace("0X", "0x"),
  });
  const first = normalizeCompletePages([parsedPage(1, [mixed], true)], coveragePlan());
  const second = normalizeCompletePages([parsedPage(1, [mixed], true)], coveragePlan());
  assert.equal(first.status, "complete");
  assert.equal(second.status, "complete");
  assert.equal(first.events[0].wallet, WALLET);
  assert.equal(first.events[0].transactionHash, hash(10));
  assert.equal(first.events[0].eventId, second.events[0].eventId);
  assert.match(first.events[0].eventId, /^derived-v1:[0-9a-f]{64}$/);
});

test("whole-second canonicalization and input order produce deterministic events", () => {
  const whole = row({ block_timestamp: "2026-08-31T00:00:00Z", transaction_hash: hash(40) });
  const milliseconds = row({ block_timestamp: "2026-08-30T00:00:00.000Z", transaction_hash: hash(41) });
  const first = normalizeCompletePages([parsedPage(1, [whole, milliseconds], true)], coveragePlan());
  const second = normalizeCompletePages([parsedPage(1, [milliseconds, whole], true)], coveragePlan());
  assert.equal(first.status, "complete");
  assert.equal(second.status, "complete");
  assert.deepEqual(first.events, second.events);

  const sameInstantWhole = normalizeCompletePages([parsedPage(1, [whole], true)], coveragePlan());
  const sameInstantMilliseconds = normalizeCompletePages(
    [parsedPage(1, [{ ...whole, block_timestamp: "2026-08-31T00:00:00.000Z" }], true)],
    coveragePlan(),
  );
  assert.equal(sameInstantWhole.status, "complete");
  assert.equal(sameInstantMilliseconds.status, "complete");
  assert.equal(sameInstantWhole.events[0].eventId, sameInstantMilliseconds.events[0].eventId);
});

test("exact and cross-page candidate duplicates reject instead of collapsing", () => {
  const exact = row();
  const duplicate = normalizeCompletePages([parsedPage(1, [exact, { ...exact }], true)], coveragePlan());
  assert.deepEqual(duplicate, { status: "rejected", reason: "duplicate-or-unstable-pagination-row" });

  const crossPage = normalizeCompletePages(
    [parsedPage(1, [exact], false), parsedPage(2, [{ ...exact }], true)],
    coveragePlan(),
  );
  assert.deepEqual(crossPage, { status: "rejected", reason: "duplicate-or-unstable-pagination-row" });

  const conflict = normalizeCompletePages(
    [parsedPage(1, [exact, { ...exact, estimated_value_usd: 25_001 }], true)],
    coveragePlan(),
  );
  assert.deepEqual(conflict, { status: "rejected", reason: "conflicting-row" });
});

test("discovery creates deterministic candidates only from qualifying observed trades", () => {
  const retrieval = Date.parse("2026-09-24T12:00:00.000Z");
  const plan = buildDiscoveryPlan(retrieval)[2];
  const eventTime = plan.localFromMs + 60 * 60 * 1_000;
  const pagePlan = { ...plan, request: buildAcquisitionRequest(TOKEN, plan.localFromMs, plan.localToMsExclusive, 1) };
  const parsed = parseProviderPage(
    {
      data: [
        row({ block_timestamp: new Date(eventTime).toISOString(), estimated_value_usd: 25_000 }),
        row({
          block_timestamp: new Date(eventTime + 1).toISOString(),
          transaction_hash: hash(2),
          trader_address: OTHER_WALLET,
          estimated_value_usd: 24_999,
        }),
      ],
      pagination: { page: 1, per_page: 100, is_last_page: true },
    },
    pagePlan,
    "discovery-1",
    retrieval,
  );
  assert.equal(parsed.status, "valid");
  const discovery = summarizeDiscoveryPage(parsed.page, plan, 1, 800);
  const candidates = discovery.candidates;
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].wallet, WALLET);
  assert.equal(candidates[0].proposedCutoffMs, Math.floor(eventTime / DAY) * DAY + DAY);
  assert.deepEqual(discovery.evidence, {
    rowCount: 2,
    validRowCount: 2,
    invalidRowCount: 0,
    validationRejections: {},
    qualifyingRows: 1,
    distinctCandidateFingerprints: 1,
    timeSpanBand: "under-1-hour",
    pagination: { page: 1, perPage: 100, isLastPage: true },
    reportedCreditCost: 1,
    latencyBand: "250-ms-to-1-second",
  });
});

test("discovery evidence counts invalid and duplicate rows without exposing identities", () => {
  const retrieval = Date.parse("2026-09-24T12:00:00.000Z");
  const plan = buildDiscoveryPlan(retrieval)[0];
  const valid = row({ block_timestamp: new Date(plan.localFromMs + 1_000).toISOString() });
  const parsed = parseProviderPage(
    {
      data: [valid, { ...valid }, row({ trader_address: "invalid" })],
      pagination: { page: 1, per_page: 100, is_last_page: false },
    },
    plan,
    "sample-1",
    retrieval,
  );
  assert.equal(parsed.status, "valid");
  const result = summarizeDiscoveryPage(parsed.page, plan, 1, 100);
  assert.equal(result.evidence.rowCount, 3);
  assert.equal(result.evidence.validRowCount, 1);
  assert.equal(result.evidence.invalidRowCount, 2);
  assert.deepEqual(result.evidence.validationRejections, { "duplicate-row": 1, "wallet-address-invalid": 1 });
  const serialized = JSON.stringify(result.evidence);
  assert.doesNotMatch(serialized, /0x|PRIVATE|25000|2026-/i);
});

test("coverage pages enforce wallet and token matches with canonical address comparison", () => {
  const plan = coveragePlan();
  const mixedCase = row({
    trader_address: WALLET.toUpperCase().replace("0X", "0x"),
    token_address: TOKEN.address.toUpperCase().replace("0X", "0x"),
  });
  const accepted = validateCoveragePage(parsedPage(1, [mixedCase], false), plan, 1, 300);
  assert.equal(accepted.status, "accepted");
  assert.deepEqual(accepted.evidence, {
    rowCount: 1,
    walletMatchCount: 1,
    tokenMatchCount: 1,
    structurallyValidRowCount: 1,
    structurallyInvalidRowCount: 0,
    rejectionReason: null,
    timeSpanBand: "under-1-hour",
    pagination: { page: 1, perPage: 100, isLastPage: false },
    reportedCreditCost: 1,
    latencyBand: "250-ms-to-1-second",
  });

  const wrongWallet = validateCoveragePage(
    parsedPage(1, [row({ trader_address: OTHER_WALLET.toUpperCase().replace("0X", "0x") })], false),
    plan,
    1,
    100,
  );
  assert.equal(wrongWallet.status, "rejected");
  assert.equal(wrongWallet.evidence.walletMatchCount, 0);
  assert.equal(wrongWallet.evidence.rejectionReason, "wallet-filter-not-applied");

  const wrongToken = validateCoveragePage(
    parsedPage(1, [row({ token_address: OTHER_WALLET })], false),
    plan,
    1,
    100,
  );
  assert.equal(wrongToken.status, "rejected");
  assert.equal(wrongToken.evidence.walletMatchCount, 1);
  assert.equal(wrongToken.evidence.tokenMatchCount, 0);
  assert.equal(wrongToken.evidence.rejectionReason, "wallet-filter-not-applied");
  assert.equal(
    compileCoveredCandidate(candidate(), { status: "rejected", reason: wrongToken.reason }).compilerResult,
    null,
  );
});

test("coverage pages reject invalid rows immediately while empty pages remain provisional evidence", () => {
  const plan = coveragePlan();
  const invalid = validateCoveragePage(
    parsedPage(1, [row({ transaction_hash: "invalid" })], false),
    plan,
    1,
    100,
  );
  assert.equal(invalid.status, "rejected");
  assert.equal(invalid.evidence.structurallyInvalidRowCount, 1);
  assert.equal(invalid.evidence.rejectionReason, "invalid-coverage-row");

  for (const terminal of [false, true]) {
    const empty = validateCoveragePage(parsedPage(1, [], terminal), plan, 1, 100);
    assert.equal(empty.status, "accepted");
    assert.equal(empty.evidence.rowCount, 0);
    assert.equal(empty.evidence.rejectionReason, null);
    assert.equal(empty.evidence.pagination.isLastPage, terminal);
  }
});

function completeCandidateRows(answerRows: readonly Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [
    row({ block_timestamp: new Date(CUTOFF - 6 * DAY).toISOString(), transaction_hash: hash(1), estimated_value_usd: 25_000 }),
    row({ block_timestamp: new Date(CUTOFF - 5 * DAY).toISOString(), transaction_hash: hash(2), estimated_value_usd: 500 }),
    row({ block_timestamp: new Date(CUTOFF - 4 * DAY).toISOString(), transaction_hash: hash(3), estimated_value_usd: 600 }),
    row({ block_timestamp: new Date(CUTOFF - 3 * DAY).toISOString(), transaction_hash: hash(4), estimated_value_usd: 700 }),
    row({ block_timestamp: new Date(CUTOFF - 2 * DAY).toISOString(), transaction_hash: hash(5), estimated_value_usd: 800 }),
    ...answerRows,
  ];
}

function candidate(): DiscoveredCandidate {
  return {
    candidateId: "candidate-v1-compile",
    token: TOKEN,
    wallet: WALLET,
    proposedCutoffMs: CUTOFF,
    anchorEventId: "derived-v1-anchor",
  };
}

test("complete evidence compiles only through rules version 4", () => {
  const plan = coveragePlan();
  const rows = completeCandidateRows([
    row({ block_timestamp: new Date(CUTOFF).toISOString(), transaction_hash: hash(20), estimated_value_usd: 2_500 }),
  ]);
  const normalized = normalizeCompletePages([parsedPage(1, rows, true)], plan);
  const result = compileCoveredCandidate(candidate(), normalized);
  assert.equal(result.compilerResult?.status, "scorable");
  assert.equal(result.compilerResult?.rulesVersion, "4");
  assert.equal(result.compilerResult?.status === "scorable" && result.compilerResult.answer.action, "buy");
  assert.equal(result.coverage?.lookback.fromMs, CUTOFF - LOOKBACK_MS);
  assert.equal(result.coverage?.answerWindow.toMsExclusive, CUTOFF + ANSWER_WINDOW_MS);
});

test("equal whole-second material trades remain ambiguous independent of provider order", () => {
  const timestamp = new Date(CUTOFF).toISOString().replace(".000Z", "Z");
  const buy = row({ block_timestamp: timestamp, transaction_hash: hash(21), estimated_value_usd: 2_500, action: "BUY" });
  const sell = row({ block_timestamp: timestamp, transaction_hash: hash(22), estimated_value_usd: 2_500, action: "SELL" });
  for (const answerRows of [[buy, sell], [sell, buy]]) {
    const normalized = normalizeCompletePages(
      [parsedPage(1, completeCandidateRows(answerRows), true)],
      coveragePlan(),
    );
    const result = compileCoveredCandidate(candidate(), normalized);
    assert.equal(result.compilerResult?.status, "unscorable");
    assert.equal(
      result.compilerResult?.status === "unscorable" && result.compilerResult.reason.code,
      "tied-first-events",
    );
  }
});

test("coverage evidence comes from actual requested bounds and rules reject one-millisecond shrinkage", () => {
  const base = normalizeCompletePages([parsedPage(1, completeCandidateRows(), true)], coveragePlan());
  assert.equal(base.status, "complete");
  const shortLookback = compileCoveredCandidate(candidate(), {
    ...base,
    requestedFromMs: CUTOFF - LOOKBACK_MS + 1,
  });
  assert.equal(shortLookback.compilerResult?.status, "unscorable");
  assert.equal(
    shortLookback.compilerResult?.status === "unscorable" && shortLookback.compilerResult.reason.code,
    "coverage-incomplete",
  );
  const shortAnswer = compileCoveredCandidate(candidate(), {
    ...base,
    requestedToMsExclusive: CUTOFF + ANSWER_WINDOW_MS - 1,
  });
  assert.equal(shortAnswer.compilerResult?.status, "unscorable");
  assert.equal(
    shortAnswer.compilerResult?.status === "unscorable" && shortAnswer.compilerResult.reason.code,
    "coverage-incomplete",
  );
});

test("incomplete evidence cannot produce Buy, Sell, or No trade", () => {
  const result = compileCoveredCandidate(candidate(), { status: "rejected", reason: "missing-pages" });
  assert.equal(result.compilerResult, null);
  assert.equal(result.coverage, null);
  assert.equal(result.rejectionReason, "missing-pages");
});

test("same-transaction legs are rejected before provider semantics can affect rules v4", () => {
  const rows = completeCandidateRows([
    row({ block_timestamp: new Date(CUTOFF).toISOString(), transaction_hash: hash(20), estimated_value_usd: 1_500 }),
    row({
      block_timestamp: new Date(CUTOFF).toISOString(),
      transaction_hash: hash(20),
      action: "SELL",
      estimated_value_usd: 1_000,
    }),
  ]);
  const result = compileCoveredCandidate(
    candidate(),
    normalizeCompletePages([parsedPage(1, rows, true)], coveragePlan()),
  );
  assert.equal(result.compilerResult, null);
  assert.equal(result.rejectionReason, "ambiguous-provider-transaction-legs");
});

test("Claude's duplicated two-by-$1,300 transaction cannot become No trade", () => {
  const duplicateLeg = row({
    block_timestamp: new Date(CUTOFF).toISOString(),
    transaction_hash: hash(30),
    estimated_value_usd: 1_300,
  });
  const normalized = normalizeCompletePages(
    [parsedPage(1, [...completeCandidateRows(), duplicateLeg, { ...duplicateLeg }], true)],
    coveragePlan(),
  );
  assert.deepEqual(normalized, { status: "rejected", reason: "duplicate-or-unstable-pagination-row" });
  const result = compileCoveredCandidate(candidate(), normalized);
  assert.equal(result.compilerResult, null);
});

test("request fingerprints include version, purpose, page, and candidate wallet filter", () => {
  const first = buildAcquisitionRequest(TOKEN, CUTOFF, CUTOFF + DAY, 1);
  const second = buildAcquisitionRequest(TOKEN, CUTOFF, CUTOFF + DAY, 2);
  const walletRequest = buildAcquisitionRequest(TOKEN, CUTOFF, CUTOFF + DAY, 1, WALLET);
  const otherWalletRequest = buildAcquisitionRequest(TOKEN, CUTOFF, CUTOFF + DAY, 1, OTHER_WALLET);
  assert.equal(acquisitionRequestFingerprint(first, "discovery"), acquisitionRequestFingerprint({ ...first }, "discovery"));
  assert.notEqual(acquisitionRequestFingerprint(first, "discovery"), acquisitionRequestFingerprint(second, "discovery"));
  assert.notEqual(acquisitionRequestFingerprint(first, "discovery"), acquisitionRequestFingerprint(first, "coverage"));
  assert.notEqual(
    acquisitionRequestFingerprint(walletRequest, "coverage"),
    acquisitionRequestFingerprint(otherWalletRequest, "coverage"),
  );
  assert.notEqual(
    acquisitionRequestFingerprint(first, "discovery"),
    legacyAcquisitionRequestFingerprintV3(first, "discovery"),
  );
  assert.match(acquisitionRequestFingerprint(first, "discovery"), /^[0-9a-f]{64}$/);
});

test("sanitized report allowlist drops injected private fields", () => {
  const report = buildSanitizedAcquisitionReport({
    reportVersion: 4,
    discoveryCalls: 1,
    coverageCalls: 2,
    rows: 3,
    candidates: 1,
    rejectionReasons: { duplicate: 1, [WALLET]: 1, PRIVATE: 1 },
    scorable: { buy: 1, sell: 0, noTrade: 0 },
    attempts: 3,
    successes: 3,
    reportedCredits: 3,
    retainedCredits: 3,
    discoveryPages: [
      {
        rowCount: 3,
        validRowCount: 2,
        invalidRowCount: 1,
        validationRejections: { "wallet-address-invalid": 1, [WALLET]: 1 },
        qualifyingRows: 1,
        distinctCandidateFingerprints: 1,
        timeSpanBand: "under-1-hour",
        pagination: { page: 1, perPage: 100, isLastPage: false },
        reportedCreditCost: 1,
        latencyBand: "under-250-ms",
        wallet: WALLET,
      } as never,
    ],
    coveragePages: [
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
        wallet: WALLET,
        token: TOKEN.address,
        hash: hash(91),
        label: "PRIVATE COVERAGE LABEL",
        exactTimestamp: "2026-01-01T00:00:00.000Z",
        exactValue: 25_000,
        requestBody: { filters: { trader_address: WALLET } },
        rawRow: row(),
        key: "SYNTHETIC-PRIVATE-KEY",
      } as never,
    ],
    wallet: WALLET,
    hash: hash(90),
    label: "PRIVATE",
    exactValue: 25_000,
    exactTimestamp: "2026-01-01T00:00:00.000Z",
  } as never);
  const serialized = JSON.stringify(report);
  for (const forbidden of [WALLET, TOKEN.address, hash(90), hash(91), "PRIVATE", "25000", "2026-"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  }
});
