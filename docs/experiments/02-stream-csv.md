# Experiment 02: stream the CSV in batches

> **Branch:** `experiment/02-stream-csv` (based on experiment 01). The naive
> endpoint from experiment 01 is still there, so both can be compared under
> identical load.

## The change

| | Experiment 01 (`/exports/orders.csv`) | Experiment 02 (`/exports/orders-stream.csv`) |
| --- | --- | --- |
| Reading rows | all 300k at once (`findAllOrders`) | 5,000 at a time (`findOrdersInBatches`), like a DB cursor |
| Encoding | one ~500 ms synchronous call | ~60 slices of a few ms each |
| Between slices | n/a | `await setImmediate`: other requests get a turn |
| Sending | `res.send(string)` with `Content-Length` | `pipeline(Readable.from(...), res)`, chunked, with backpressure |
| Timing | `Server-Timing` header | `Server-Timing` **trailer** (sent after the body) |

The output is byte-identical (same SHA-256), and a test checks that.

```bash
pnpm bench:02                          # naive vs stream, side by side
EXPORT_VARIANT=stream pnpm bench:01    # stream only
pnpm test
```

## Results

5 runs of `pnpm bench:02` on 2026-10-25 (darwin-arm64, 8 CPUs, Node
v20.12.2, 100 rps `/health`, 2 export clients, 10 s phases). The value for
each run is shown, in run order.

| Signal (during exports) | Naive | Stream |
| --- | --- | --- |
| `/health` p50 | 330–615 ms | **10–14 ms** |
| `/health` p99 | 1,153 / 1,185 / 1,635 / 2,486 / 2,676 ms | **148 / 999 / 36 / 34 / 57 ms** |
| Event-loop delay max | 642–1,840 ms | 57–244 ms |
| Longest single slice of sync work (max) | 612–1,555 ms | 43–228 ms (typical slice ~10–17 ms) |
| Event-loop utilization | 0.98–0.99 | 0.98–0.99 |
| RSS peak | 390–514 MB | 135–181 MB |
| Export duration p50 | 1.1–1.4 s | 1.0–1.5 s |
| Export CPU work p50 | ~540–580 ms | ~540–610 ms |
| Load generator's own delay max | ≤ 65 ms | ≤ 78 ms |

## What the evidence says

- **Typical latency is fixed.** `/health` p50 dropped from hundreds of ms to
  ~10 ms. A request now waits for one slice, not one whole export.
- **The tail is better but not reliably fixed.** In 3 of 5 runs p99 was
  near baseline noise (34–57 ms). Two runs had spikes (148 ms and 999 ms).
  The load generator's own delay stayed low in every run, so this was not
  client noise. A follow-up timeline run showed short bursts of 200–340 ms
  stalls. **Cause not yet proven.** GC pauses and the cost of `res.write`
  turning 570 KB strings into Buffers are suspects. They were not measured.
- **Memory dropped ~2.5–3×.** No full row array, no full CSV string.
- **The thread is just as busy.** ELU is still ~0.99 and CPU work per export
  is unchanged. Streaming doesn't make the work cheaper; it **takes turns**
  with other requests. That's why `/health` p50 is ~10 ms and not 1 ms.
- **Nothing got slower for the exporter.** End-to-end export time stayed in
  the same range.

## Mistakes made while measuring (kept on purpose)

1. **"RSS growth = peak − baseline" was a bad metric.** The warmup export
   left memory behind that the process hadn't given back to the OS, so the
   naive baseline was already high. Comparing peaks directly was better but
   still flaky (ratios 0.35–0.69, because 200 ms sampling sometimes catches
   the naive peak low). So the test now checks memory **structurally**: the
   largest chunk the encoder ever holds is under 1/20 of the file. RSS is
   still printed, but not asserted.
2. **One bad run is not a result.** The second run alone suggested streaming
   barely helped p99 (999 ms). Three more runs showed it was an outlier.

## Next

- Find the cause of the tail spikes: `--trace-gc`, and timing `res.write`.
- **Experiment 03:** remove the `setImmediate` and keep only `await`, to
  prove the microtask trap with numbers.
- **Experiment 04:** worker thread. This is the only option that gives the
  main thread back entirely (ELU should drop, not just get shared).
- **Experiment 05:** cap concurrent exports.
