import { mkdir, writeFile } from "node:fs/promises";
import { runCsvExportExperiment, DEFAULT_OPTIONS } from "./lib/csv-export-experiment.js";

const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const shared = {
  healthRatePerSecond: env("HEALTH_RPS", DEFAULT_OPTIONS.healthRatePerSecond),
  phaseSeconds: env("PHASE_SECONDS", DEFAULT_OPTIONS.phaseSeconds),
  exportConcurrency: env("EXPORT_CONCURRENCY", DEFAULT_OPTIONS.exportConcurrency),
  warmupSeconds: env("WARMUP_SECONDS", DEFAULT_OPTIONS.warmupSeconds),
};

// Each variant gets a fresh server, so one run's heap can't affect the other.
const naive = await runCsvExportExperiment({ ...shared, exportVariant: "naive" });
const stream = await runCsvExportExperiment({ ...shared, exportVariant: "stream" });

const row = (pick: (r: typeof naive) => unknown) => ({
  "naive baseline": pick(naive.baseline as never),
  "naive + exports": pick(naive.contended as never),
  "stream baseline": pick(stream.baseline as never),
  "stream + exports": pick(stream.contended as never),
});
type Phase = typeof naive.contended;
const phase = (pick: (p: Phase) => unknown) => row((p) => pick(p as unknown as Phase));

console.table({
  "health p50 ms": phase((p) => p.health.latencyMs.p50),
  "health p99 ms": phase((p) => p.health.latencyMs.p99),
  "health max ms": phase((p) => p.health.latencyMs.max),
  "health errors": phase((p) => p.health.errors),
  "event-loop delay p99 ms": phase((p) => p.eventLoop.p99DelayMs),
  "event-loop delay max ms": phase((p) => p.eventLoop.maxDelayMs),
  "event-loop utilization": phase((p) => p.eventLoop.utilization),
  "CPU mean cores": phase((p) => p.process.meanCoresFromCpuUsage),
  "RSS peak MB": phase((p) => p.process.rssPeakMb),
  "load generator delay max ms": phase((p) => p.loadGeneratorDelayMs.max),
});

const exportsRow = (pick: (e: NonNullable<Phase["exports"]>) => unknown) => ({
  naive: pick(naive.contended.exports!),
  stream: pick(stream.contended.exports!),
});
const ms = (value: number) => Math.round(value);
console.table({
  "exports completed": exportsRow((e) => e.completed),
  "export duration p50 ms": exportsRow((e) => ms(e.durationMs.p50)),
  "export CPU work p50 ms": exportsRow((e) => ms(e.serverComputeMs.p50)),
  "longest blocking slice max ms": exportsRow((e) => ms(e.maxSliceMs.max)),
  "Content-Length": exportsRow((e) => e.contentLengthHeader),
  "Transfer-Encoding": exportsRow((e) => e.transferEncoding),
});

await mkdir("bench-results", { recursive: true });
const file = `bench-results/02-stream-vs-naive-${naive.recordedAt.replaceAll(":", "-")}.json`;
await writeFile(file, JSON.stringify({ naive, stream }, null, 2));
console.log(`full result written to ${file}`);
