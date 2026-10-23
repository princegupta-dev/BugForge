// EXPERIMENT 01: a fixed, deterministic dataset standing in for an "orders"
// table. Every call materialises the full result set as an array of objects,
// the way an ORM `findAll()` with no pagination would.

export const ORDER_ROW_COUNT = 300_000;
const SEED = 0x5eed_0001;

export interface Order {
  id: number;
  customerId: number;
  email: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  status: string;
  createdAt: Date;
  country: string;
  note: string;
}

const STATUSES = ["pending", "paid", "shipped", "delivered", "refunded"];
const CURRENCIES = ["USD", "EUR", "GBP", "INR"];
const COUNTRIES = ["US", "DE", "GB", "IN", "FR", "BR", "JP", "CA"];
// Some notes contain commas, quotes and newlines so the CSV encoder has to
// escape real fields, as it would with user-entered text.
const NOTES = [
  "",
  "leave at door",
  'gift, wrap "nicely"',
  "call before delivery",
  "fragile\nhandle with care",
];
const BASE_TIME = Date.UTC(2025, 0, 1);

// mulberry32: tiny seeded PRNG so every run sees byte-identical data.
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function findAllOrders(count = ORDER_ROW_COUNT): Order[] {
  const random = createRandom(SEED);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
  const orders: Order[] = [];

  for (let id = 1; id <= count; id++) {
    const customerId = 1 + Math.floor(random() * 50_000);
    orders.push({
      id,
      customerId,
      email: `customer${customerId}@example.com`,
      sku: `SKU-${String(Math.floor(random() * 10_000)).padStart(5, "0")}`,
      quantity: 1 + Math.floor(random() * 5),
      unitPriceCents: 100 + Math.floor(random() * 50_000),
      currency: pick(CURRENCIES),
      status: pick(STATUSES),
      createdAt: new Date(BASE_TIME + Math.floor(random() * 365 * 86_400_000)),
      country: pick(COUNTRIES),
      note: pick(NOTES),
    });
  }

  return orders;
}
