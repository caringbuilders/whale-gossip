import "server-only";

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  type Dirent,
  type Stats,
} from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";

import {
  ACQUISITION_TOKEN_UNIVERSE,
  LEGACY_ACQUISITION_ADAPTER_VERSION,
  LEGACY_ACQUISITION_SCHEMA_VERSION,
  LEGACY_ACQUISITION_STATE_VERSION,
} from "./nansen-acquisition";

const ETHEREUM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ETHEREUM_TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;
const EXACT_MILLISECOND_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WHOLE_SECOND_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const OTHER_FRACTIONAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/;
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/;
const CACHE_FILE = /^([0-9a-f]{64})\.json$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface CacheDiagnosticPaths {
  readonly repositoryRoot: string;
  readonly state: string;
  readonly cacheDirectory: string;
}

export interface CacheDiagnosticReport {
  readonly diagnosticVersion: 1;
  readonly mode: "diagnose-cache";
  readonly networkRequestSent: false;
  readonly persistentWritesPerformed: false;
  readonly cacheEntries: {
    readonly total: number;
    readonly discoveryAnalyzed: number;
    readonly coverageSkipped: number;
  };
  readonly rows: number;
  readonly timestampShapes: {
    readonly isoZExactMilliseconds: number;
    readonly isoZWholeSeconds: number;
    readonly isoZOtherFractionalPrecision: number;
    readonly isoWithOffset: number;
    readonly parseableOtherFormat: number;
    readonly invalidString: number;
    readonly missingOrNonString: number;
  };
  readonly estimatedValueUsdShapes: {
    readonly positiveFiniteNumber: number;
    readonly zeroNumber: number;
    readonly negativeNumber: number;
    readonly numericStringPositive: number;
    readonly null: number;
    readonly missing: number;
    readonly otherInvalidType: number;
  };
  readonly rejectionCauses: {
    readonly timestampInvalidOnly: number;
    readonly valueInvalidOnly: number;
    readonly timestampAndValueInvalid: number;
    readonly timestampAndValueValid: number;
    readonly otherRequiredFieldInvalid: number;
    readonly rowsThatWouldOtherwisePassDiscoveryValidation: number;
  };
  readonly requiredFieldValidity: {
    readonly walletAddress: { readonly valid: number; readonly invalid: number };
    readonly tokenAddress: {
      readonly matchingConfiguredToken: number;
      readonly syntacticallyValidOther: number;
      readonly invalid: number;
    };
    readonly transactionHash: { readonly valid: number; readonly invalid: number };
    readonly action: { readonly valid: number; readonly invalid: number };
  };
}

type TimestampShape = keyof CacheDiagnosticReport["timestampShapes"];
type ValueShape = keyof CacheDiagnosticReport["estimatedValueUsdShapes"];
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] extends object ? Mutable<T[Key]> : T[Key] };

interface StateReference {
  readonly purpose: "discovery" | "coverage";
  readonly page: number;
  readonly requestId: string;
}

interface CacheEnvelope {
  readonly rows: readonly Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function assertOwnedAndPrivate(stat: Stats, kind: "file" | "directory"): void {
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
    throw new Error("Diagnostic private input has an unsafe file type");
  }
  if (stat.isSymbolicLink()) throw new Error("Diagnostic private input has an unsafe file type");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("Diagnostic private input has unsafe ownership");
  }
  if ((stat.mode & 0o077) !== 0) throw new Error("Diagnostic private input has unsafe permissions");
}

function assertSafeDirectoryChain(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("Diagnostic private path is not canonical");
  const root = parse(path).root;
  let current = root;
  for (const part of path.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, part);
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isMissing(error)) throw new Error("Diagnostic private input is missing");
      throw new Error("Diagnostic private path could not be inspected safely");
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Diagnostic private path contains an unsafe parent");
    }
  }
  assertOwnedAndPrivate(lstatSync(path), "directory");
}

function readPrivateJsonReadonly(path: string): unknown {
  assertSafeDirectoryChain(resolve(path, ".."));
  let initial: Stats;
  try {
    initial = lstatSync(path);
  } catch (error) {
    if (isMissing(error)) throw new Error("Diagnostic private input is missing");
    throw new Error("Diagnostic private input could not be inspected safely");
  }
  assertOwnedAndPrivate(initial, "file");

  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("Diagnostic private input could not be opened safely");
  }
  try {
    const opened = fstatSync(descriptor);
    assertOwnedAndPrivate(opened, "file");
    if (opened.dev !== initial.dev || opened.ino !== initial.ino) {
      throw new Error("Diagnostic private input changed during inspection");
    }
    try {
      return JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
    } catch {
      throw new Error("Diagnostic private input is malformed JSON");
    }
  } finally {
    closeSync(descriptor);
  }
}

