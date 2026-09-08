import "server-only";

import { logger } from "@/lib/log";
import { PlacesApiError, getApiKey } from "./client";
import { PHOTOS_PER_SITE } from "./pricing";

const log = logger("places.details");

/**
 * Everything Google knows about one place, plus its photos.
 *
 * Separate from the search client because it answers a different question and
 * is billed on a different meter. Search finds businesses cheaply and in bulk;
 * this is the expensive, one-at-a-time call you make once you have decided to
 * build somebody a website.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places";

/**
 * The fields worth paying for.
 *
 * Billing follows the most expensive field in the mask, not the count, so
 * within a tier there is no reason to be frugal — asking for less would cost
 * exactly the same and give the site less to work with. `reviews` and
 * `editorialSummary` are what put this in Enterprise + Atmosphere; everything
 * else here is included once you have crossed that line.
 */
const FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "shortFormattedAddress",
  "addressComponents",
  "location",
  "googleMapsUri",
  "websiteUri",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "businessStatus",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "regularOpeningHours",
  "utcOffsetMinutes",
  "rating",
  "userRatingCount",
  "reviews",
  "priceLevel",
  "editorialSummary",
  "photos",
  "accessibilityOptions",
  "parkingOptions",
  "paymentOptions",
  "outdoorSeating",
  "servesVegetarianFood",
  "delivery",
  "dineIn",
  "takeout",
  "reservable",
  "goodForChildren",
  "allowsDogs",
].join(",");

export type PlaceReview = {
  text?: { text?: string; languageCode?: string };
  originalText?: { text?: string };
  rating?: number;
  relativePublishTimeDescription?: string;
  publishTime?: string;
  authorAttribution?: { displayName?: string; photoUri?: string; uri?: string };
};

export type PlacePhotoRef = {
  name: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: { displayName?: string; uri?: string }[];
};

export type PlaceDetails = {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  businessStatus?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
    periods?: unknown[];
  };
  rating?: number;
  userRatingCount?: number;
  reviews?: PlaceReview[];
  priceLevel?: string;
  editorialSummary?: { text?: string };
  photos?: PlacePhotoRef[];
  [key: string]: unknown;
};

/**
 * One Place Details call. No retry loop: unlike a sweep, this is a single
 * interactive request a person is waiting on, and a failure is better surfaced
 * immediately than hidden behind a backoff.
 */
export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const key = getApiKey();
  // Place IDs come back from Google, but this one has been round-tripped
  // through our database, so encode rather than trust it to be path-safe.
  const url = `${ENDPOINT}/${encodeURIComponent(placeId)}`;

  const response = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
      // Spanish businesses, Spanish reviews — asking for anything else gets
      // opening hours and summaries machine-translated into worse English.
      "Accept-Language": "es",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = `Place Details failed with ${response.status}`;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body);
      message = parsed?.error?.message ?? message;
      code = parsed?.error?.status;
    } catch {
      // Non-JSON error body; the status alone will have to do.
    }
    log.error("details.failed", { placeId, status: response.status, code });
    throw new PlacesApiError(message, response.status, code);
  }

  const details = (await response.json()) as PlaceDetails;
  log.info("details.fetched", {
    placeId,
    name: details.displayName?.text,
    reviews: details.reviews?.length ?? 0,
    photos: details.photos?.length ?? 0,
  });

  return details;
}

export type FetchedPhoto = {
  /** Filename to write beside the generated page, e.g. `photo-1.jpg`. */
  file: string;
  bytes: Buffer;
  contentType: string;
  /** Google requires these to be shown wherever the photo is. */
  attributions: string[];
};

/**
 * Download the first few photos for a place.
 *
 * Each one is a separate billed request, so the count is capped rather than
 * left to however many Google happens to have. Failures are skipped, not
 * thrown: a demo page with four photos instead of six is fine, and losing the
 * whole build because one image 404s is not.
 */
export async function fetchPlacePhotos(
  photos: PlacePhotoRef[] | undefined,
  limit = PHOTOS_PER_SITE,
): Promise<FetchedPhoto[]> {
  if (!photos?.length) return [];

  const key = getApiKey();
  const wanted = photos.slice(0, limit);
  const out: FetchedPhoto[] = [];

  for (const [index, photo] of wanted.entries()) {
    // 1600px wide is enough for a full-bleed hero on a retina laptop without
    // making the page heavy.
    const url =
      `https://places.googleapis.com/v1/${photo.name}/media` +
      `?maxWidthPx=1600&key=${encodeURIComponent(key)}`;

    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) {
        log.warn("photo.failed", { index, status: response.status });
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "image/jpeg";
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        log.warn("photo.empty", { index });
        continue;
      }

      out.push({
        file: `photo-${index + 1}.${extensionFor(contentType)}`,
        bytes,
        contentType,
        attributions:
          photo.authorAttributions
            ?.map((a) => a.displayName ?? "")
            .filter(Boolean) ?? [],
      });
    } catch (error) {
      // Only `error` takes a third argument; a skipped photo is a warning.
      log.warn("photo.error", {
        index,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  log.info("photos.fetched", { requested: wanted.length, got: out.length });
  return out;
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}
