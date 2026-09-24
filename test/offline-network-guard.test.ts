/**
 * OFFLINE GUARD SANITY TESTS.
 * These calls intentionally target dummy destinations and must be rejected
 * synchronously by the guard preloaded by the standard npm test command.
 */
import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

test("standard test command blocks fetch and raw outbound sockets", () => {
  assert.throws(() => globalThis.fetch("https://offline-guard.invalid"), /OFFLINE_TEST_NETWORK_BLOCKED:fetch/);
  assert.throws(
    () => net.connect({ host: "offline-guard.invalid", port: 443 }),
    /OFFLINE_TEST_NETWORK_BLOCKED:net\.connect/,
  );
});
