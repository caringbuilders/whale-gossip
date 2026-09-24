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
  compileCoveredCandidate,
  discoverCandidates,
  normalizeCompletePages,
  parseProviderPage,
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
    if (index > 0) assert.equal(first[index - 1].localToMsExclusive, plan.localFromMs);
  }
});

test("requests reject arbitrary tokens, invalid intervals, and invalid pages", () => {
  assert.throws(
    () => buildAcquisitionRequest({ ...TOKEN, address: OTHER_WALLET }, 1, 2),
    /reviewed acquisition universe/,
  );
  assert.throws(() => buildAcquisitionRequest(TOKEN, 2, 2), /interval/);
  assert.throws(() => buildAcquisitionRequest(TOKEN, 1, 2, 0), /page/);
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

test("normalization requires millisecond timestamps, addresses, hashes, actions, and valid USD", () => {
  const invalidRows = [
    row({ block_timestamp: "2026-09-01T00:00:00Z" }),
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

test("exact canonical rows deduplicate while conflicting identities reject", () => {
  const exact = row();
  const duplicate = normalizeCompletePages([parsedPage(1, [exact, { ...exact }], true)], coveragePlan());
  assert.equal(duplicate.status, "complete");
  assert.equal(duplicate.events.length, 1);
  assert.equal(duplicate.exactDuplicateRows, 1);

  const conflict = normalizeCompletePages(
    [parsedPage(1, [exact, { ...exact, estimated_value_usd: 25_001 }], true)],
    coveragePlan(),
  );
  assert.deepEqual(conflict, { status: "rejected", reason: "conflicting-row" });
});

test("discovery creates deterministic candidates only from qualifying observed trades", () => {
  const retrieval = Date.parse("2026-09-24T12:00:00.000Z");
  const plan = buildDiscoveryPlan(retrieval)[2];
  const eventTime = plan.localFromMs + DAY;
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
  const normalized = normalizeCompletePages([parsed.page], plan);
  assert.equal(normalized.status, "complete");
  const candidates = discoverCandidates(normalized, plan);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].wallet, WALLET);
  assert.equal(candidates[0].proposedCutoffMs, Math.floor(eventTime / DAY) * DAY + DAY);
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

test("request fingerprints include page and schema deterministically", () => {
  const first = buildAcquisitionRequest(TOKEN, CUTOFF, CUTOFF + DAY, 1);
  const second = buildAcquisitionRequest(TOKEN, CUTOFF, CUTOFF + DAY, 2);
  assert.equal(acquisitionRequestFingerprint(first), acquisitionRequestFingerprint({ ...first }));
  assert.notEqual(acquisitionRequestFingerprint(first), acquisitionRequestFingerprint(second));
});
