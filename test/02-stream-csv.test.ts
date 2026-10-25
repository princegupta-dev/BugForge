// EXPERIMENT 02 regression test. Runs the naive and the streamed export under
// the same load and compares them within one run, so no absolute latency or
// memory number is baked in.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { runCsvExportExperiment } from "../bench/lib/csv-export-experiment.js";
import { toCsv, toCsvChunks } from "../src/services/csv.service.js";
import { findAllOrders, findOrdersInBatches, type Order } from "../src/services/orders.repository.js";

const COLUMNS = Object.keys(findAllOrders(1)[0]!) as (keyof Order)[];
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

test("streamed CSV is byte-identical and never holds the whole file", async () => {
  let streamed = "";
  let largestChunk = 0;
  for await (const chunk of toCsvChunks(findOrdersInBatches(5_000), COLUMNS)) {
    streamed += chunk;
    largestChunk = Math.max(largestChunk, chunk.length);
  }
  assert.equal(sha256(streamed), sha256(toCsv(findAllOrders(), COLUMNS)));

  // The memory guarantee, checked structurally: the encoder only ever holds
  // one batch of CSV. (RSS is too noisy to assert on; see the test below.)
  assert.ok(
    largestChunk < streamed.length / 20,
    `largest chunk ${largestChunk} chars vs whole file ${streamed.length}`,
  );
});

test("streaming keeps /health responsive", { timeout: 180_000 }, async (t) => {
  const options = { healthRatePerSecond: 50, phaseSeconds: 4, exportConcurrency: 2, warmupSeconds: 1 };
  const naive = await runCsvExportExperiment({ ...options, exportVariant: "naive" });
  const stream = await runCsvExportExperiment({ ...options, exportVariant: "stream" });
  const exports = stream.contended.exports!;
  // Reported, not asserted: RSS is sampled every 200ms and is sticky (freed
  // pages are not handed back to the OS right away), so the naive peak is
  // sometimes caught low. Observed stream/naive ratios: 0.35-0.69.
  const rssPeak = (r: typeof naive) => r.contended.process.rssPeakMb;

  assert.ok(exports.completed > 0 && exports.failed === 0, "exports must succeed");
  assert.equal(exports.bodyBytes, naive.contended.exports!.bodyBytes);

  // Sent as it is produced: chunked, no up-front Content-Length.
  assert.equal(exports.transferEncoding, "chunked");
  assert.ok(Number.isNaN(exports.contentLengthHeader));

  // No single stretch of synchronous work comes close to the whole export.
  assert.ok(
    exports.maxSliceMs.p50 < exports.serverComputeMs.p50 * 0.25,
    `longest slice ${exports.maxSliceMs.p50}ms vs total work ${exports.serverComputeMs.p50}ms`,
  );

  // A typical /health request no longer waits for an export to finish.
  // (p50, not p99: the streamed tail still has unexplained spikes, see
  // docs/experiments/02-stream-csv.md.)
  assert.ok(
    stream.contended.health.latencyMs.p50 < exports.serverComputeMs.p50 * 0.1,
    `health p50 ${stream.contended.health.latencyMs.p50}ms vs export work ${exports.serverComputeMs.p50}ms`,
  );
  assert.ok(stream.contended.health.latencyMs.p50 < naive.contended.health.latencyMs.p50);

  t.diagnostic(
    `health p50 naive ${naive.contended.health.latencyMs.p50} vs stream ${stream.contended.health.latencyMs.p50}ms, ` +
      `p99 naive ${naive.contended.health.latencyMs.p99} vs stream ${stream.contended.health.latencyMs.p99}ms, ` +
      `RSS peak naive ${rssPeak(naive)} vs stream ${rssPeak(stream)}MB`,
  );
});
