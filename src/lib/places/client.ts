import { logger } from "@/lib/log";
import { circleToRectangle } from "@/lib/scrape/grid";
import { COST_PER_REQUEST_USD, RESULTS_PER_REQUEST } from "./pricing";
import { searchTextResponseSchema, type SearchTextResponse } from "./types";

const log = logger("places");

/**
 * Running count of billable requests this process has made, so every log line
 * carries the spend so far. Cheaper to read than summing the database, and it
 * survives a job that dies before it can write its final row.
 */
let billedRequests = 0;

export function billedThisProcess(): { requests: number; costUsd: number } {
  return {
    requests: billedRequests,
    costUsd: Math.round(billedRequests * COST_PER_REQUEST_USD * 1000) / 1000,
  };
}

export {
  COST_PER_REQUEST_USD,
  FREE_REQUESTS_PER_MONTH,
  RESULTS_PER_REQUEST,
} from "./pricing";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/**
 * Requesting `websiteUri`, `rating` or `userRatingCount` puts the call in the
 * Text Search **Enterprise** SKU. We need `websiteUri`, so every call is billed
 * at that tier and there is nothing to save by trimming the rest.
 */
export const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.businessStatus",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "nextPageToken",
].join(",");

/** Google returns at most 20 places per page and 60 across all pages. */
export const MAX_PAGE_SIZE = RESULTS_PER_REQUEST;
export const MAX_PAGES = 3;
export const MAX_RESULTS_PER_QUERY = MAX_PAGE_SIZE * MAX_PAGES;

export class PlacesApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "PlacesApiError";
    this.status = status;
    this.code = code;
    this.retryable = status === 429 || status >= 500;
  }

  /**
   * Google rejects an unknown `includedType` with a 400. The caller retries the
   * same query without the type filter rather than failing the whole job.
   */
  get isInvalidArgument(): boolean {
    return this.status === 400;
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "GOOGLE_MAPS_API_KEY is not set. Add it to .env.local — see the README for how to create one.",
    );
    this.name = "MissingApiKeyError";
  }
}

export function getApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new MissingApiKeyError();
  return key;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
}

