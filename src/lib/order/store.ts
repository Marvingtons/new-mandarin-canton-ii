import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Order persistence behind a small interface so a real DB can replace the
 * JSON-file dev store without touching the checkout route. Deliberately not
 * over-engineered: a single JSON file, writes serialized through an in-process
 * mutex. Only Clover's chargeId is stored — never card data or tokens.
 */

export interface StoredOrderLine {
  itemId: string;
  nameEn: string;
  sizeId: string;
  sizeLabel: string;
  modifierIds: string[];
  quantity: number;
  unitCents: number;
  lineCents: number;
  specialInstructions?: string;
}

export interface StoredOrder {
  orderNumber: string;
  chargeId: string;
  idempotencyKey: string;
  status: "paid";
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  pickup: { name: string; phone: string; time: string; timeLabel: string };
  lines: StoredOrderLine[];
  /** Restaurant-local date (YYYY-MM-DD) that owns the daily sequence. */
  dateKey: string;
  createdAt: number;
}

export interface OrderStore {
  findByIdempotencyKey(key: string): Promise<StoredOrder | null>;
  /** Next order number for a local date, e.g. "A-017". */
  nextOrderNumber(prefix: string, dateKey: string): Promise<string>;
  create(order: StoredOrder): Promise<void>;
}

const DATA_DIR = join(process.cwd(), ".data");
const FILE = join(DATA_DIR, "orders.json");

/** Serialize all read-modify-write cycles so concurrent requests can't race. */
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  // Keep the chain alive regardless of individual outcomes.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readAll(): Promise<StoredOrder[]> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(orders: StoredOrder[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(orders, null, 2), "utf8");
}

class JsonOrderStore implements OrderStore {
  async findByIdempotencyKey(key: string): Promise<StoredOrder | null> {
    const all = await readAll();
    return all.find((o) => o.idempotencyKey === key) ?? null;
  }

  async nextOrderNumber(prefix: string, dateKey: string): Promise<string> {
    return withLock(async () => {
      const all = await readAll();
      const todays = all.filter((o) => o.dateKey === dateKey).length;
      return `${prefix}-${String(todays + 1).padStart(3, "0")}`;
    });
  }

  async create(order: StoredOrder): Promise<void> {
    await withLock(async () => {
      const all = await readAll();
      // Idempotency guard inside the lock: never double-write a key.
      if (all.some((o) => o.idempotencyKey === order.idempotencyKey)) return;
      all.push(order);
      await writeAll(all);
    });
  }
}

let instance: OrderStore | null = null;
export function orderStore(): OrderStore {
  if (!instance) instance = new JsonOrderStore();
  return instance;
}

/** Restaurant-local YYYY-MM-DD for the daily order sequence. */
export function localDateKey(timezone: string, at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