function assertCanonicalPaths(paths: CacheDiagnosticPaths): void {
  const repositoryRoot = resolve(paths.repositoryRoot);
  if (repositoryRoot !== paths.repositoryRoot) throw new Error("Diagnostic repository path is not canonical");
  const privateRoot = join(repositoryRoot, "data", "private", "nansen-acquisition");
  if (paths.state !== join(privateRoot, "state.json") || paths.cacheDirectory !== join(privateRoot, "cache-v3")) {
    throw new Error("Diagnostic inputs are outside the canonical acquisition paths");
  }
}

function readStateIndex(path: string): Map<string, StateReference> {
  const value = readPrivateJsonReadonly(path);
  if (
    !isRecord(value) ||
    value.stateVersion !== LEGACY_ACQUISITION_STATE_VERSION ||
    value.adapterVersion !== LEGACY_ACQUISITION_ADAPTER_VERSION ||
    value.schemaVersion !== LEGACY_ACQUISITION_SCHEMA_VERSION ||
    !Array.isArray(value.work)
  ) {
    throw new Error("Diagnostic acquisition state is malformed or version-mismatched");
  }

  const references = new Map<string, StateReference>();
  for (const work of value.work) {
    if (!isRecord(work) || (work.purpose !== "discovery" && work.purpose !== "coverage") || !Array.isArray(work.completedPages)) {
      throw new Error("Diagnostic acquisition state is malformed or version-mismatched");
    }
    for (const reference of work.completedPages) {
      if (
        !isRecord(reference) ||
        typeof reference.fingerprint !== "string" ||
        !/^[0-9a-f]{64}$/.test(reference.fingerprint) ||
        typeof reference.page !== "number" ||
        !Number.isSafeInteger(reference.page) ||
        reference.page < 1 ||
        typeof reference.requestId !== "string" ||
        !SAFE_REQUEST_ID.test(reference.requestId) ||
        references.has(reference.fingerprint)
      ) {
        throw new Error("Diagnostic acquisition state is malformed or version-mismatched");
      }
      references.set(reference.fingerprint, {
        purpose: work.purpose,
        page: reference.page,
        requestId: reference.requestId,
      });
    }
  }
  return references;
}

function readCacheEnvelope(path: string, fingerprint: string, reference: StateReference): CacheEnvelope {
  const value = readPrivateJsonReadonly(path);
  if (
    !isRecord(value) ||
    value.cacheVersion !== 3 ||
    value.fingerprint !== fingerprint ||
    typeof value.requestId !== "string" ||
    value.requestId !== reference.requestId ||
    !SAFE_REQUEST_ID.test(value.requestId) ||
    typeof value.retrievalTimeMs !== "number" ||
    !Number.isSafeInteger(value.retrievalTimeMs) ||
    value.retrievalTimeMs < 0 ||
    (value.reportedCreditCost !== null &&
      (typeof value.reportedCreditCost !== "number" ||
        !Number.isFinite(value.reportedCreditCost) ||
        value.reportedCreditCost < 0 ||
        Object.is(value.reportedCreditCost, -0))) ||
    typeof value.latencyMs !== "number" ||
    !Number.isFinite(value.latencyMs) ||
    value.latencyMs < 0 ||
    !isRecord(value.response) ||
    !Array.isArray(value.response.data) ||
    !value.response.data.every(isRecord) ||
    !isRecord(value.response.pagination) ||
    value.response.pagination.page !== reference.page ||
    typeof value.response.pagination.per_page !== "number" ||
    !Number.isSafeInteger(value.response.pagination.per_page) ||
    value.response.pagination.per_page < 1 ||
    value.response.data.length > value.response.pagination.per_page ||
    typeof value.response.pagination.is_last_page !== "boolean"
  ) {
    throw new Error("Diagnostic cache entry is malformed or mismatched");
  }
  return { rows: value.response.data };
}

function timestampShape(value: unknown): TimestampShape {
  if (typeof value !== "string") return "missingOrNonString";
  const parsed = Date.parse(value);
  if (
    EXACT_MILLISECOND_ISO.test(value) &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value
  ) {
    return "isoZExactMilliseconds";
  }
  if (
    WHOLE_SECOND_ISO.test(value) &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().replace(".000Z", "Z") === value
  ) {
    return "isoZWholeSeconds";
  }
  if (OTHER_FRACTIONAL_ISO.test(value) && Number.isFinite(parsed)) return "isoZOtherFractionalPrecision";
  if (OFFSET_ISO.test(value) && Number.isFinite(parsed)) return "isoWithOffset";
  if (Number.isFinite(parsed)) return "parseableOtherFormat";
  return "invalidString";
}

