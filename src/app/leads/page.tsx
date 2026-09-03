import Link from "next/link";

import { LeadFilters } from "@/components/lead-filters";
import { LeadsTable } from "@/components/leads-table";
import { EmptyState, PageHeader, formatCompact, formatMoney } from "@/components/ui";
import {
  countLeads,
  filterOptions,
  parseLeadFilters,
  queryLeads,
  summarizeLeads,
} from "@/lib/leads/query";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

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
  const total = await countLeads(filters);
  const rows = await queryLeads(filters, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const { areas } = await filterOptions();
  const stats = await summarizeLeads(filters);
  const settings = await getSettings();

  const firstOnPage = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * PAGE_SIZE, total);

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

      {/* Describes the current filter, not the whole database — narrowing to one
          category should tell you about that category. */}
      {total > 0 ? (
        <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Matching", value: formatCompact(stats.total) },
            { label: "Untouched", value: formatCompact(stats.untouched) },
            { label: "In play", value: formatCompact(stats.inPlay) },
            {
              label: "Quoted",
              value: formatMoney(stats.pipelineValue, settings.currency),
            },
            { label: "Avg score", value: String(stats.avgScore) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-line bg-card px-4 py-3">
              <dt className="text-xs text-ink-muted">{stat.label}</dt>
              <dd className="tnum mt-0.5 text-lg font-semibold tracking-tight">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

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
          <LeadsTable
            rows={rows}
            sort={filters.sort}
            dir={filters.dir}
            params={exportParams.toString()}
            outreach={{
              myName: settings.myName,
              whatsappTemplate: settings.whatsappTemplate,
              currency: settings.currency,
            }}
          />

          <p className="mt-3 text-xs text-ink-muted">
            Showing {firstOnPage}–{lastOnPage} of {formatCompact(total)}
          </p>

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
