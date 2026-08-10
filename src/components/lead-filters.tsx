"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { CATEGORIES } from "@/config/categories";
import { LEAD_STATUSES, WEBSITE_CLASSES } from "@/lib/db/schema";
import { WEBSITE_CLASS_LABELS } from "@/lib/leads/classify";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  qualified: "Qualified",
  demo_built: "Demo built",
  contacted: "Contacted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  discarded: "Discarded",
};

const SORTS = [
  { value: "score", label: "Best first" },
  { value: "reviews", label: "Most reviews" },
  { value: "rating", label: "Highest rated" },
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently found" },
];

export function LeadFilters({ areas }: { areas: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlQuery = params.get("q") ?? "";
  const [search, setSearch] = useState(urlQuery);
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);

  // Keep the box in step when Clear or a link changes the URL. Adjusting state
  // during render (rather than in an effect) avoids a cascading re-render.
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery);
    setSearch(urlQuery);
  }

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any filter change invalidates the current page offset.
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  const activeCount = ["status", "websiteClass", "category", "area", "hasPhone", "minReviews", "q"].filter(
    (key) => params.get(key),
  ).length;

  return (
    <div className="mb-4 rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply({ q: search });
          }}
          className="min-w-[180px] flex-1"
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or address…"
            aria-label="Search leads"
            className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-sm"
          />
        </form>

        <select
          value={params.get("status") ?? ""}
          onChange={(e) => apply({ status: e.target.value })}
          aria-label="Filter by status"
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <select
          value={params.get("websiteClass") ?? ""}
          onChange={(e) => apply({ websiteClass: e.target.value })}
          aria-label="Filter by why they qualify"
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm"
        >
          <option value="">Any reason</option>
          {WEBSITE_CLASSES.filter((c) => c !== "has_website").map((cls) => (
            <option key={cls} value={cls}>
              {WEBSITE_CLASS_LABELS[cls]}
            </option>
          ))}
        </select>

        <select
          value={params.get("category") ?? ""}
          onChange={(e) => apply({ category: e.target.value })}
          aria-label="Filter by category"
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.label}
            </option>
          ))}
        </select>

        {areas.length > 1 ? (
          <select
            value={params.get("area") ?? ""}
            onChange={(e) => apply({ area: e.target.value })}
            aria-label="Filter by area"
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm"
          >
            <option value="">All areas</option>
            {areas.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
        ) : null}

        <select
          value={params.get("sort") ?? "score"}
          onChange={(e) => apply({ sort: e.target.value })}
          aria-label="Sort leads"
          className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm"
        >
          {SORTS.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={params.get("hasPhone") === "1"}
            onChange={(e) => apply({ hasPhone: e.target.checked ? "1" : null })}
            className="accent-[var(--accent)]"
          />
          Has phone
        </label>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => router.push(pathname)}
            className="rounded-lg px-2.5 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