function valueShape(row: Record<string, unknown>): ValueShape {
  if (!Object.hasOwn(row, "estimated_value_usd")) return "missing";
  const value = row.estimated_value_usd;
  if (value === null) return "null";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0) return "positiveFiniteNumber";
    if (value === 0) return "zeroNumber";
    return "negativeNumber";
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return "numericStringPositive";
  }
  return "otherInvalidType";
}

function hasValidTimestamp(value: unknown): boolean {
  return timestampShape(value) === "isoZExactMilliseconds";
}

function hasValidValue(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && !Object.is(value, -0);
}

function emptyReport(): Mutable<CacheDiagnosticReport> {
  return {
    diagnosticVersion: 1,
    mode: "diagnose-cache",
    networkRequestSent: false,
    persistentWritesPerformed: false,
    cacheEntries: { total: 0, discoveryAnalyzed: 0, coverageSkipped: 0 },
    rows: 0,
    timestampShapes: {
      isoZExactMilliseconds: 0,
      isoZWholeSeconds: 0,
      isoZOtherFractionalPrecision: 0,
      isoWithOffset: 0,
      parseableOtherFormat: 0,
      invalidString: 0,
      missingOrNonString: 0,
    },
    estimatedValueUsdShapes: {
      positiveFiniteNumber: 0,
      zeroNumber: 0,
      negativeNumber: 0,
      numericStringPositive: 0,
      null: 0,
      missing: 0,
      otherInvalidType: 0,
    },
    rejectionCauses: {
      timestampInvalidOnly: 0,
      valueInvalidOnly: 0,
      timestampAndValueInvalid: 0,
      timestampAndValueValid: 0,
      otherRequiredFieldInvalid: 0,
      rowsThatWouldOtherwisePassDiscoveryValidation: 0,
    },
    requiredFieldValidity: {
      walletAddress: { valid: 0, invalid: 0 },
      tokenAddress: { matchingConfiguredToken: 0, syntacticallyValidOther: 0, invalid: 0 },
      transactionHash: { valid: 0, invalid: 0 },
      action: { valid: 0, invalid: 0 },
    },
  };
}

function assertCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Diagnostic aggregate contains an invalid count");
  return value;
}

export function buildSanitizedCacheDiagnosticReport(input: CacheDiagnosticReport): CacheDiagnosticReport {
  return {
    diagnosticVersion: 1,
    mode: "diagnose-cache",
    networkRequestSent: false,
    persistentWritesPerformed: false,
    cacheEntries: {
      total: assertCount(input.cacheEntries.total),
      discoveryAnalyzed: assertCount(input.cacheEntries.discoveryAnalyzed),
      coverageSkipped: assertCount(input.cacheEntries.coverageSkipped),
    },
    rows: assertCount(input.rows),
    timestampShapes: {
      isoZExactMilliseconds: assertCount(input.timestampShapes.isoZExactMilliseconds),
      isoZWholeSeconds: assertCount(input.timestampShapes.isoZWholeSeconds),
      isoZOtherFractionalPrecision: assertCount(input.timestampShapes.isoZOtherFractionalPrecision),
      isoWithOffset: assertCount(input.timestampShapes.isoWithOffset),
      parseableOtherFormat: assertCount(input.timestampShapes.parseableOtherFormat),
      invalidString: assertCount(input.timestampShapes.invalidString),
      missingOrNonString: assertCount(input.timestampShapes.missingOrNonString),
    },
    estimatedValueUsdShapes: {
      positiveFiniteNumber: assertCount(input.estimatedValueUsdShapes.positiveFiniteNumber),
      zeroNumber: assertCount(input.estimatedValueUsdShapes.zeroNumber),
      negativeNumber: assertCount(input.estimatedValueUsdShapes.negativeNumber),
      numericStringPositive: assertCount(input.estimatedValueUsdShapes.numericStringPositive),
      null: assertCount(input.estimatedValueUsdShapes.null),
      missing: assertCount(input.estimatedValueUsdShapes.missing),
      otherInvalidType: assertCount(input.estimatedValueUsdShapes.otherInvalidType),
    },
    rejectionCauses: {
      timestampInvalidOnly: assertCount(input.rejectionCauses.timestampInvalidOnly),
      valueInvalidOnly: assertCount(input.rejectionCauses.valueInvalidOnly),
      timestampAndValueInvalid: assertCount(input.rejectionCauses.timestampAndValueInvalid),
      timestampAndValueValid: assertCount(input.rejectionCauses.timestampAndValueValid),
      otherRequiredFieldInvalid: assertCount(input.rejectionCauses.otherRequiredFieldInvalid),
      rowsThatWouldOtherwisePassDiscoveryValidation: assertCount(
        input.rejectionCauses.rowsThatWouldOtherwisePassDiscoveryValidation,
      ),
    },
    requiredFieldValidity: {
      walletAddress: {
        valid: assertCount(input.requiredFieldValidity.walletAddress.valid),
        invalid: assertCount(input.requiredFieldValidity.walletAddress.invalid),
      },
      tokenAddress: {
        matchingConfiguredToken: assertCount(input.requiredFieldValidity.tokenAddress.matchingConfiguredToken),
        syntacticallyValidOther: assertCount(input.requiredFieldValidity.tokenAddress.syntacticallyValidOther),
        invalid: assertCount(input.requiredFieldValidity.tokenAddress.invalid),
      },
      transactionHash: {
        valid: assertCount(input.requiredFieldValidity.transactionHash.valid),
        invalid: assertCount(input.requiredFieldValidity.transactionHash.invalid),
      },
      action: {
        valid: assertCount(input.requiredFieldValidity.action.valid),
        invalid: assertCount(input.requiredFieldValidity.action.invalid),
      },
    },
  };
}

