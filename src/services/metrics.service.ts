import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const histogram = monitorEventLoopDelay({
  resolution: 10,
});

histogram.enable();

let previousElu = performance.eventLoopUtilization();

const nsToMs = (ns: number) => Number((ns / 1e6).toFixed(2));

export function getRuntimeMetrics() {
  const elu = performance.eventLoopUtilization(previousElu);
  previousElu = performance.eventLoopUtilization();

  return {
    eventLoop: {
      utilization: Number(elu.utilization.toFixed(4)),
      meanDelayMs: nsToMs(histogram.mean),
      p50DelayMs: nsToMs(histogram.percentile(50)),
      p99DelayMs: nsToMs(histogram.percentile(99)),
      maxDelayMs: nsToMs(histogram.max),
    },
    process: {
      cpuUsage: process.cpuUsage(),
      memory: process.memoryUsage(),
      uptimeSeconds: process.uptime(),
    },
  };
}

export function resetRuntimeMetrics() {
  histogram.reset();
  previousElu = performance.eventLoopUtilization();
}
