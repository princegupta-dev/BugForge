import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { toCsv, toCsvChunks } from "../services/csv.service.js";
import {
  findAllOrders,
  findOrdersInBatches,
  type Order,
} from "../services/orders.repository.js";

const router = Router();

const ORDER_COLUMNS: (keyof Order)[] = [
  "id",
  "customerId",
  "email",
  "sku",
  "quantity",
  "unitPriceCents",
  "currency",
  "status",
  "createdAt",
  "country",
  "note",
];

// EXPERIMENT 01: the incident endpoint. Loads all 300k rows, encodes them on
// the event loop, and sends one buffered response.
router.get("/orders.csv", (_req, res) => {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const orders = findAllOrders();
  const loaded = performance.now();
  const heapWithRows = process.memoryUsage().heapUsed;
  const csv = toCsv(orders, ORDER_COLUMNS);
  const encoded = performance.now();
  const heapWithCsv = process.memoryUsage().heapUsed;

  res.setHeader(
    "Server-Timing",
    `rows;dur=${(loaded - started).toFixed(1)}, csv;dur=${(encoded - loaded).toFixed(1)}`,
  );
  // Heap growth while this request still references its rows and its CSV.
  res.setHeader(
    "X-Export-Heap-Delta-Bytes",
    `rows=${heapWithRows - heapBefore}, csv=${heapWithCsv - heapWithRows}`,
  );
  res.type("text/csv").send(csv);
});

// ~5k rows is a few milliseconds of encoding: small enough that /health never
// waits long, large enough that per-batch overhead stays negligible.
const EXPORT_BATCH_SIZE = 5_000;

// EXPERIMENT 02: same CSV, streamed. Rows are read in batches, each batch is
// encoded and written, and the event loop gets a turn between batches.
// `pipeline` pauses the generator whenever the socket's buffer is full
// (backpressure), so a slow client cannot make us buffer the whole file.
router.get("/orders-stream.csv", async (req, res) => {
  const slices: number[] = [];
  const chunks = toCsvChunks(
    findOrdersInBatches(EXPORT_BATCH_SIZE),
    ORDER_COLUMNS,
    (durationMs) => slices.push(durationMs),
  );

  // The body is still being produced when headers go out, so timing is sent
  // as a trailer (a header after the body; needs chunked encoding).
  async function* withTimingTrailer() {
    yield* chunks;
    const total = slices.reduce((sum, ms) => sum + ms, 0);
    res.addTrailers({
      "Server-Timing": `work;dur=${total.toFixed(1)}, maxSlice;dur=${Math.max(...slices).toFixed(1)}`,
    });
  }

  res.type("text/csv");
  res.setHeader("Trailer", "Server-Timing");
  try {
    await pipeline(Readable.from(withTimingTrailer()), res);
  } catch (error) {
    // A client that disconnects mid-download is normal, not a server error.
    if (!req.destroyed) throw error;
  }
});

export default router;
