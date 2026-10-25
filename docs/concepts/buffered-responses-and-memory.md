# Buffered responses and memory

## The pattern

```ts
const rows = await findAll();   // every row as an object
const csv = toCsv(rows);        // every line, then one joined string
res.send(csv);                  // converted to a Buffer and written
```

Peak memory for one request is roughly *rows + intermediate lines + final
string + response Buffer*. Every concurrent request adds that again. Nothing
is freed until the response finishes and the GC runs.

## What experiment 01 measured (300k rows, 34 MB CSV)

- Heap grew by **~100 MB** for the row objects and another **~90 MB** while
  encoding (the 300k line strings plus the joined result). Both were measured
  before `res.send`, so the Buffer copy of the body comes on top, outside the
  JS heap.
- Process RSS went from ~150 MB to a peak of **~375–640 MB** with two
  concurrent exports.
- The response carried `Content-Length: 34013401`, equal to the body size.
  A fixed Content-Length is a cheap tell that the server held the entire
  body before sending the first byte. A streamed response would usually use
  chunked transfer encoding instead.

## Why memory and latency are linked

Large short-lived allocations make the garbage collector work harder. GC
pauses happen on the main thread too, so a memory-hungry request adds
event-loop delay beyond its own compute time. The outlier export that took
1.3 s instead of ~0.5 s is consistent with this, but experiment 01 did not
isolate GC. That is a question for a later experiment (e.g. `--trace-gc`).

## RSS is sticky (learned in experiment 02)

When V8 frees memory, the process often keeps those pages for a while
instead of handing them back to the OS. So RSS can stay high long after the
big objects are gone. That makes "RSS now minus RSS before" a misleading
metric: whatever ran earlier (like a warmup export) inflates the "before".
Compare peaks under the same conditions instead, or look at `heapUsed`.

Streaming the export (experiment 02) dropped peak RSS from 390–514 MB to
135–181 MB with two concurrent exports.
