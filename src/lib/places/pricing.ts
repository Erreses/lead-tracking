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
