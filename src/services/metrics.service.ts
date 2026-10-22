import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const histogram = monitorEventLoopDelay({
  resolution: 20,
});

histogram.enable();

let previousElu = performance.eventLoopUtilization();

export function getRuntimeMetrics() {
  const elu = performance.eventLoopUtilization(previousElu);
  previousElu = performance.eventLoopUtilization();

  return {
    eventLoop: {
      utilization: Number(elu.utilization.toFixed(4)),
      meanDelayMs: Number((histogram.mean / 1e6).toFixed(2)),
      maxDelayMs: Number((histogram.max / 1e6).toFixed(2)),
    },
    process: {
      cpuUsage: process.cpuUsage(),
      memory: process.memoryUsage(),
      uptimeSeconds: process.uptime(),
    },
  };
}
