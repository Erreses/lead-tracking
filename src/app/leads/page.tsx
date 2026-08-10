import Link from "next/link";

import { LeadFilters } from "@/components/lead-filters";
import { Badge, EmptyState, PageHeader, formatCompact } from "@/components/ui";
import { getCategory } from "@/config/categories";
import { WEBSITE_CLASS_LABELS } from "@/lib/leads/classify";
import { countLeads, filterOptions, parseLeadFilters, queryLeads } from "@/lib/leads/query";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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

function statusTone(status: string) {
  if (status === "won") return "good" as const;
  if (status === "lost" || status === "discarded") return "neutral" as const;
  if (status === "new") return "accent" as const;
  return "neutral" as const;
}

export default async function LeadsPage(props: PageProps<"/leads">) {
  const searchParams = await props.searchParams;

  // `searchParams` gives arrays for repeated keys; URLSearchParams needs flat entries.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value != null) params.set(key, value);
  }

  const filters = parseLeadFilters(params);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const total = countLeads(filters);
  const rows = queryLeads(filters, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const { areas } = filterOptions();

  const exportParams = new URLSearchParams(params);
  exportParams.delete("page");

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(target: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(target));
    return `/leads?${next.toString()}`;
  }

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={`${formatCompact(total)} ${total === 1 ? "business" : "businesses"} with no real website of their own.`}
        action={
          total > 0 ? (
            <a
              href={`/api/leads/export?${exportParams.toString()}`}
              className="rounded-lg border border-line px-3.5 py-2 text-sm font-medium transition-colors hover:border-line-strong"
            >
              Export CSV
            </a>
          ) : null
        }
      />

      <LeadFilters areas={areas} />

      {rows.length === 0 ? (
        <EmptyState
          title={total === 0 ? "No leads yet" : "Nothing matches these filters"}
          action={
            total === 0 ? (
              <Link
                href="/scrape"
                className="inline-block rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                Run a scrape
              </Link>
            ) : null
          }
        >
          {total === 0
            ? "Scrape an area first, and businesses without a website will land here."
            : "Try clearing a filter."}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="px-4 py-2.5 font-medium">Business</th>
                  <th className="px-4 py-2.5 font-medium">Why</th>
                  <th className="px-4 py-2.5 text-right font-medium">Reviews</th>
                  <th className="px-4 py-2.5 text-right font-medium">Rating</th>
                  <th className="px-4 py-2.5 text-right font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.leadId} className="transition-colors hover:bg-card-muted">
                    <td className="px-4 py-2.5">
                      <Link href={`/leads/${row.leadId}`} className="block">
                        <span className="font-medium">{row.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">
                          {getCategory(row.category ?? "")?.label ?? row.category}
                          {row.areaName ? ` · ${row.areaName}` : ""}
                          {row.phone ? ` · ${row.phone}` : ""}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-secondary">
                      {WEBSITE_CLASS_LABELS[row.websiteClass]}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-ink-secondary">
                      {row.userRatingCount ?? "—"}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-ink-secondary">
                      {row.rating?.toFixed(1) ?? "—"}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right font-medium">
                      {row.leadScore}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={statusTone(row.status)}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 ? (
            <nav className="mt-4 flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="text-accent hover:underline">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-ink-muted">
                Page {page} of {pageCount}
              </span>
              {page < pageCount ? (
                <Link href={pageHref(page + 1)} className="text-accent hover:underline">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