export function diagnoseCanonicalDiscoveryCache(paths: CacheDiagnosticPaths): CacheDiagnosticReport {
  assertCanonicalPaths(paths);
  const references = readStateIndex(paths.state);
  assertSafeDirectoryChain(paths.cacheDirectory);

  let entries: Dirent<string>[];
  try {
    entries = readdirSync(paths.cacheDirectory, { withFileTypes: true, encoding: "utf8" });
  } catch {
    throw new Error("Diagnostic cache directory could not be read safely");
  }

  const report = emptyReport();
  const seen = new Set<string>();
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const match = CACHE_FILE.exec(entry.name);
    if (!match || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("Diagnostic cache contains an unknown or unsafe entry");
    }
    const fingerprint = match[1];
    const reference = references.get(fingerprint);
    if (!reference || seen.has(fingerprint)) throw new Error("Diagnostic cache contains an unknown or duplicate entry");
    seen.add(fingerprint);
    report.cacheEntries.total += 1;
    const path = join(paths.cacheDirectory, entry.name);
    const cache = readCacheEnvelope(path, fingerprint, reference);
    if (reference.purpose === "coverage") {
      report.cacheEntries.coverageSkipped += 1;
      continue;
    }

    report.cacheEntries.discoveryAnalyzed += 1;
    for (const row of cache.rows) {
      report.rows += 1;
      const timestampCategory = timestampShape(row.block_timestamp);
      const usdCategory = valueShape(row);
      report.timestampShapes[timestampCategory] += 1;
      report.estimatedValueUsdShapes[usdCategory] += 1;

      const timestampValid = hasValidTimestamp(row.block_timestamp);
      const valueValid = hasValidValue(row.estimated_value_usd);
      if (timestampValid && valueValid) report.rejectionCauses.timestampAndValueValid += 1;
      else if (timestampValid) report.rejectionCauses.valueInvalidOnly += 1;
      else if (valueValid) report.rejectionCauses.timestampInvalidOnly += 1;
      else report.rejectionCauses.timestampAndValueInvalid += 1;

      const walletValid = typeof row.trader_address === "string" && ETHEREUM_ADDRESS.test(row.trader_address);
      const tokenAddress = row.token_address;
      const tokenSyntaxValid = typeof tokenAddress === "string" && ETHEREUM_ADDRESS.test(tokenAddress);
      const tokenMatches =
        tokenSyntaxValid && tokenAddress.toLowerCase() === ACQUISITION_TOKEN_UNIVERSE[0].address;
      const hashValid = typeof row.transaction_hash === "string" && ETHEREUM_TRANSACTION_HASH.test(row.transaction_hash);
      const actionValid = row.action === "BUY" || row.action === "SELL";

      report.requiredFieldValidity.walletAddress[walletValid ? "valid" : "invalid"] += 1;
      if (tokenMatches) report.requiredFieldValidity.tokenAddress.matchingConfiguredToken += 1;
      else if (tokenSyntaxValid) report.requiredFieldValidity.tokenAddress.syntacticallyValidOther += 1;
      else report.requiredFieldValidity.tokenAddress.invalid += 1;
      report.requiredFieldValidity.transactionHash[hashValid ? "valid" : "invalid"] += 1;
      report.requiredFieldValidity.action[actionValid ? "valid" : "invalid"] += 1;

      if (walletValid && tokenMatches && hashValid && actionValid) {
        report.rejectionCauses.rowsThatWouldOtherwisePassDiscoveryValidation += 1;
      } else {
        report.rejectionCauses.otherRequiredFieldInvalid += 1;
      }
    }
  }

  for (const [fingerprint, reference] of references) {
    if (reference.purpose === "discovery" && !seen.has(fingerprint)) {
      throw new Error("Diagnostic discovery cache is incomplete");
    }
  }
  return buildSanitizedCacheDiagnosticReport(report);
}
