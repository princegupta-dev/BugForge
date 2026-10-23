import http from "node:http";

const agent = new http.Agent({ keepAlive: true });

export interface Response {
  status: number;
  bytes: number;
  headers: http.IncomingHttpHeaders;
}

export function request(url: string, method = "GET"): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, agent, timeout: 60_000 }, (res) => {
      let bytes = 0;
      res.on("data", (chunk: Buffer) => (bytes += chunk.length));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, bytes, headers: res.headers }),
      );
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end();
  });
}

export interface LatencySample {
  scheduledMs: number;
  latencyMs: number;
  ok: boolean;
}

// Open-loop load: requests are fired on a fixed schedule whether or not
// earlier ones have answered, and latency is measured from the *scheduled*
// send time. A closed loop ("send, wait, send again") would quietly stop
// sending while the server is stalled and under-report the tail
// (coordinated omission).
export async function openLoop(
  url: string,
  { ratePerSecond, durationMs }: { ratePerSecond: number; durationMs: number },
): Promise<LatencySample[]> {
  const intervalMs = 1000 / ratePerSecond;
  const total = Math.floor((durationMs / 1000) * ratePerSecond);
  const start = performance.now();
  const inFlight: Promise<LatencySample>[] = [];

  for (let i = 0; i < total; i++) {
    const scheduledMs = start + i * intervalMs;
    const wait = scheduledMs - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    inFlight.push(
      request(url).then(
        (res) => ({
          scheduledMs,
          latencyMs: performance.now() - scheduledMs,
          ok: res.status === 200,
        }),
        () => ({ scheduledMs, latencyMs: performance.now() - scheduledMs, ok: false }),
      ),
    );
  }

  return Promise.all(inFlight);
}

// Closed loop for the heavy requests: `concurrency` clients each repeat the
// export back-to-back until the deadline.
export async function repeatUntil<T>(
  deadlineMs: number,
  concurrency: number,
  task: () => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadlineMs) results.push(await task());
    }),
  );
  return results;
}

export function destroyAgent() {
  agent.destroy();
}
