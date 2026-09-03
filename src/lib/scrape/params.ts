import { z } from "zod";

import { getArea } from "@/config/areas";
import { getCategory } from "@/config/categories";

/**
 * Shape of a scrape request from the dashboard. Either a preset area slug or a
 * custom centre point, plus the categories to sweep.
 */
export const jobRequestSchema = z
  .object({
    areaSlug: z.string().optional(),
    custom: z
      .object({
        label: z.string().min(1).max(120),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radius: z.number().min(100).max(50_000),
      })
      .optional(),
    categories: z.array(z.string()).min(1, "Pick at least one category"),
    cellRadius: z.number().min(100).max(25_000),
    maxDepth: z.number().int().min(0).max(3).default(1),
    /** Hard ceiling on Places requests, so a job can never run away with the bill. */
    maxRequests: z.number().int().min(1).max(50_000).default(500),
    /** Ignore the coverage cache and re-search everything, at full price. */
    force: z.boolean().default(false),
  })
  .refine((value) => value.areaSlug || value.custom, {
    message: "Choose an area or provide custom coordinates",
  });

export type JobRequest = z.infer<typeof jobRequestSchema>;

export type ResolvedJob = {
  areaSlug: string;
  areaLabel: string;
  lat: number;
  lng: number;
  radius: number;
  categories: string[];
  cellRadius: number;
  maxDepth: number;
  maxRequests: number;
  force: boolean;
};

/**
 * Turn a validated request into concrete coordinates and known category slugs.
 * Returns an error string rather than throwing so routes can answer with a 400.
 */
export function resolveJob(
  request: JobRequest,
): { ok: true; job: ResolvedJob } | { ok: false; error: string } {
  let areaSlug: string;
  let areaLabel: string;
  let lat: number;
  let lng: number;
  let radius: number;

  if (request.custom) {
    areaSlug = "custom";
    areaLabel = request.custom.label;
    lat = request.custom.lat;
    lng = request.custom.lng;
    radius = request.custom.radius;
  } else {
    const area = getArea(request.areaSlug!);
    if (!area) return { ok: false, error: `Unknown area "${request.areaSlug}"` };
    areaSlug = area.slug;
    areaLabel = area.label;
    lat = area.lat;
    lng = area.lng;
    radius = area.radius;
  }

  const categories = request.categories.filter((slug) => getCategory(slug));
  if (categories.length === 0) {
    return { ok: false, error: "None of the selected categories are recognised" };
  }

  return {
    ok: true,
    job: {
      areaSlug,
      areaLabel,
      lat,
      lng,
      radius,
      categories,
      cellRadius: Math.min(request.cellRadius, radius),
      maxDepth: request.maxDepth,
      maxRequests: request.maxRequests,
      force: request.force,
    },
  };
}

/**
 * Cell sizes offered in the UI, coarsest first. Shared so the post-run
 * recommendations can suggest "the next size down" and mean the same thing the
 * dropdown does.
 */
export const CELL_SIZES = [
  { value: 2000, label: "2 km — cheapest sweep" },
  { value: 1500, label: "1.5 km — balanced" },
  { value: 1000, label: "1 km — thorough" },
  { value: 800, label: "800 m — dense areas" },
  { value: 500, label: "500 m — very dense" },
] as const;

/** The next finer cell size, or null if already at the finest. */
export function finerCellRadius(current: number): number | null {
  const finer = CELL_SIZES.map((size) => size.value)
    .filter((value) => value < current)
    .sort((a, b) => b - a);
  return finer[0] ?? null;
}

/** The next coarser cell size, or null if already at the coarsest. */
export function coarserCellRadius(current: number): number | null {
  const coarser = CELL_SIZES.map((size) => size.value)
    .filter((value) => value > current)
    .sort((a, b) => a - b);
  return coarser[0] ?? null;
}

/** Sensible starting cell size for an area, used to prefill the form. */
export function defaultCellRadius(areaRadius: number): number {
  if (areaRadius >= 5000) return 1500;
  if (areaRadius >= 2000) return 800;
  return 500;
}
