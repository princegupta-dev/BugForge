# Streams, backpressure, and yielding to the event loop

## Streaming in one sentence

Send data as you produce it, instead of building all of it first. Memory then
depends on the size of one batch, not on the size of the whole file.

```ts
// Buffered: memory = whole file
res.send(toCsv(findAllOrders()));

// Streamed: memory = one batch (plus whatever is in flight on the socket)
await pipeline(Readable.from(toCsvChunks(findOrdersInBatches(5_000))), res);
```

## Backpressure

**What it is:** when the receiver is slower than the sender, the sender
waits instead of piling data up in memory.

**How it works here:**
1. `res` (a writable stream) has a small buffer (its `highWaterMark`).
2. When `res.write()` fills it, `write()` returns `false`.
3. `pipeline` sees that and stops pulling from the generator.
4. When the socket drains, `res` emits `'drain'` and `pipeline` pulls the next
   chunk, which resumes the generator.

**Why it matters:** without it, a client on a slow mobile connection makes
the server hold the whole 34 MB in memory anyway. Calling `res.write()` in a
loop and ignoring its return value is the classic way to lose backpressure.
`pipeline` also handles errors and cleanup: if the client disconnects, the
generator is stopped instead of encoding rows nobody will read.

## Microtasks vs macrotasks: the yield that isn't

Streaming moves bytes in pieces, but **it doesn't automatically split the
CPU work**. What gives other requests a turn is going back to the event loop.

- **Macrotask:** a callback the event loop runs in one of its phases (timers,
  I/O, `setImmediate`). Between macrotasks the loop can pick up new I/O, such
  as an incoming `/health` request.
- **Microtask:** a promise callback (`.then`, code after `await`). The
  microtask queue is drained completely before the loop moves on. Pending I/O
  is not looked at while microtasks keep coming.

```ts
await Promise.resolve();                         // microtask: I/O still waits
await new Promise((r) => setImmediate(r));       // macrotask: I/O gets a turn
```

So an `async` function that loops over CPU work with only microtask
`await`s can block exactly like a synchronous loop. Experiment 02 uses
`setImmediate` between batches. Experiment 03 will measure what happens
without it.

## Trade-offs

| Gain | Cost |
| --- | --- |
| Memory per request ≈ one batch | No `Content-Length`, so no download progress percentage in browsers |
| Other requests wait one slice, not one export | Errors after the first byte can't become a clean 500; the connection is cut instead |
| Slow clients don't inflate memory | Total CPU work is unchanged; the thread is still ~100% busy under load |
| | Headers like `Server-Timing` must move to a trailer, which many tools ignore |

## Choosing the batch size

Smaller batches mean shorter stalls but more overhead per batch. 5,000 rows
was ~10–17 ms of work here. Pick it by measuring the longest slice, not by
guessing.
