import { afterEach, describe, expect, it, vi } from "vitest";

import { circleToRectangle } from "@/lib/scrape/grid";
import { FIELD_MASK, MAX_PAGE_SIZE, searchText } from "./client";

/**
 * These assert on the *outgoing request*, which the runner's integration tests
 * never did — they stubbed fetch and checked only what came back. That gap let
 * a request body Google rejects outright ship as "tested": every scrape failed
 * on its first call with `Unknown name "circle" at 'location_restriction'`.
 */

const CIRCLE = { lat: 40.4155, lng: -3.7074, radius: 1500 };

function captureRequest(response: unknown = { places: [] }) {
  const seen: { url?: string; init?: RequestInit } = {};

  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return {
      ok: true,
      status: 200,
      json: async () => response,
      text: async () => JSON.stringify(response),
    } as unknown as Response;
  });

  return {
    seen,
    body: () => JSON.parse(seen.init!.body as string) as Record<string, never>,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("searchText request body", () => {
  it("restricts by rectangle — a circle is rejected by the API", async () => {
    const captured = captureRequest();
    await searchText({ textQuery: "peluquería", circle: CIRCLE });

    const restriction = captured.body().locationRestriction as Record<string, unknown>;
    expect(restriction).toHaveProperty("rectangle");
    expect(restriction).not.toHaveProperty("circle");
  });

  it("sends the cell's bounding box, so the searched area contains the circle", async () => {
    const captured = captureRequest();
    await searchText({ textQuery: "peluquería", circle: CIRCLE });

    const { rectangle } = captured.body().locationRestriction as {
      rectangle: ReturnType<typeof circleToRectangle>;
    };
    expect(rectangle).toEqual(circleToRectangle(CIRCLE));

    // Google requires low ≤ high on latitude, and the box must straddle the centre.
    expect(rectangle.low.latitude).toBeLessThan(rectangle.high.latitude);
    expect(rectangle.low.latitude).toBeLessThan(CIRCLE.lat);
    expect(rectangle.high.latitude).toBeGreaterThan(CIRCLE.lat);
    expect(rectangle.low.longitude).toBeLessThan(CIRCLE.lng);
    expect(rectangle.high.longitude).toBeGreaterThan(CIRCLE.lng);
  });

  it("asks for the Enterprise field mask and full pages", async () => {
    const captured = captureRequest();
    await searchText({ textQuery: "peluquería", circle: CIRCLE });

    const headers = captured.seen.init!.headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toBe(FIELD_MASK);
    // websiteUri is the whole point of the tool; losing it breaks the classifier.
    expect(FIELD_MASK).toContain("places.websiteUri");
    expect(captured.body().pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("passes includedType only when there is one", async () => {
    const withType = captureRequest();
    await searchText({ textQuery: "x", circle: CIRCLE, includedType: "hair_salon" });
    expect(withType.body().includedType).toBe("hair_salon");

    vi.unstubAllGlobals();

    const without = captureRequest();
    await searchText({ textQuery: "x", circle: CIRCLE });
    expect(without.body()).not.toHaveProperty("includedType");
  });

  it("carries the page token unchanged when paging", async () => {
    const captured = captureRequest();
    await searchText({ textQuery: "x", circle: CIRCLE, pageToken: "tok-123" });
    expect(captured.body().pageToken).toBe("tok-123");
  });
});

describe("circleToRectangle", () => {
  it("contains the circle it came from", () => {
    const rect = circleToRectangle(CIRCLE);
    const latSpanM = (rect.high.latitude - rect.low.latitude) * 111_320;
    // Full diameter across, not a radius — an inscribed box would leave gaps.
    expect(latSpanM).toBeGreaterThan(CIRCLE.radius * 1.99);
  });

  it("widens longitude with latitude, since degrees narrow toward the poles", () => {
    const madrid = circleToRectangle({ lat: 40.4, lng: 0, radius: 1000 });
    const oslo = circleToRectangle({ lat: 59.9, lng: 0, radius: 1000 });

    expect(oslo.high.longitude).toBeGreaterThan(madrid.high.longitude);
  });

  it("never emits coordinates outside what the API accepts", () => {
    for (const [lat, lng] of [
      [89.999, 179.999],
      [-89.999, -179.999],
      [0, 180],
    ]) {
      const rect = circleToRectangle({ lat, lng, radius: 50_000 });
      for (const corner of [rect.low, rect.high]) {
        expect(corner.latitude).toBeGreaterThanOrEqual(-90);
        expect(corner.latitude).toBeLessThanOrEqual(90);
        expect(corner.longitude).toBeGreaterThanOrEqual(-180);
        expect(corner.longitude).toBeLessThanOrEqual(180);
      }
    }
  });
});
