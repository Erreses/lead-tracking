"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { getCategory } from "@/config/categories";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/db/schema";
import { WEBSITE_CLASS_LABELS } from "@/lib/leads/classify";
import { renderTemplate, whatsappLink } from "@/lib/leads/outreach";
import type { LeadRow } from "@/lib/leads/query";
import { nextSortDir, type LeadSort, type SortDir } from "@/lib/leads/sort";

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  demo_built: "Demo built",
  contacted: "Contacted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  discarded: "Discarded",
};

/** Badge-like styling for the inline status control. */
const STATUS_STYLE: Record<LeadStatus, string> = {
  new: "bg-accent-soft text-accent",
  qualified: "bg-card-muted text-ink-secondary",
  demo_built: "bg-card-muted text-ink-secondary",
  contacted: "bg-card-muted text-ink-secondary",
  negotiating: "bg-card-muted text-ink-secondary",
  won: "bg-card-muted text-good",
  lost: "bg-card-muted text-ink-muted",
  discarded: "bg-card-muted text-ink-muted",
};

const ICON = "h-4 w-4";

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={ICON}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={ICON}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 20.755c1.006 0 1.947-.247 2.777-.682A9.06 9.06 0 0 0 12 20.25Z"
      />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={ICON}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"
      />
    </svg>
  );
}

const ACTION_CLASS =
  "rounded-md p-1.5 text-ink-muted transition-colors hover:bg-card focus-visible:opacity-100";

type Column = {
  key: LeadSort;
  label: string;
  align?: "right";
  /** Hidden on narrow screens so the useful columns keep their width. */
  hideBelow?: "md" | "lg";
};

const COLUMNS: Column[] = [
  { key: "name", label: "Business" },
  { key: "category", label: "Category", hideBelow: "md" },
  { key: "why", label: "Why", hideBelow: "lg" },
  { key: "reviews", label: "Reviews", align: "right", hideBelow: "lg" },
  { key: "rating", label: "Rating", align: "right", hideBelow: "lg" },
  { key: "score", label: "Score", align: "right" },
  { key: "status", label: "Status" },
];

const HIDE_CLASS = { md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

/** Score drives the whole list, so it gets read at a glance rather than parsed. */
function ScoreBar({ score }: { score: number }) {
  const tone =
    score >= 70 ? "bg-good" : score >= 40 ? "bg-accent" : "bg-ink-muted opacity-50";

  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-track sm:block">
        <span
          className={`block h-full rounded-full ${tone}`}
          style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
        />
      </span>
      <span className="tnum w-6 text-right font-medium">{score}</span>
    </span>
  );
}

