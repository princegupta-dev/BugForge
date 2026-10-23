import { performance } from "node:perf_hooks";
import { Router } from "express";
import { toCsv } from "../services/csv.service.js";
import { findAllOrders, type Order } from "../services/orders.repository.js";

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

export default router;
