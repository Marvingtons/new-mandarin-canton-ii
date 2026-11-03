/**
 * The dining room, as data.
 *
 * THIS FILE IS THE ROOM. The floor plan sheet on the POS draws exactly what is
 * here, and the order route validates every table label against it, so moving
 * a table, adding one, or changing which pairs push together is an edit to
 * this file and nothing else. No component knows how many tables there are.
 *
 * COORDINATES are abstract units on a ROOM_WIDTH x ROOM_HEIGHT canvas, origin
 * top-left, matching the owner's drawing (tables 1 to 3 down the right wall,
 * the 4+5 pair in the middle, 7+8 on the left, 9 and 6 along the bottom). The
 * floor plan (components/kitchen/FloorPlan) scales the canvas, with a margin
 * for the landmarks, to fill its pane: about 0.9px a unit on an 11" to 13"
 * tablet, so the smallest table is a 110px+ target.
 *
 * SEATS ARE GUIDANCE, NEVER A CAP. The POS shows them; nothing refuses a party
 * larger than the number.
 *
 * ⚠️ TODO(confirm): seat counts are a first pass, not the owner's numbers.
 * Singles are 4 each and 7+8 is 8, as asked. 4+5 is 10, read from the drawing
 * (five chairs down each side of the pushed-together pair).
 *
 * Pure data and pure helpers: no `server-only`, so the POS and the order route
 * share one definition of what a table label means.
 */

export const ROOM_WIDTH = 1000;
/** Kept short enough that the whole room fits an 11" landscape tablet unscrolled. */
export const ROOM_HEIGHT = 600;

export interface FloorTable {
  /** What staff call it and what prints: "4". Unique. */
  id: string;
  /** Top-left corner, in room units. */
  x: number;
  y: number;
  /** Size, in room units. */
  w: number;
  h: number;
  /** Guidance only; never enforced. */
  seats: number;
  /** Tables this one can be pushed together with (the dashed lines). */
  combinableWith?: string[];
  /**
   * Chairs drawn on each side: top, right, bottom, left. Drawing only; the
   * seat guidance is `seats`. TODO(confirm): placed from the drawing, not yet
   * checked against the room.
   */
  chairs: { t?: number; r?: number; b?: number; l?: number };
}

/**
 * Fixed things in the room, drawn so staff can orient: the counter, the
 * altar, the door. A `door` is a gap in the bottom wall with its label above.
 * TODO(confirm): positions are placeholders until the owner places them.
 */
export interface FloorLandmark {
  id: string;
  nameZh: string;
  nameEn: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "box" | "door";
}

export interface TableCombination {
  /** The two tables, in the order they print: "4+5". */
  ids: [string, string];
  /** Guidance only, as for a single table. */
  seats: number;
}

export const FLOOR_TABLES: FloorTable[] = [
  { id: "1", x: 745, y: 10, w: 125, h: 125, seats: 4, chairs: { r: 2, l: 2 } },
  { id: "2", x: 745, y: 190, w: 125, h: 125, seats: 4, chairs: { r: 2, l: 2 } },
  { id: "3", x: 745, y: 370, w: 125, h: 130, seats: 4, chairs: { r: 2, l: 2 } },
  { id: "4", x: 405, y: 10, w: 150, h: 180, seats: 4, combinableWith: ["5"], chairs: { t: 1, r: 2, l: 2 } },
  { id: "5", x: 405, y: 190, w: 150, h: 180, seats: 4, combinableWith: ["4"], chairs: { b: 1, r: 2, l: 2 } },
  { id: "7", x: 140, y: 110, w: 125, h: 140, seats: 4, combinableWith: ["8"], chairs: { r: 2, l: 2 } },
  { id: "8", x: 140, y: 250, w: 125, h: 140, seats: 4, combinableWith: ["7"], chairs: { r: 2, l: 2 } },
  { id: "9", x: 130, y: 450, w: 135, h: 140, seats: 4, chairs: { t: 1, r: 1, b: 1, l: 1 } },
  { id: "6", x: 430, y: 445, w: 140, h: 145, seats: 4, chairs: { r: 2, l: 2 } },
];

export const FLOOR_LANDMARKS: FloorLandmark[] = [
  { id: "counter", nameZh: "櫃檯", nameEn: "Counter", x: -30, y: -30, w: 128, h: 72, kind: "box" },
  { id: "altar", nameZh: "神檯", nameEn: "Altar", x: 930, y: 230, w: 100, h: 110, kind: "box" },
  { id: "entrance", nameZh: "入口", nameEn: "Entrance", x: 890, y: 580, w: 130, h: 0, kind: "door" },
];

export const TABLE_COMBINATIONS: TableCombination[] = [
  { ids: ["4", "5"], seats: 10 },
  { ids: ["7", "8"], seats: 8 },
];

const BY_ID = new Map(FLOOR_TABLES.map((t) => [t.id, t]));

export function floorTable(id: string): FloorTable | undefined {
  return BY_ID.get(id);
}

/** "4+5" for a combination, "4" for a single table. */
export function tableLabel(ids: readonly string[]): string {
  return ids.join("+");
}

/** The combination these two tables make, in either order, or undefined. */
export function combinationOf(a: string, b: string): TableCombination | undefined {
  return TABLE_COMBINATIONS.find(
    (c) => (c.ids[0] === a && c.ids[1] === b) || (c.ids[0] === b && c.ids[1] === a),
  );
}

/** Every combination a table can be part of. */
export function combinationsFor(id: string): TableCombination[] {
  return TABLE_COMBINATIONS.filter((c) => c.ids.includes(id));
}

/**
 * The tables a label occupies, or null when the label is not a seat in this
 * room. Accepts exactly what tableLabel produces: a single table id, or a
 * configured combination in its configured order. "5+4", "4+4" and "10" are
 * all null, so the server stores one spelling per seating.
 */
export function tablesForLabel(label: string): string[] | null {
  if (BY_ID.has(label)) return [label];
  const combo = TABLE_COMBINATIONS.find((c) => tableLabel(c.ids) === label);
  return combo ? [...combo.ids] : null;
}

/** Seat guidance for a label: the table's, or the combination's. */
export function seatsForLabel(label: string): number | null {
  const single = BY_ID.get(label);
  if (single) return single.seats;
  return TABLE_COMBINATIONS.find((c) => tableLabel(c.ids) === label)?.seats ?? null;
}

/** Do two labels share a table? "4" and "4+5" do; "4" and "5" do not. */
export function labelsOverlap(a: string, b: string): boolean {
  const ta = tablesForLabel(a) ?? [a];
  const tb = new Set(tablesForLabel(b) ?? [b]);
  return ta.some((id) => tb.has(id));
}