export type SearchTextParams = {
  textQuery: string;
  includedType?: string;
  circle: { lat: number; lng: number; radius: number };
  pageToken?: string;
  languageCode?: string;
  regionCode?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One `places:searchText` call. Retries throttling and server errors with
 * exponential backoff; everything else throws immediately so the caller can
 * decide (e.g. drop a bad `includedType` and try again).
 */
export async function searchText(
  params: SearchTextParams,
  options: { maxRetries?: number; signal?: AbortSignal } = {},
): Promise<SearchTextResponse> {
  const { maxRetries = 4, signal } = options;
  const apiKey = getApiKey();

  const body: Record<string, unknown> = {
    textQuery: params.textQuery,
    pageSize: MAX_PAGE_SIZE,
    languageCode: params.languageCode ?? "es",
    regionCode: params.regionCode ?? "ES",
    // Text Search restricts by rectangle only — `locationRestriction.circle` is
    // a 400. The cell stays circular everywhere else; it becomes its bounding
    // box here, at the API boundary. See `circleToRectangle`.
    locationRestriction: {
      rectangle: circleToRectangle({
        lat: params.circle.lat,
        lng: params.circle.lng,
        radius: params.circle.radius,
      }),
    },
  };

  if (params.includedType) body.includedType = params.includedType;
  // Paging requires every other parameter to be identical to the first call.
  if (params.pageToken) body.pageToken = params.pageToken;

  let lastError: unknown;

  // Enough to locate the exact call in a log without dumping the whole body.
  const where = {
    query: params.textQuery,
    includedType: params.includedType,
    lat: Number(params.circle.lat.toFixed(5)),
    lng: Number(params.circle.lng.toFixed(5)),
    radius: Math.round(params.circle.radius),
    paged: Boolean(params.pageToken),
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error("aborted");

    const startedAt = Date.now();
    // Counted before the call, not after: a request that times out or throws
    // was still issued, and Google still bills for it.
    billedRequests++;

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const text = await res.text();
        let message = text;
        let code: string | undefined;
        try {
          const parsed = JSON.parse(text);
          message = parsed?.error?.message ?? text;
          code = parsed?.error?.status;
        } catch {
          // Non-JSON error body; the raw text is the best message we have.
        }

        const error = new PlacesApiError(message, res.status, code);
        const spend = billedThisProcess();

        // Every non-2xx is money spent for nothing, so it is always logged —
        // with the status and Google's own code, which is what tells you
        // whether it's billing, an unenabled API, or a bad key restriction.
        log.error(
          "request.failed",
          {
            ...where,
            attempt,
            status: res.status,
            code,
            retryable: error.retryable,
            willRetry: error.retryable && attempt < maxRetries,
            ms: Date.now() - startedAt,
            ...spend,
          },
          error,
        );

        if (!error.retryable || attempt === maxRetries) throw error;
        lastError = error;
      } else {
        const json = await res.json();
        const parsed = searchTextResponseSchema.safeParse(json);
        if (!parsed.success) {
          // A shape we don't recognise means the field mask or the API version
          // moved under us — expensive to discover mid-scrape, so log loudly.
          const error = new PlacesApiError(
            `Unexpected Places API response shape: ${parsed.error.message}`,
            200,
          );
          log.error("response.unexpected_shape", { ...where, attempt }, error);
          throw error;
        }

        log.debug("request.ok", {
          ...where,
          attempt,
          places: parsed.data.places?.length ?? 0,
          morePages: Boolean(parsed.data.nextPageToken),
          ms: Date.now() - startedAt,
          ...billedThisProcess(),
        });

        return parsed.data;
      }
    } catch (error) {
      if (error instanceof PlacesApiError && !error.retryable) throw error;
      if (signal?.aborted) throw error;

      // Network-level failure: fetch threw rather than returning a response.
      if (!(error instanceof PlacesApiError)) {
        log.error(
          "request.threw",
          {
            ...where,
            attempt,
            willRetry: attempt < maxRetries,
            ms: Date.now() - startedAt,
            ...billedThisProcess(),
          },
          error,
        );
      }

      if (attempt === maxRetries) throw error;
      lastError = error;
    }

    // Exponential backoff with jitter: ~1s, 2s, 4s, 8s.
    const delay = 2 ** attempt * 1000 + Math.random() * 250;
    log.warn("request.backoff", { ...where, attempt, delayMs: Math.round(delay) });
    await sleep(delay);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Places API request failed");
}

/**
 * Walk all pages for one cell+category, up to Google's 60-result ceiling.
 *
 * `saturated` means the last page was still full at the cap — there were almost
 * certainly more businesses than we were allowed to see, which is the signal the
 * runner uses to decide whether to subdivide the cell.
 */
export async function searchTextAllPages(
  params: SearchTextParams,
  options: {
    signal?: AbortSignal;
    onRequest?: () => void;
    /**
     * Checked before every page. Paging is where a job can quietly overshoot its
     * request budget, so the caller gets to stop between pages rather than only
     * between cells.
     */
    shouldContinue?: () => boolean;
  } = {},
): Promise<{
  places: SearchTextResponse["places"];
  requests: number;
  saturated: boolean;
  /** Cut short by `shouldContinue`, so these results are incomplete. */
  stopped: boolean;
}> {
  const places: NonNullable<SearchTextResponse["places"]> = [];
  let pageToken: string | undefined;
  let requests = 0;
  let stopped = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (options.shouldContinue && !options.shouldContinue()) {
      stopped = true;
      break;
    }
    options.onRequest?.();
    const response = await searchText({ ...params, pageToken }, { signal: options.signal });
    requests++;

    if (response.places?.length) places.push(...response.places);

    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }

  // Google stopped handing out pages but we hit the ceiling, or it still had
  // more to give and we ran out of allowed pages.
  const saturated = places.length >= MAX_RESULTS_PER_QUERY || Boolean(pageToken);

  log.debug("search.done", {
    query: params.textQuery,
    includedType: params.includedType,
    radius: Math.round(params.circle.radius),
    requests,
    places: places.length,
    saturated,
    stopped,
  });

  return { places, requests, saturated, stopped };
}
