import {
  COST_PER_REQUEST_USD,
  FREE_REQUESTS_PER_MONTH,
  RESULTS_PER_REQUEST,
} from "@/lib/places/pricing";
import { generateGrid, type AreaSpec } from "./grid";

export type FreeTierEstimate = {
  /** Free Enterprise requests per calendar month. */
  limit: number;
  /** Already spent this month, demo rows excluded. */
  used: number;
  remaining: number;
  /** Requests in this sweep the free allowance would absorb. */
  covered: number;
  /** …and what's left over at the expected request count. */
  billable: number;
  /** What you would actually be charged, not the list price. */
  minChargeUsd: number;
  expectedChargeUsd: number;
};

export type Estimate = {
  cells: number;
  categories: number;
  maxDepth: number;
  /** One search per cell × category, before paging or subdivision. */
  searches: number;
  /** Of those, already swept inside the coverage window — skipped, and free. */
  coveredSearches: number;
  /** What the run would actually issue: `searches - coveredSearches`. */
  newSearches: number;
  /** Every search answered by a single page and nothing subdivided. */
  minRequests: number;
  /** What a typical run costs, allowing for extra pages and subdivision. */
  expectedRequests: number;
  /** List price, before the free allowance. */
  minCostUsd: number;
  expectedCostUsd: number;
  /** Default budget cap offered in the UI: room to run, but bounded. */
  suggestedMaxRequests: number;
  suggestedMaxCostUsd: number;
  /** Ceiling on how many businesses those requests can return, at 20 each. */
  minResults: number;
  expectedResults: number;
  suggestedMaxResults: number;
  freeTier: FreeTierEstimate;
};

/**
 * Roughly 40% of searches need a second or third page. These multipliers are
 * deliberately generous — an estimate that lands under the real spend is worse
 * than one that lands over it.
 */
const AVG_PAGES_PER_SEARCH = 1.6;

/**
 * Share of searches that come back full at Google's 60-result ceiling and so get
 * subdivided into four children. Loose, but it has to be non-zero: subdivision
 * is where a dense district's bill actually comes from.
 */
const SATURATION_RATE = 0.15;

/**
 * How much `maxDepth` multiplies the number of searches. Each level turns a
 * saturated search into four, so the series is 1 + 4s + (4s)² + … with s the
 * saturation rate. At the default depth of 1 that is 1.6×.
 */
export function subdivisionFactor(maxDepth: number): number {
  let factor = 1;
  let level = 1;

  for (let depth = 0; depth < maxDepth; depth++) {
    level *= 4 * SATURATION_RATE;
    factor += level;
  }

  return factor;
}

/**
 * Kept at three decimals: a handful of requests costs fractions of a cent, and
 * rounding those to two decimals turns $0.035 into $0.04.
 */
export function usd(requests: number): number {
  return Math.round(requests * COST_PER_REQUEST_USD * 1000) / 1000;
}

/** How many businesses `requests` calls can return, at 20 places per page. */
export function maxResultsFor(requests: number): number {
  return requests * RESULTS_PER_REQUEST;
}

/**
 * Where a sweep of this size lands against the month's free allowance. The list
 * price is what Google publishes; this is what you would be charged.
 */
export function freeTierSplit(
  usedThisMonth: number,
  minRequests: number,
  expectedRequests: number,
): FreeTierEstimate {
  const remaining = Math.max(0, FREE_REQUESTS_PER_MONTH - usedThisMonth);

  return {
    limit: FREE_REQUESTS_PER_MONTH,
    used: usedThisMonth,
    remaining,
    covered: Math.min(expectedRequests, remaining),
    billable: Math.max(0, expectedRequests - remaining),
    minChargeUsd: usd(Math.max(0, minRequests - remaining)),
    expectedChargeUsd: usd(Math.max(0, expectedRequests - remaining)),
  };
}

export function estimateJob(
  area: AreaSpec,
  categoryCount: number,
  cellRadius: number,
  maxDepth = 0,
  requestsUsedThisMonth = 0,
  coveredSearches = 0,
): Estimate {
  const cells = generateGrid(area, cellRadius).length;
  const categories = Math.max(1, categoryCount);
  const searches = cells * categories;

  // Searches the coverage cache will skip cost nothing, so they must come out
  // before anything is priced — otherwise a re-run quotes the first run's bill.
  const covered = Math.min(Math.max(0, coveredSearches), searches);
  const newSearches = searches - covered;

  const minRequests = newSearches;
  const expectedRequests = Math.ceil(
    newSearches * subdivisionFactor(maxDepth) * AVG_PAGES_PER_SEARCH,
  );
  // Headroom over the expectation so a normal run isn't truncated, but bounded.
  const suggestedMaxRequests = Math.ceil(expectedRequests * 1.5);

  return {
    cells,
    categories,
    maxDepth,
    searches,
    coveredSearches: covered,
    newSearches,
    minRequests,
    expectedRequests,
    minCostUsd: usd(minRequests),
    expectedCostUsd: usd(expectedRequests),
    suggestedMaxRequests,
    suggestedMaxCostUsd: usd(suggestedMaxRequests),
    minResults: maxResultsFor(minRequests),
    expectedResults: maxResultsFor(expectedRequests),
    suggestedMaxResults: maxResultsFor(suggestedMaxRequests),
    freeTier: freeTierSplit(requestsUsedThisMonth, minRequests, expectedRequests),
  };
}
