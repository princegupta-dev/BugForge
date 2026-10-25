// EXPERIMENT 01 (`toCsv`): deliberately naive CSV encoder. It runs synchronously on the
// main thread and builds every line plus the final string in memory before
// anything is sent. Do not fix here; this is the behaviour under test.

const NEEDS_QUOTING = /[",\n\r]/;

function escapeField(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<T extends object>(rows: T[], columns: (keyof T)[]): string {
  const header = columns.map((column) => escapeField(column)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeField(row[column])).join(","),
  );
  return [header, ...lines].join("\n");
}

// EXPERIMENT 02: same bytes as `toCsv`, produced one batch at a time.
// Between batches it awaits `setImmediate`, which lets the event loop run
// pending I/O (other requests) before the next slice of CPU work. Awaiting an
// already-resolved promise would NOT do that: promise callbacks (microtasks)
// run before the event loop gets back to I/O.
export async function* toCsvChunks<T extends object>(
  batches: Iterable<T[]>,
  columns: (keyof T)[],
  onSlice?: (durationMs: number) => void,
): AsyncGenerator<string> {
  yield columns.map((column) => escapeField(column)).join(",");

  const iterator = batches[Symbol.iterator]();
  while (true) {
    await yieldToEventLoop();
    const started = performance.now();
    const next = iterator.next();
    if (next.done) break;
    const lines = next.value.map((row) =>
      columns.map((column) => escapeField(row[column])).join(","),
    );
    const chunk = "\n" + lines.join("\n");
    onSlice?.(performance.now() - started);
    yield chunk;
  }
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));
