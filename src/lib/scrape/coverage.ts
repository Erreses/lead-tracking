import "server-only";

import { and, gte, inArray, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { cellCoverage } from "@/lib/db/schema";
import type { Cell } from "./grid";

/**
 * Which cell × category searches have already been paid for.
 *
 * The Places API bills per request and has no "exclude these place ids"
 * parameter, so deduplicating businesses after the fact saves nothing — the
 * money is gone the moment the request goes out. The only real saving is not
 * issuing the request, which means remembering what has already been swept.
 */

/**
 * Six decimals is ~0.11 m, far finer than any lattice spacing, so the same area
 * and cell size always produce the same key — while two genuinely different
 * cells never collide.
 */
export function cellKey(cell: Pick<Cell, "lat" | "lng" | "radius">, categorySlug: string): string {
  return [
    cell.lat.toFixed(6),
    cell.lng.toFixed(6),
    Math.round(cell.radius),
    categorySlug,
  ].join(":");
}

/**
 * Keys swept since `since`, out of the ones asked about.
 *
 * SQLite caps a statement at 999 bound parameters, so the lookup is chunked
 * rather than trusting the caller to keep the grid small.
 */
export async function sweptSince(keys: string[], since: Date): Promise<Set<string>> {
  const found = new Set<string>();
  if (keys.length === 0) return found;

  for (let start = 0; start < keys.length; start += 500) {
    const chunk = keys.slice(start, start + 500);
    const rows = await db
      .select({ cellKey: cellCoverage.cellKey })
      .from(cellCoverage)
      .where(and(inArray(cellCoverage.cellKey, chunk), gte(cellCoverage.sweptAt, since)));

    for (const row of rows) found.add(row.cellKey);
  }

  return found;
}

/** Record one completed search, replacing any older entry for the same cell. */
export async function recordSweep(
  cell: Cell,
  categorySlug: string,
  result: { placesFound: number; saturated: boolean },
): Promise<void> {
  const now = new Date();

  await db
    .insert(cellCoverage)
    .values({
      cellKey: cellKey(cell, categorySlug),
      lat: cell.lat,
      lng: cell.lng,
      radius: Math.round(cell.radius),
      categorySlug,
      depth: cell.depth,
      placesFound: result.placesFound,
      saturated: result.saturated,
      sweptAt: now,
    })
    .onConflictDoUpdate({
      target: cellCoverage.cellKey,
      set: {
        depth: cell.depth,
        placesFound: result.placesFound,
        saturated: result.saturated,
        sweptAt: now,
      },
    });
}

/** How many of these searches a run would skip right now. */
export async function countCovered(
  cells: Cell[],
  categories: string[],
  since: Date,
): Promise<number> {
  const keys = cells.flatMap((cell) => categories.map((slug) => cellKey(cell, slug)));
  return (await sweptSince(keys, since)).size;
}

/** Drop entries older than the window so the table doesn't grow forever. */
export async function pruneCoverage(before: Date): Promise<number> {
  const deleted = await db
    .delete(cellCoverage)
    .where(lt(cellCoverage.sweptAt, before))
    .returning({ id: cellCoverage.id });
  return deleted.length;
}
