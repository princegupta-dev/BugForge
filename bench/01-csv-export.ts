import { mkdir, writeFile } from "node:fs/promises";
import {
  runCsvExportExperiment,
  DEFAULT_OPTIONS,
  type ExportVariant,
} from "./lib/csv-export-experiment.js";

const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

const result = await runCsvExportExperiment({
  exportVariant: (process.env.EXPORT_VARIANT ?? DEFAULT_OPTIONS.exportVariant) as ExportVariant,
  healthRatePerSecond: env("HEALTH_RPS", DEFAULT_OPTIONS.healthRatePerSecond),
  phaseSeconds: env("PHASE_SECONDS", DEFAULT_OPTIONS.phaseSeconds),
  exportConcurrency: env("EXPORT_CONCURRENCY", DEFAULT_OPTIONS.exportConcurrency),
  warmupSeconds: env("WARMUP_SECONDS", DEFAULT_OPTIONS.warmupSeconds),
});

const { baseline, contended } = result;
const row = (b: unknown, c: unknown) => ({ baseline: b, contended: c });
console.table({
  "health p50 ms": row(baseline.health.latencyMs.p50, contended.health.latencyMs.p50),
  "health p99 ms": row(baseline.health.latencyMs.p99, contended.health.latencyMs.p99),
  "health max ms": row(baseline.health.latencyMs.max, contended.health.latencyMs.max),
  "health errors": row(baseline.health.errors, contended.health.errors),
  "event-loop delay p99 ms": row(baseline.eventLoop.p99DelayMs, contended.eventLoop.p99DelayMs),
  "event-loop delay max ms": row(baseline.eventLoop.maxDelayMs, contended.eventLoop.maxDelayMs),
  "event-loop utilization": row(baseline.eventLoop.utilization, contended.eventLoop.utilization),
  "CPU mean cores": row(baseline.process.meanCoresFromCpuUsage, contended.process.meanCoresFromCpuUsage),
  "CPU max cores (sampled)": row(baseline.process.maxCores, contended.process.maxCores),
  "intervals >= 90% of a core": row(baseline.process.intervalsAbove90PctOfCore, contended.process.intervalsAbove90PctOfCore),
  "RSS peak MB": row(baseline.process.rssPeakMb, contended.process.rssPeakMb),
  "load generator delay max ms": row(baseline.loadGeneratorDelayMs.max, contended.loadGeneratorDelayMs.max),
});
console.log("exports during contended phase:", JSON.stringify(contended.exports, null, 2));

await mkdir("bench-results", { recursive: true });
const file = `bench-results/01-csv-export-${result.options.exportVariant}-${result.recordedAt.replaceAll(":", "-")}.json`;
await writeFile(file, JSON.stringify(result, null, 2));
console.log(`full result written to ${file}`);
