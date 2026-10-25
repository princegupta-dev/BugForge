# Experiment 01: CSV export blocks the event loop

> **Branch:** `experiment/01-event-loop-blocking`. This branch contains a
> deliberate performance bug. Do not merge into `main` as a fix.

## Incident being reproduced

An "export orders as CSV" endpoint loads all 300,000 rows, encodes them
synchronously, and sends one buffered response. While exports run, unrelated
endpoints become slow.

## Setup

| Piece | Where |
| --- | --- |
| Fixed dataset: 300k orders, seeded PRNG, byte-identical every run (34,013,401-byte CSV) | [src/services/orders.repository.ts](../../src/services/orders.repository.ts) |
| Naive encoder: `rows.map(...).join("\n")` | [src/services/csv.service.ts](../../src/services/csv.service.ts) |
| Endpoint `GET /exports/orders.csv` (reports `Server-Timing` and heap deltas) | [src/routes/exports.routes.ts](../../src/routes/exports.routes.ts) |
| Benchmark harness | [bench/](../../bench/) |
| Reproduction test | [test/01-csv-export-blocks-event-loop.test.ts](../../test/01-csv-export-blocks-event-loop.test.ts) |

The benchmark spawns the server as a child process, warms it up, then runs
two phases of equal length:

1. **baseline:** open-loop `GET /health` at a fixed rate.
2. **contended:** the same `/health` load, plus N clients repeatedly
   downloading the export.

Signals per phase: `/health` latency percentiles (client side), event-loop
delay and utilization (server's `/metrics`, histogram reset per phase), CPU
time and RSS (sampled with `ps` from outside every 200 ms), and per-export
server timing and heap growth.

```bash
pnpm bench:01                       # 100 rps, 10 s phases, 2 export clients
HEALTH_RPS=200 EXPORT_CONCURRENCY=4 pnpm bench:01
pnpm test                           # shorter version with assertions
```

Raw JSON results go to `bench-results/` (git-ignored).

## Results

Measured 2026-10-22 on darwin-arm64 with 8 CPUs and Node v20.12.2, using the
defaults (100 rps, 10 s phases, 2 export clients). There were two runs; the
second ran with more background load on the machine.

| Signal | Baseline (run 1 / run 2) | Contended (run 1 / run 2) |
| --- | --- | --- |
| `/health` p50 | 1.3 / 1.4 ms | 327 / 477 ms |
| `/health` p99 | 4.8 / 49.6 ms | 1,098 / 2,217 ms |
| `/health` max | 40 / 124 ms | 1,146 / 2,989 ms |
| `/health` errors | 0 / 0 | 0 / 0 |
| Event-loop delay p99 | 11.6 / 15.7 ms | 598 / 664 ms |
| Event-loop delay max | 45 / 81 ms | 605 / 2,026 ms |
| Event-loop utilization | 0.06 / 0.10 | 0.98 / 0.98 |
| CPU, mean cores | 0.08 / 0.09 | 1.32 / 1.25 |
| CPU, sampled max cores | 0.4 / 0.2 | 2.2 / 1.9 |
| Share of 200 ms intervals at or above 90% of one core | 0 / 0 | 1.00 / 0.92 |
| RSS peak | 152 / 166 MB | 638 / 374 MB |

Per export (contended phase, 18 and 17 exports completed):

| | Run 1 | Run 2 |
| --- | --- | --- |
| Server compute p50 (rows + CSV) | 502 ms | 527 ms |
| of which loading rows / encoding CSV | 123 / 387 ms | 132 / 391 ms |
| End-to-end duration p50 | 1,087 ms | 1,138 ms |
| Heap growth: rows / CSV | 103 / 91 MB | 100 / 90 MB |
| `Content-Length` = body size | yes (34,013,401) | yes |

## What the evidence says

- **Does the ordinary API slow down?** Yes, by two to three orders of magnitude
  at p99, with no errors. Requests queue behind the export.
- **Is one core saturated?** The JavaScript thread is: ELU was 0.98. Process
  CPU was ~1.3 cores, not exactly 1.0, because GC and libuv use helper
  threads. The other ~6 cores were idle.
- **Is JavaScript unable to handle other callbacks promptly?** Yes.
  Event-loop delay p99 (~600 ms) roughly matches one export's synchronous
  compute (~500–570 ms).
- **Are all rows and the final CSV held in memory?** Yes. Heap grew ~100 MB for
  rows plus ~90 MB for encoding, per request. The response had a fixed
  Content-Length equal to the full body.
- **Concurrency doesn't help.** End-to-end export time was about 2× compute with 2
  clients: the exports took turns on the one thread.
- **Noise is real.** Run 2 had one 1.3 s export and a 2 s loop stall. The
  test therefore asserts relationships, not numbers.

## Not yet done (on purpose)

No fix on this branch. The first fix is measured in
[experiment 02](02-stream-csv.md). Candidate directions to compare in later experiments: streaming
with backpressure, yielding between chunks, a worker thread, and pagination
at the data source. When a fix lands, the reproduction test should start
failing. Invert it into a regression test then.
