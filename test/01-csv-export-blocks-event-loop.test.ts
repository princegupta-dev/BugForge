// EXPERIMENT 01 reproduction. These assertions describe the *bug*: they pass
// while the CSV export blocks the event loop and should start failing once it
// is fixed. No absolute latency is asserted; every threshold is relative to
// something measured in the same run, so the test holds on fast and slow
// machines alike.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runExperiment01 } from "../bench/lib/experiment-01.js";
import { findAllOrders, ORDER_ROW_COUNT } from "../src/services/orders.repository.js";

test("dataset is fixed: 300k rows, identical on every call", () => {
  const first = findAllOrders();
  const second = findAllOrders();
  assert.equal(first.length, ORDER_ROW_COUNT);
  assert.deepEqual(first.at(-1), second.at(-1));
  assert.deepEqual(first[12_345], second[12_345]);
});

test("CSV export degrades an unrelated /health endpoint", { timeout: 120_000 }, async (t) => {
  const result = await runExperiment01({
    healthRatePerSecond: 50,
    phaseSeconds: 4,
    exportConcurrency: 1,
    warmupSeconds: 1,
  });
  const { baseline, contended } = result;
  const exports = contended.exports!;
  const exportWorkMs = exports.serverComputeMs.p50;

  assert.ok(exports.completed > 0 && exports.failed === 0, "exports must succeed");
  assert.equal(contended.health.errors, 0, "health requests are delayed, not dropped");

  // The ordinary API is slower while exports run than it was on its own.
  assert.ok(
    contended.health.latencyMs.p99 > baseline.health.latencyMs.p99,
    `health p99 ${contended.health.latencyMs.p99}ms vs baseline ${baseline.health.latencyMs.p99}ms`,
  );

  // A health request that arrives mid-export waits for the export's synchronous
  // work to finish, so the worst health latency is on the order of that work.
  assert.ok(
    contended.health.latencyMs.max >= exportWorkMs * 0.5,
    `worst health latency ${contended.health.latencyMs.max}ms vs export work ${exportWorkMs}ms`,
  );

  // The server's own event-loop delay monitor sees the same stall.
  assert.ok(
    contended.eventLoop.maxDelayMs >= exportWorkMs * 0.5,
    `event-loop delay max ${contended.eventLoop.maxDelayMs}ms vs export work ${exportWorkMs}ms`,
  );
  assert.ok(contended.eventLoop.utilization > baseline.eventLoop.utilization);

  // The whole body is built before sending: a fixed Content-Length is set.
  assert.equal(exports.contentLengthHeader, exports.bodyBytes);

  t.diagnostic(
    `health p99 ${baseline.health.latencyMs.p99} -> ${contended.health.latencyMs.p99}ms, ` +
      `loop delay max ${baseline.eventLoop.maxDelayMs} -> ${contended.eventLoop.maxDelayMs}ms, ` +
      `export work p50 ${exportWorkMs}ms`,
  );
});
