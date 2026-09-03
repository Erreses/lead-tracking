/**
 * Area tiling for the scraper.
 *
 * Google's Text Search returns at most 60 results per query, so "every
 * restaurant in Madrid" cannot be one call. The area is covered with a lattice
 * of circular cells and each cell is queried separately; cells that come back
 * full are subdivided so dense neighbourhoods get drilled into while empty ones
 * cost a single request.
 */

const METERS_PER_DEGREE_LAT = 111_320;

export type Cell = {
  lat: number;
  lng: number;
  /** Radius in metres. */
  radius: number;
  /** 0 for the initial lattice, +1 for each subdivision. */
  depth: number;
};

export type AreaSpec = {
  lat: number;
  lng: number;
  radius: number;
};

export function metersToLatDegrees(meters: number): number {
  return meters / METERS_PER_DEGREE_LAT;
}

export function metersToLngDegrees(meters: number, atLat: number): number {
  const scale = Math.cos((atLat * Math.PI) / 180);
  // Guard against the degenerate case at the poles.
  return meters / (METERS_PER_DEGREE_LAT * Math.max(scale, 1e-6));
}

/** Great-circle distance in metres. */
export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Shrinks the lattice slightly below the theoretical maximum spacing. The
 * lattice is only square in a local flat projection, so this absorbs the
 * lat/lng approximation and keeps the overlap guarantee intact.
 */
const SPACING_SAFETY = 0.97;

/**
 * Cover `area` with circular cells of `cellRadius`.
 *
 * Cell centres sit on a square lattice spaced just under `cellRadius * √2` —
 * the widest spacing at which the circles still overlap enough to leave no gaps
 * between them, since the furthest a point can sit from its nearest lattice
 * point is the half-diagonal, `spacing / √2`.
 */
export function generateGrid(area: AreaSpec, cellRadius: number): Cell[] {
  if (cellRadius <= 0) throw new Error("cellRadius must be positive");
  if (area.radius <= 0) throw new Error("area radius must be positive");

  // A single cell already covers the area — no point tiling it.
  if (cellRadius >= area.radius) {
    return [{ lat: area.lat, lng: area.lng, radius: area.radius, depth: 0 }];
  }

  const spacing = cellRadius * Math.SQRT2 * SPACING_SAFETY;
  // A point on the area's edge is covered by a lattice point up to `cellRadius`
  // beyond it, so the lattice has to extend that far past the boundary or the
  // outer ring of the area ends up with gaps.
  const limit = area.radius + cellRadius;
  const steps = Math.ceil(limit / spacing);
  const dLat = metersToLatDegrees(spacing);

  const cells: Cell[] = [];
  for (let i = -steps; i <= steps; i++) {
    const lat = area.lat + i * dLat;
    // Longitude degrees shrink as you move away from the equator, so recompute
    // the step for each row rather than reusing the centre's.
    const dLng = metersToLngDegrees(spacing, lat);

    for (let j = -steps; j <= steps; j++) {
      const lng = area.lng + j * dLng;
      if (haversine({ lat: area.lat, lng: area.lng }, { lat, lng }) > limit) {
        continue;
      }
      cells.push({ lat, lng, radius: cellRadius, depth: 0 });
    }
  }

  // Tiny areas can fall between lattice points; always return something.
  if (cells.length === 0) {
    return [{ lat: area.lat, lng: area.lng, radius: area.radius, depth: 0 }];
  }

  return cells;
}

/**
 * Split a saturated cell into four children that together still cover it.
 *
 * Children sit at ±r/2 on each axis with radius r/√2, which is the smallest
 * radius that leaves no uncovered point in the parent disc.
 */
export function subdivide(cell: Cell): Cell[] {
  const childRadius = cell.radius / Math.SQRT2;
  const offset = cell.radius / 2;
  const dLat = metersToLatDegrees(offset);
  const dLng = metersToLngDegrees(offset, cell.lat);

  return [
    { lat: cell.lat + dLat, lng: cell.lng + dLng, radius: childRadius, depth: cell.depth + 1 },
    { lat: cell.lat + dLat, lng: cell.lng - dLng, radius: childRadius, depth: cell.depth + 1 },
    { lat: cell.lat - dLat, lng: cell.lng + dLng, radius: childRadius, depth: cell.depth + 1 },
    { lat: cell.lat - dLat, lng: cell.lng - dLng, radius: childRadius, depth: cell.depth + 1 },
  ];
}

export type LatLngRectangle = {
  low: { latitude: number; longitude: number };
  high: { latitude: number; longitude: number };
};

const clampLat = (value: number) => Math.min(90, Math.max(-90, value));
/** Wrap into [-180, 180]; a cell near the antimeridian must not send ±181. */
const wrapLng = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;

/**
 * The smallest lat/lng rectangle containing a circular cell.
 *
 * Text Search accepts only a rectangle for `locationRestriction` — passing a
 * circle is rejected with a 400, which is why every request this scraper ever
 * sent failed. The *bounding* box is used rather than an inscribed square
 * because it contains the circle: everything the lattice proves about circular
 * coverage stays true of what is actually queried. The price is a little more
 * overlap (4/π ≈ 1.27× the area per cell), never a gap.
 */
export function circleToRectangle(
  cell: Pick<Cell, "lat" | "lng" | "radius">,
): LatLngRectangle {
  const dLat = metersToLatDegrees(cell.radius);
  const dLng = metersToLngDegrees(cell.radius, cell.lat);

  return {
    low: {
      latitude: clampLat(cell.lat - dLat),
      longitude: wrapLng(cell.lng - dLng),
    },
    high: {
      latitude: clampLat(cell.lat + dLat),
      longitude: wrapLng(cell.lng + dLng),
    },
  };
}

/** Is `point` inside `cell`? Used by the coverage tests. */
export function cellCovers(cell: Cell, point: { lat: number; lng: number }): boolean {
  return haversine(cell, point) <= cell.radius;
}
