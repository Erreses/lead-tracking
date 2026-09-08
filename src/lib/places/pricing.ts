/**
 * The three numbers the whole cost model rests on, kept apart from the API
 * client so the dashboard can import them without pulling the fetch code into
 * the browser bundle. `@/lib/places/client` re-exports them.
 *
 * Source: Google Maps Platform pricing, Places API (New) — Text Search
 * Enterprise SKU. Requesting `websiteUri` puts every call in that tier.
 */

/** Text Search Enterprise: $35.00 per 1,000 requests. */
export const COST_PER_REQUEST_USD = 0.035;

/**
 * The Enterprise SKU includes 1,000 requests per calendar month at no charge.
 * Only what goes past this is billed, so it belongs in every price we quote.
 */
export const FREE_REQUESTS_PER_MONTH = 1000;

/**
 * Places returned per request. This is what turns a request count into a
 * business count: N requests can surface at most N × 20 businesses.
 */
export const RESULTS_PER_REQUEST = 20;

/**
 * Place Details, billed separately from search and only used when building a
 * demo site for one business.
 *
 * Asking for `reviews` and `editorialSummary` puts the call in the
 * **Enterprise + Atmosphere** tier — the most expensive one. That is deliberate:
 * a review in the owner's own customers' words is the single most persuasive
 * thing on a demo page, and one call per business you are about to pitch is
 * noise next to the price of the website you are selling.
 *
 * Enterprise + Atmosphere: $25.00 per 1,000.
 */
export const COST_PER_DETAILS_REQUEST_USD = 0.025;

/** Place Photos: $7.00 per 1,000 images fetched. */
export const COST_PER_PHOTO_USD = 0.007;

/**
 * Photos pulled per business. Enough for a hero image and a small gallery;
 * past this the page gets slower without getting more convincing.
 */
export const PHOTOS_PER_SITE = 6;

/** What one generated site costs in API calls, before any Claude tokens. */
export function siteBuildCostUsd(photos: number = PHOTOS_PER_SITE): number {
  return (
    Math.round(
      (COST_PER_DETAILS_REQUEST_USD + photos * COST_PER_PHOTO_USD) * 10_000,
    ) / 10_000
  );
}
