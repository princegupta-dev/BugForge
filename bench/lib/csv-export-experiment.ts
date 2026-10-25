import { monitorEventLoopDelay } from "node:perf_hooks";
import { request, openLoop, repeatUntil, destroyAgent } from "./http-load.js";
import { startServer, sampleProcess, type ProcessSample } from "./server-process.js";
import { summarize, round } from "./stats.js";

export const EXPORT_PATHS = {
  naive: "/exports/orders.csv", // experiment 01
  stream: "/exports/orders-stream.csv", // experiment 02
} as const;
export type ExportVariant = keyof typeof EXPORT_PATHS;

export interface CsvExportExperimentOptions {
  exportVariant: ExportVariant;
  healthRatePerSecond: number;
  phaseSeconds: number;
  exportConcurrency: number;
  warmupSeconds: number;
}

export const DEFAULT_OPTIONS: CsvExportExperimentOptions = {
  exportVariant: "naive",
  healthRatePerSecond: 100,
  phaseSeconds: 10,
  exportConcurrency: 2,
  warmupSeconds: 3,
};

interface ServerMetrics {
  eventLoop: {
    utilization: number;
    meanDelayMs: number;
    p50DelayMs: number;
    p99DelayMs: number;
    maxDelayMs: number;
  };
  process: { cpuUsage: { user: number; system: number } };
}

async function getMetrics(baseUrl: string): Promise<ServerMetrics> {
  const res = await fetch(`${baseUrl}/metrics`);
  return (await res.json()) as ServerMetrics;
}

function parseHeaderPairs(value: string | string[] | undefined) {
  const pairs: Record<string, number> = {};
  for (const part of String(value ?? "").split(",")) {
    const match = part.trim().match(/^(\w+)[;=](?:dur=)?(-?[\d.]+)$/);
    if (match) pairs[match[1]!] = Number(match[2]);
  }
  return pairs;
}

async function exportOnce(url: string) {
  const started = performance.now();
  const res = await request(url);
  // Buffered exports send Server-Timing as a header; streamed ones as a trailer.
  const timing = parseHeaderPairs(res.headers["server-timing"] ?? res.trailers["server-timing"]);
  const heap = parseHeaderPairs(res.headers["x-export-heap-delta-bytes"]);
  const serverComputeMs = timing.work ?? (timing.rows ?? 0) + (timing.csv ?? 0);
  return {
    status: res.status,
    durationMs: performance.now() - started,
    serverComputeMs,
    // Longest stretch of synchronous work. The naive export is one stretch.
    maxSliceMs: timing.maxSlice ?? serverComputeMs,
    rowsMs: timing.rows ?? Number.NaN,
    csvMs: timing.csv ?? Number.NaN,
    bytes: res.bytes,
    // A Content-Length header means the whole body existed before sending.
    contentLength: Number(res.headers["content-length"] ?? Number.NaN),
    transferEncoding: res.headers["transfer-encoding"] ?? null,
    heapRowsBytes: heap.rows ?? Number.NaN,
    heapCsvBytes: heap.csv ?? Number.NaN,
  };
}

function summarizeProcess(samples: ProcessSample[]) {
  // Fraction of one core used between consecutive external samples.
  const coreUse: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const elapsed = (samples[i]!.atMs - samples[i - 1]!.atMs) / 1000;
    coreUse.push((samples[i]!.cpuSeconds - samples[i - 1]!.cpuSeconds) / elapsed);
  }
  const rss = samples.map((s) => s.rssBytes / 2 ** 20);
  const mean = coreUse.reduce((a, b) => a + b, 0) / (coreUse.length || 1);
  return {
    samples: samples.length,
    meanCores: round(mean, 2),
    maxCores: round(Math.max(...coreUse), 2),
    // Share of sampling intervals where the process used >= 90% of a core.
    intervalsAbove90PctOfCore: round(coreUse.filter((c) => c >= 0.9).length / (coreUse.length || 1), 2),
    rssMinMb: round(Math.min(...rss)),
    rssPeakMb: round(Math.max(...rss)),
  };
}

