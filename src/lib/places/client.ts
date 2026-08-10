import { searchTextResponseSchema, type SearchTextResponse } from "./types";

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

/** Text Search Enterprise: $35.00 per 1,000 requests. */
export const COST_PER_REQUEST_USD = 0.035;

/** Google returns at most 20 places per page and 60 across all pages. */
export const MAX_PAGE_SIZE = 20;
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
    locationRestriction: {
      circle: {
        center: {
          latitude: params.circle.lat,
          longitude: params.circle.lng,
        },
        radius: params.circle.radius,
      },
    },
  };

  if (params.includedType) body.includedType = params.includedType;
  // Paging requires every other parameter to be identical to the first call.
  if (params.pageToken) body.pageToken = params.pageToken;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error("aborted");

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
        if (!error.retryable || attempt === maxRetries) throw error;
        lastError = error;
      } else {
        const json = await res.json();
        const parsed = searchTextResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new PlacesApiError(
            `Unexpected Places API response shape: ${parsed.error.message}`,
            200,
          );
        }
        return parsed.data;
      }
    } catch (error) {
      if (error instanceof PlacesApiError && !error.retryable) throw error;
      if (signal?.aborted) throw error;
      if (attempt === maxRetries) throw error;
      lastError = error;
    }

    // Exponential backoff with jitter: ~1s, 2s, 4s, 8s.
    const delay = 2 ** attempt * 1000 + Math.random() * 250;
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
  options: { signal?: AbortSignal; onRequest?: () => void } = {},
): Promise<{ places: SearchTextResponse["places"]; requests: number; saturated: boolean }> {
  const places: NonNullable<SearchTextResponse["places"]> = [];
  let pageToken: string | undefined;
  let requests = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
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

  return { places, requests, saturated };
}
