import { describe, expect, it } from "vitest";

import {
  COST_PER_REQUEST_USD,
  FREE_REQUESTS_PER_MONTH,
  RESULTS_PER_REQUEST,
} from "@/lib/places/pricing";
import { estimateJob, freeTierSplit, subdivisionFactor, usd } from "./cost";

const CENTRO = { lat: 40.4155, lng: -3.7074, radius: 1500 };

describe("pricing constants", () => {
  it("matches the published Text Search Enterprise SKU", () => {
    // $35.00 per 1,000 requests.
    expect(COST_PER_REQUEST_USD * 1000).toBeCloseTo(35, 10);
    expect(FREE_REQUESTS_PER_MONTH).toBe(1000);
    expect(RESULTS_PER_REQUEST).toBe(20);
  });

  it("prices requests at the SKU rate", () => {
    expect(usd(1000)).toBe(35);
    expect(usd(1)).toBe(0.035);
    expect(usd(0)).toBe(0);
  });

  it("keeps a single request off zero, which two decimals would not", () => {
    expect(usd(1)).toBeGreaterThan(0);
  });
});

describe("subdivisionFactor", () => {
  it("costs nothing when subdivision is off", () => {
    expect(subdivisionFactor(0)).toBe(1);
  });

  it("grows with each level, because every level is more searches", () => {
    const factors = [0, 1, 2, 3].map(subdivisionFactor);
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeGreaterThan(factors[i - 1]);
    }
  });

  it("converges rather than exploding — 4 children at a 15% saturation rate", () => {
    expect(subdivisionFactor(1)).toBeCloseTo(1.6, 10);
    expect(subdivisionFactor(10)).toBeLessThan(2.5);
  });
});

describe("estimateJob", () => {
  it("floors at one request per cell × category", () => {
    const estimate = estimateJob(CENTRO, 3, 500);
    expect(estimate.cells).toBe(25);
    expect(estimate.categories).toBe(3);
    expect(estimate.searches).toBe(75);
    expect(estimate.minRequests).toBe(75);
    expect(estimate.minCostUsd).toBe(usd(75));
  });

  it("never estimates below the floor", () => {
    for (const depth of [0, 1, 2, 3]) {
      const estimate = estimateJob(CENTRO, 3, 500, depth);
      expect(estimate.expectedRequests).toBeGreaterThanOrEqual(estimate.minRequests);
      expect(estimate.suggestedMaxRequests).toBeGreaterThanOrEqual(
        estimate.expectedRequests,
      );
    }
  });

  it("charges for subdivision — depth used to be free in the estimate", () => {
    const off = estimateJob(CENTRO, 3, 500, 0);
    const deep = estimateJob(CENTRO, 3, 500, 3);
    expect(deep.expectedRequests).toBeGreaterThan(off.expectedRequests);
    expect(deep.expectedCostUsd).toBeGreaterThan(off.expectedCostUsd);
  });

  it("scales linearly with categories", () => {
    const one = estimateJob(CENTRO, 1, 500, 1);
    const four = estimateJob(CENTRO, 4, 500, 1);
    expect(four.minRequests).toBe(one.minRequests * 4);
  });

  it("costs more with smaller cells", () => {
    const coarse = estimateJob(CENTRO, 3, 1000, 1);
    const fine = estimateJob(CENTRO, 3, 500, 1);
    expect(fine.expectedCostUsd).toBeGreaterThan(coarse.expectedCostUsd);
  });

  it("reports how many businesses the requests can reach", () => {
    const estimate = estimateJob(CENTRO, 3, 500, 1);
    expect(estimate.minResults).toBe(estimate.minRequests * RESULTS_PER_REQUEST);
    expect(estimate.expectedResults).toBe(
      estimate.expectedRequests * RESULTS_PER_REQUEST,
    );
    expect(estimate.suggestedMaxResults).toBe(
      estimate.suggestedMaxRequests * RESULTS_PER_REQUEST,
    );
  });

  it("prices only the searches the coverage cache will not skip", () => {
    const fresh = estimateJob(CENTRO, 3, 500, 1, 0, 0);
    const half = estimateJob(CENTRO, 3, 500, 1, 0, 40);

    expect(half.searches).toBe(fresh.searches);
    expect(half.coveredSearches).toBe(40);
    expect(half.newSearches).toBe(35);
    expect(half.minRequests).toBe(35);
    expect(half.expectedRequests).toBeLessThan(fresh.expectedRequests);
    expect(half.expectedCostUsd).toBeLessThan(fresh.expectedCostUsd);
  });

  it("quotes zero when a recent run covered the whole area", () => {
    const estimate = estimateJob(CENTRO, 3, 500, 1, 0, 75);
    expect(estimate.newSearches).toBe(0);
    expect(estimate.minRequests).toBe(0);
    expect(estimate.expectedRequests).toBe(0);
    expect(estimate.expectedCostUsd).toBe(0);
    expect(estimate.expectedResults).toBe(0);
  });

  it("clamps nonsense coverage counts instead of going negative", () => {
    for (const covered of [-10, 99_999]) {
      const estimate = estimateJob(CENTRO, 3, 500, 1, 0, covered);
      expect(estimate.coveredSearches).toBeGreaterThanOrEqual(0);
      expect(estimate.coveredSearches).toBeLessThanOrEqual(estimate.searches);
      expect(estimate.newSearches).toBeGreaterThanOrEqual(0);
      expect(estimate.minRequests).toBeGreaterThanOrEqual(0);
    }
  });

  it("costs nothing on a fresh month if it fits in the free allowance", () => {
    const estimate = estimateJob(CENTRO, 3, 500, 1, 0);
    expect(estimate.expectedRequests).toBeLessThan(FREE_REQUESTS_PER_MONTH);
    expect(estimate.freeTier.expectedChargeUsd).toBe(0);
    // …while the list price is still shown, and is not zero.
    expect(estimate.expectedCostUsd).toBeGreaterThan(0);
  });
});

describe("freeTierSplit", () => {
  it("absorbs a whole sweep when the month is untouched", () => {
    const split = freeTierSplit(0, 100, 200);
    expect(split.remaining).toBe(1000);
    expect(split.covered).toBe(200);
    expect(split.billable).toBe(0);
    expect(split.minChargeUsd).toBe(0);
    expect(split.expectedChargeUsd).toBe(0);
  });

  it("charges only the overflow when the sweep straddles the limit", () => {
    const split = freeTierSplit(900, 50, 300);
    expect(split.remaining).toBe(100);
    expect(split.covered).toBe(100);
    expect(split.billable).toBe(200);
    // 50 requests still fit under the remaining 100, so the floor is free.
    expect(split.minChargeUsd).toBe(0);
    expect(split.expectedChargeUsd).toBe(usd(200));
  });

  it("charges in full once the allowance is gone", () => {
    const split = freeTierSplit(1000, 100, 200);
    expect(split.remaining).toBe(0);
    expect(split.covered).toBe(0);
    expect(split.billable).toBe(200);
    expect(split.expectedChargeUsd).toBe(usd(200));
  });

  it("does not go negative when the month is already over the limit", () => {
    const split = freeTierSplit(5000, 100, 200);
    expect(split.remaining).toBe(0);
    expect(split.billable).toBe(200);
    expect(split.expectedChargeUsd).toBeGreaterThan(0);
  });

  it("never quotes more than the list price", () => {
    for (const used of [0, 500, 999, 1000, 2000]) {
      const split = freeTierSplit(used, 100, 200);
      expect(split.expectedChargeUsd).toBeLessThanOrEqual(usd(200));
    }
  });
});