async function runPhase(
  baseUrl: string,
  pid: number,
  options: CsvExportExperimentOptions,
  withExports: boolean,
) {
  const exportUrl = `${baseUrl}${EXPORT_PATHS[options.exportVariant]}`;
  const durationMs = options.phaseSeconds * 1000;
  await request(`${baseUrl}/metrics/reset`, "POST");
  const before = await getMetrics(baseUrl);
  const sampler = sampleProcess(pid);
  // If the load generator itself stalls, requests leave late and that lateness
  // shows up as latency. Measure it so a client hiccup can't pass as a server one.
  const clientDelay = monitorEventLoopDelay({ resolution: 10 });
  clientDelay.enable();
  const wallStart = performance.now();

  const [health, exports] = await Promise.all([
    openLoop(`${baseUrl}/health`, { ratePerSecond: options.healthRatePerSecond, durationMs }),
    withExports
      ? repeatUntil(performance.now() + durationMs, options.exportConcurrency, () => exportOnce(exportUrl))
      : Promise.resolve([]),
  ]);

  const wallSeconds = (performance.now() - wallStart) / 1000;
  clientDelay.disable();
  const samples = await sampler.stop();
  const after = await getMetrics(baseUrl);
  const cpuMicros =
    after.process.cpuUsage.user + after.process.cpuUsage.system -
    (before.process.cpuUsage.user + before.process.cpuUsage.system);

  const latency = summarize(health.map((s) => s.latencyMs));
  return {
    health: {
      sent: health.length,
      errors: health.filter((s) => !s.ok).length,
      latencyMs: Object.fromEntries(
        Object.entries(latency).map(([k, v]) => [k, k === "count" ? v : round(v, 2)]),
      ),
    },
    eventLoop: after.eventLoop,
    loadGeneratorDelayMs: {
      p99: round(clientDelay.percentile(99) / 1e6, 2),
      max: round(clientDelay.max / 1e6, 2),
    },
    process: { meanCoresFromCpuUsage: round(cpuMicros / 1e6 / wallSeconds, 2), ...summarizeProcess(samples) },
    exports: exports.length
      ? {
          completed: exports.length,
          failed: exports.filter((e) => e.status !== 200).length,
          durationMs: summarize(exports.map((e) => e.durationMs)),
          serverComputeMs: summarize(exports.map((e) => e.serverComputeMs)),
          maxSliceMs: summarize(exports.map((e) => e.maxSliceMs)),
          rowsMs: summarize(exports.map((e) => e.rowsMs)),
          csvMs: summarize(exports.map((e) => e.csvMs)),
          bodyBytes: exports[0]!.bytes,
          contentLengthHeader: exports[0]!.contentLength,
          transferEncoding: exports[0]!.transferEncoding,
          heapRowsMb: round(summarize(exports.map((e) => e.heapRowsBytes)).p50 / 2 ** 20),
          heapCsvMb: round(summarize(exports.map((e) => e.heapCsvBytes)).p50 / 2 ** 20),
        }
      : null,
    wallSeconds: round(wallSeconds, 2),
  };
}

export async function runCsvExportExperiment(overrides: Partial<CsvExportExperimentOptions> = {}) {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const server = await startServer();

  try {
    // Warm up JIT for both code paths so phases compare steady states.
    await openLoop(`${server.baseUrl}/health`, {
      ratePerSecond: options.healthRatePerSecond,
      durationMs: options.warmupSeconds * 1000,
    });
    await exportOnce(`${server.baseUrl}${EXPORT_PATHS[options.exportVariant]}`);

    const baseline = await runPhase(server.baseUrl, server.pid, options, false);
    const contended = await runPhase(server.baseUrl, server.pid, options, true);

    return {
      experiment: `csv-export-${options.exportVariant}`,
      recordedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cpus: (await import("node:os")).cpus().length,
      },
      options,
      baseline,
      contended,
    };
  } finally {
    destroyAgent();
    await server.stop();
  }
}
