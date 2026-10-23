# Event-loop blocking

## The idea

A Node.js process runs all JavaScript on **one thread**. The event loop takes
the next ready callback (an incoming request, a timer, a finished read) and
runs it to completion before it looks at anything else. While a synchronous
function runs, every other callback waits, including requests to unrelated,
trivially cheap endpoints such as `/health`.

So the cost of a CPU-heavy request is not paid only by that request. It is
paid by **every request that arrives while it runs**.

## What it looked like in experiment 01

A 300k-row CSV export does about 0.5 s of synchronous work (build rows, then
encode CSV). While it runs on a loop with 2 concurrent export clients:

- `/health` p99 went from ~5–50 ms to ~1.1–2.2 s, with zero errors. Requests
  were queued, not dropped.
- Two "concurrent" exports did not run in parallel. Each took about 2× its own
  compute time end to end (~1.1 s vs ~0.5 s), because they took turns on the
  same thread.
- An 8-core machine stayed mostly idle. Adding concurrency to one Node process
  does not add cores for JavaScript.

## Signals and what each one tells you

| Signal | Source | What it answers |
| --- | --- | --- |
| Event-loop delay (`perf_hooks.monitorEventLoopDelay`) | inside the process | "How late did a timer fire?" Directly measures how long callbacks waited. A max close to the longest synchronous task is the fingerprint of blocking. |
| Event-loop utilization (ELU) | inside the process | Share of time the loop was busy running JS rather than idle waiting for I/O. ~1.0 means the main thread is saturated. |
| Process CPU time (`ps` / `/proc`, `process.cpuUsage`) | outside or inside | How many cores the process used. |
| Latency of a cheap endpoint | client side | User-visible impact. |

**Lesson: "one core saturated" shows up best as ELU ≈ 1, not as exactly 100% CPU.**
Process CPU averaged ~1.3 cores and peaked near 2, because V8's garbage
collector and libuv run on helper threads. The JavaScript thread itself was
the bottleneck (ELU 0.98), but the process number alone could look like
"more than one core, so not single-thread bound".

**Watch out: reading in-process metrics during a stall.** A `/metrics` request is
itself stuck behind the blocking work. The delay histogram still records the
stall accurately, because it measures the lateness afterwards. A live
dashboard polling that endpoint just goes quiet. That is why the benchmark
samples CPU and RSS from a separate process.

## Open questions (for later experiments)

- How much of the stall happens after the CSV is built (`res.send` converting
  the string to a Buffer, Express computing an ETag over the body)? Loop
  delay max (~605 ms) was slightly above measured compute (~573 ms).
- Which fix helps which signal? Chunking or streaming on the main thread, or
  moving encoding to a worker thread.
