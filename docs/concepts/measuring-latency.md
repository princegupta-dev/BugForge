# Measuring latency without lying to yourself

## Open-loop vs closed-loop load

A **closed-loop** load generator sends a request, waits for the response,
then sends the next. When the server stalls for 1 s, each client simply
sends nothing for 1 s. The stall produces *one* slow sample instead of the
hundreds that real users, who don't wait for each other, would have hit.
This is **coordinated omission**: the load generator coordinates with
the server it is measuring and hides the tail.

An **open-loop** generator fires on a fixed schedule (e.g. every 10 ms)
regardless of outstanding responses, and measures latency from the
*scheduled* send time. Experiment 01 uses open-loop load for `/health`
([bench/lib/http-load.ts](../../bench/lib/http-load.ts)) and closed-loop
clients only for the export itself, where "a user clicks export and waits"
is the realistic model.

## Run the load generator in another process

If the load generator shares the event loop with the server, the blocking
work also delays the *measurement*: timers fire late and timestamps are
taken late. The benchmark spawns the server as a child process.

## Percentiles, and why the test uses no fixed numbers

- p50 tells you the typical case. p99 and max tell you what blocking does.
  A 500 ms stall every second barely moves the mean of a long run, but it
  dominates p99.
- Absolute numbers vary between machines and between runs on the same
  machine. In experiment 01, baseline p99 varied 10× between two runs (4.8 ms vs
  49.6 ms) because of background load. One export took 1.3 s instead of ~0.5 s.
- So the reproduction test compares measurements **within one run**:
  contended vs baseline, and worst health latency vs measured export work.
  That keeps it valid on a fast laptop and a slow CI runner, and it never
  bakes in an expected latency.
