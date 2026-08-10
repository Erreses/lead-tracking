import { WEBSITE_CLASS_LABELS } from "@/lib/leads/classify";
import { parseLeadFilters, queryLeads } from "@/lib/leads/query";
import { normalizePhone } from "@/lib/leads/outreach";

/** RFC 4180: quote the field and double any embedded quotes. */
function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const COLUMNS = [
  "name",
  "category",
  "area",
  "address",
  "phone",
  "phone_e164",
  "website",
  "website_class",
  "rating",
  "reviews",
  "lead_score",
  "status",
  "quote",
  "currency",
  "demo_url",
  "notes",
  "google_maps_url",
] as const;

/**
 * Export whatever the leads page is currently showing. The filters arrive as the
 * same query string the page uses, so "export this view" really does export
 * that view.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = parseLeadFilters(url.searchParams);
  const rows = queryLeads(filters, 10_000, 0);

  const lines = [COLUMNS.join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.category,
        row.areaName,
        row.address,
        row.phone,
        normalizePhone(row.phone),
        row.websiteUri,
        WEBSITE_CLASS_LABELS[row.websiteClass],
        row.rating,
        row.userRatingCount,
        row.leadScore,
        row.status,
        row.quoteAmount,
        row.currency,
        row.demoUrl,
        row.notes,
        `https://www.google.com/maps/place/?q=place_id:${row.placeId}`,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(`﻿${lines.join("\n")}`, {
    headers: {
      // The BOM makes Excel open UTF-8 accents correctly.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
    },
  });
}
