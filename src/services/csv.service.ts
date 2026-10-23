// EXPERIMENT 01: deliberately naive CSV encoder. It runs synchronously on the
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
