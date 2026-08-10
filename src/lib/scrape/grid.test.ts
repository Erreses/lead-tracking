import { describe, expect, it } from "vitest";

import { estimateJob } from "./cost";
import {
  cellCovers,
  generateGrid,
  haversine,
  metersToLatDegrees,
  metersToLngDegrees,
  subdivide,
  type AreaSpec,
} from "./grid";

const MADRID: AreaSpec = { lat: 40.4168, lng: -3.7038, radius: 8000 };

/** Deterministic pseudo-random sampler so coverage tests don't flake. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Uniformly distributed points inside a disc. */
function samplePoints(area: AreaSpec, count: number, seed = 42) {
  const random = makeRandom(seed);
  const points: { lat: number; lng: number }[] = [];

  for (let i = 0; i < count; i++) {
    const angle = random() * 2 * Math.PI;
    // sqrt keeps the distribution even across the disc rather than clustering
    // everything near the centre.
    const distance = Math.sqrt(random()) * area.radius;
    const dLat = metersToLatDegrees(distance * Math.sin(angle));
    const lat = area.lat + dLat;
    const dLng = metersToLngDegrees(distance * Math.cos(angle), lat);
    points.push({ lat, lng: area.lng + dLng });
  }

  return points;
}

describe("distance helpers", () => {
  it("measures a known distance", () => {
    // Madrid centre to Barcelona centre is roughly 505 km.
    const distance = haversine({ lat: 40.4168, lng: -3.7038 }, { lat: 41.3874, lng: 2.1686 });
    expect(distance).toBeGreaterThan(495_000);
    expect(distance).toBeLessThan(515_000);
  });

  it("returns zero for the same point", () => {
    expect(haversine(MADRID, MADRID)).toBe(0);
  });

  it("needs more longitude degrees than latitude degrees away from the equator", () => {
    expect(metersToLngDegrees(1000, 40.4)).toBeGreaterThan(metersToLatDegrees(1000));
  });
});

describe("generateGrid", () => {
  it("returns a single cell when one already covers the area", () => {
    const cells = generateGrid({ lat: 40.4, lng: -3.7, radius: 500 }, 800);
    expect(cells).toHaveLength(1);
    expect(cells[0].radius).toBe(500);
  });

  it("produces more cells as the cell radius shrinks", () => {
    const coarse = generateGrid(MADRID, 2000).length;
    const fine = generateGrid(MADRID, 1000).length;
    expect(fine).toBeGreaterThan(coarse);
  });

  it("extends past the boundary only as far as one cell radius", () => {
    const cellRadius = 1000;
    for (const cell of generateGrid(MADRID, cellRadius)) {
      expect(haversine(MADRID, cell)).toBeLessThanOrEqual(MADRID.radius + cellRadius + 1);
    }
  });

  it("leaves no gaps: every point in the area falls inside some cell", () => {
    const cells = generateGrid(MADRID, 1500);
    const uncovered = samplePoints(MADRID, 20_000).filter(
      (point) => !cells.some((cell) => cellCovers(cell, point)),
    );
    expect(uncovered).toHaveLength(0);
  });

  it("leaves no gaps at a fine cell size either", () => {
    const area: AreaSpec = { lat: 40.4155, lng: -3.7074, radius: 1500 };
    const cells = generateGrid(area, 400);
    const uncovered = samplePoints(area, 20_000, 7).filter(
      (point) => !cells.some((cell) => cellCovers(cell, point)),
    );
    expect(uncovered).toHaveLength(0);
  });

  it("covers the edge of the area, not just the middle", () => {
    // Points in the outermost 5% of the disc, where a naive lattice leaves gaps.
    const cells = generateGrid(MADRID, 1200);
    const random = makeRandom(99);
    const edgePoints = Array.from({ length: 5000 }, () => {
      const angle = random() * 2 * Math.PI;
      const distance = MADRID.radius * (0.95 + random() * 0.05);
      const lat = MADRID.lat + metersToLatDegrees(distance * Math.sin(angle));
      return { lat, lng: MADRID.lng + metersToLngDegrees(distance * Math.cos(angle), lat) };
    });

    const uncovered = edgePoints.filter(
      (point) => !cells.some((cell) => cellCovers(cell, point)),
    );
    expect(uncovered).toHaveLength(0);
  });

  it("marks the initial lattice as depth 0", () => {
    expect(generateGrid(MADRID, 2000).every((cell) => cell.depth === 0)).toBe(true);
  });

  it("rejects nonsensical inputs", () => {
    expect(() => generateGrid(MADRID, 0)).toThrow();
    expect(() => generateGrid(MADRID, -100)).toThrow();
    expect(() => generateGrid({ ...MADRID, radius: 0 }, 500)).toThrow();
  });
});

describe("subdivide", () => {
  const parent = { lat: 40.4168, lng: -3.7038, radius: 1600, depth: 0 };

  it("splits into four smaller children one level deeper", () => {
    const children = subdivide(parent);
    expect(children).toHaveLength(4);
    for (const child of children) {
      expect(child.depth).toBe(1);
      expect(child.radius).toBeLessThan(parent.radius);
    }
  });

  it("still covers the whole parent cell", () => {
    const children = subdivide(parent);
    const uncovered = samplePoints(parent, 3000, 11).filter(
      (point) => !children.some((child) => cellCovers(child, point)),
    );
    expect(uncovered).toHaveLength(0);
  });

  it("terminates: repeated subdivision shrinks toward zero", () => {
    let cell = parent;
    for (let i = 0; i < 8; i++) cell = subdivide(cell)[0];
    expect(cell.radius).toBeLessThan(parent.radius / 10);
    expect(cell.depth).toBe(8);
  });
});

describe("estimateJob", () => {
  it("scales with both cell count and category count", () => {
    const one = estimateJob(MADRID, 1, 2000);
    const three = estimateJob(MADRID, 3, 2000);
    expect(three.minRequests).toBe(one.minRequests * 3);
    expect(three.expectedCostUsd).toBeGreaterThan(one.expectedCostUsd);
  });

  it("orders its estimates from cheapest to safest", () => {
    const estimate = estimateJob(MADRID, 5, 1500);
    expect(estimate.minRequests).toBeLessThanOrEqual(estimate.expectedRequests);
    expect(estimate.expectedRequests).toBeLessThanOrEqual(estimate.suggestedMaxRequests);
  });

  it("prices requests at the Text Search Enterprise rate", () => {
    // 1,000 requests at $35 per 1,000.
    const estimate = estimateJob({ lat: 40.4, lng: -3.7, radius: 100 }, 1, 1000);
    expect(estimate.minRequests).toBe(1);
    expect(estimate.minCostUsd).toBeCloseTo(0.035, 3);
  });

  it("treats a zero category count as one", () => {
    expect(estimateJob(MADRID, 0, 2000).categories).toBe(1);
  });
});
