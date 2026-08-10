import { COST_PER_REQUEST_USD } from "@/lib/places/client";
import { generateGrid, type AreaSpec } from "./grid";

export type Estimate = {
  cells: number;
  categories: number;
  /** Every cell answered by a single page and nothing subdivided. */
  minRequests: number;
  /** What a typical run costs, allowing for extra pages and some subdivision. */
  expectedRequests: number;
  minCostUsd: number;
  expectedCostUsd: number;
  /** Default budget cap offered in the UI: room to run, but bounded. */
  suggestedMaxRequests: number;
  suggestedMaxCostUsd: number;
};

/**
 * Roughly 40% of cell+category pairs need a second or third page, and dense
 * cells subdivide into four children. These multipliers are deliberately
 * generous — an estimate that lands under the real spend is worse than one that
 * lands over it.
 */
const AVG_PAGES_PER_CELL = 1.6;

/**
 * Kept at three decimals: a handful of requests costs fractions of a cent, and
 * rounding those to two decimals turns $0.035 into $0.04.
 */
export function usd(requests: number): number {
  return Math.round(requests * COST_PER_REQUEST_USD * 1000) / 1000;
}

export function estimateJob(
  area: AreaSpec,
  categoryCount: number,
  cellRadius: number,
): Estimate {
  const cells = generateGrid(area, cellRadius).length;
  const categories = Math.max(1, categoryCount);

  const minRequests = cells * categories;
  const expectedRequests = Math.ceil(minRequests * AVG_PAGES_PER_CELL);
  const suggestedMaxRequests = Math.ceil(expectedRequests * 2);

  return {
    cells,
    categories,
    minRequests,
    expectedRequests,
    minCostUsd: usd(minRequests),
    expectedCostUsd: usd(expectedRequests),
    suggestedMaxRequests,
    suggestedMaxCostUsd: usd(suggestedMaxRequests),
  };
}
