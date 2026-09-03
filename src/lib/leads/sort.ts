/**
 * Sort vocabulary for the leads table.
 *
 * Kept apart from `query.ts` because that module is server-only, and the table
 * header — which has to build the same sort links — runs in the browser. One
 * definition, both sides.
 */

/** Every column the table can be ordered by. */
export const LEAD_SORTS = [
  "score",
  "name",
  "category",
  "why",
  "reviews",
  "rating",
  "quote",
  "status",
  "recent",
] as const;

export type LeadSort = (typeof LEAD_SORTS)[number];
export type SortDir = "asc" | "desc";

/**
 * Which way a column goes on the first click. Text reads naturally A→Z; for a
 * number you almost always want the biggest first.
 */
export const DEFAULT_SORT_DIR: Record<LeadSort, SortDir> = {
  score: "desc",
  name: "asc",
  category: "asc",
  why: "asc",
  reviews: "desc",
  rating: "desc",
  quote: "desc",
  status: "asc",
  recent: "desc",
};

/** Clicking the active column flips it; a new column starts at its default. */
export function nextSortDir(
  column: LeadSort,
  activeSort: LeadSort,
  activeDir: SortDir,
): SortDir {
  if (column !== activeSort) return DEFAULT_SORT_DIR[column];
  return activeDir === "asc" ? "desc" : "asc";
}