export function LeadsTable({
  rows,
  sort,
  dir,
  params,
  outreach,
}: {
  rows: LeadRow[];
  sort: LeadSort;
  dir: SortDir;
  /** Current query string, so sorting preserves filters and vice versa. */
  params: string;
  outreach: { myName: string; whatsappTemplate: string; currency: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function sortHref(column: LeadSort) {
    const next = new URLSearchParams(params);
    next.set("sort", column);
    next.set("dir", nextSortDir(column, sort, dir));
    // Re-sorting invalidates the page number: page 3 of the old order is
    // meaningless in the new one, and lands you somewhere arbitrary.
    next.delete("page");
    return `/leads?${next.toString()}`;
  }

  async function setStatus(leadId: number, status: LeadStatus) {
    setBusyId(leadId);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not update the lead");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error ? (
        <p className="mb-3 rounded-lg bg-card-muted px-3 py-2 text-xs text-critical">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-muted">
              {COLUMNS.map((column) => {
                const active = sort === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    // Screen readers announce the sort state rather than the arrow.
                    aria-sort={
                      active
                        ? dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={`px-4 py-2.5 font-medium ${
                      column.align === "right" ? "text-right" : ""
                    } ${column.hideBelow ? HIDE_CLASS[column.hideBelow] : ""}`}
                  >
                    <Link
                      href={sortHref(column.key)}
                      scroll={false}
                      className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${
                        active ? "text-ink" : ""
                      }`}
                    >
                      {column.label}
                      <span
                        aria-hidden
                        className={active ? "text-accent" : "text-transparent"}
                      >
                        {active && dir === "asc" ? "↑" : "↓"}
                      </span>
                    </Link>
                  </th>
                );
              })}
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const categoryLabel =
                getCategory(row.category ?? "")?.label ?? row.category ?? "—";
              const wa = whatsappLink(
                row.phone,
                // The list can't fill in {{demo_url}} or {{quote}} — those are
                // per-lead work done on the detail page. This is the opener.
                renderTemplate(outreach.whatsappTemplate, {
                  business_name: row.name,
                  my_name: outreach.myName,
                  category: categoryLabel,
                  area: row.areaName ?? "",
                }),
              );
              const maps = row.placeId
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    row.name,
                  )}&query_place_id=${row.placeId}`
                : null;
              const busy = busyId === row.leadId;

              return (
                <tr
                  key={row.leadId}
                  className={`group transition-colors hover:bg-card-muted ${
                    busy || pending ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <Link href={`/leads/${row.leadId}`} className="block">
                      <span className="font-medium">{row.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-muted">
                        {[row.areaName, row.phone].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </Link>
                  </td>

                  <td
                    className={`whitespace-nowrap px-4 py-2.5 text-ink-secondary ${HIDE_CLASS.md}`}
                  >
                    {categoryLabel}
                  </td>

                  <td
                    className={`whitespace-nowrap px-4 py-2.5 text-ink-secondary ${HIDE_CLASS.lg}`}
                  >
                    {WEBSITE_CLASS_LABELS[row.websiteClass]}
                  </td>

                  <td
                    className={`tnum px-4 py-2.5 text-right text-ink-secondary ${HIDE_CLASS.lg}`}
                  >
                    {row.userRatingCount ?? "—"}
                  </td>

                  <td
                    className={`tnum px-4 py-2.5 text-right text-ink-secondary ${HIDE_CLASS.lg}`}
                  >
                    {row.rating?.toFixed(1) ?? "—"}
                  </td>

                  <td className="px-4 py-2.5 text-right">
                    <ScoreBar score={row.leadScore} />
                  </td>

                  {/* The badge *is* the control: one place that both shows the
                      status and moves it, rather than a badge here and a
                      duplicate dropdown in the actions column. */}
                  <td className="px-4 py-2.5">
                    <select
                      value={row.status}
                      disabled={busy}
                      onChange={(e) => setStatus(row.leadId, e.target.value as LeadStatus)}
                      aria-label={`Status for ${row.name}`}
                      className={`cursor-pointer rounded-full border-0 py-0.5 pl-2 pr-1 text-xs font-medium disabled:opacity-50 ${
                        STATUS_STYLE[row.status as LeadStatus] ?? "bg-card-muted"
                      }`}
                    >
                      {LEAD_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    {row.quoteAmount != null ? (
                      <span className="tnum mt-0.5 block text-xs text-ink-muted">
                        {row.quoteAmount} {row.currency}
                      </span>
                    ) : null}
                  </td>

                  {/* Actions stay dim until the row is hovered or focused, so a
                      long list reads as data rather than as a wall of buttons. */}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      {row.phone ? (
                        <a
                          href={`tel:${row.phone.replace(/\s/g, "")}`}
                          title={`Call ${row.phone}`}
                          aria-label={`Call ${row.name}`}
                          className={`${ACTION_CLASS} hover:text-accent`}
                        >
                          <PhoneIcon />
                        </a>
                      ) : null}

                      {wa ? (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="WhatsApp, with your template filled in"
                          aria-label={`WhatsApp ${row.name}`}
                          className={`${ACTION_CLASS} hover:text-good`}
                        >
                          <ChatIcon />
                        </a>
                      ) : null}

                      {maps ? (
                        <a
                          href={maps}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open the Google listing"
                          aria-label={`Google listing for ${row.name}`}
                          className={`${ACTION_CLASS} hover:text-accent`}
                        >
                          <MapPinIcon />
                        </a>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
