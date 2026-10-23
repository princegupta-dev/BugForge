import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface ServerHandle {
  pid: number;
  baseUrl: string;
  stop(): Promise<void>;
}

// The server runs in its own process so the load generator's event loop is
// never the one being blocked.
export function startServer(): Promise<ServerHandle> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });

  return new Promise((resolve, reject) => {
    let output = "";
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`server exited early with code ${code}: ${output}`)),
    );
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/localhost:(\d+)/);
      if (!match) return;
      child.removeAllListeners("exit");
      resolve({
        pid: child.pid!,
        baseUrl: `http://127.0.0.1:${match[1]}`,
        stop: () =>
          new Promise((done) => {
            child.once("exit", () => done());
            child.kill("SIGTERM");
          }),
      });
    });
  });
}

export interface ProcessSample {
  atMs: number;
  rssBytes: number;
  cpuSeconds: number;
}

// "[dd-][hh:]mm:ss[.cc]" as printed by `ps -o time=`.
function parsePsTime(text: string): number {
  const [days, clock] = text.includes("-") ? text.split("-") : ["0", text];
  return clock!
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), Number(days) * 86_400);
}

async function readProcess(pid: number): Promise<Omit<ProcessSample, "atMs">> {
  if (process.platform === "linux") {
    // Fields after the parenthesised command name; utime/stime are 14th/15th.
    const stat = (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]!.split(" ");
    const statm = (await readFile(`/proc/${pid}/statm`, "utf8")).split(" ");
    return {
      cpuSeconds: (Number(stat[11]) + Number(stat[12])) / 100,
      rssBytes: Number(statm[1]) * 4096,
    };
  }
  const { stdout } = await execFileAsync("ps", ["-o", "rss=,time=", "-p", String(pid)]);
  const [rssKb, time] = stdout.trim().split(/\s+/);
  return { rssBytes: Number(rssKb) * 1024, cpuSeconds: parsePsTime(time!) };
}

// Samples CPU time and RSS from outside the server, so readings keep arriving
// even while the server's own event loop is stuck.
export function sampleProcess(pid: number, intervalMs = 200) {
  const samples: ProcessSample[] = [];
  let running = true;

  const loop = (async () => {
    while (running) {
      const atMs = performance.now();
      try {
        samples.push({ atMs, ...(await readProcess(pid)) });
      } catch {
        // Process may be exiting; skip the sample.
      }
      await new Promise((r) => setTimeout(r, intervalMs - (performance.now() - atMs)));
    }
  })();

  return {
    samples,
    async stop() {
      running = false;
      await loop;
      return samples;
    },
  };
}
