import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LeadDetail } from "@/components/lead-detail";
import { Badge } from "@/components/ui";
import { getCategory } from "@/config/categories";
import { db } from "@/lib/db";
import { leadEvents } from "@/lib/db/schema";
import { WEBSITE_CLASS_HINTS, WEBSITE_CLASS_LABELS } from "@/lib/leads/classify";
import { getLead } from "@/lib/leads/query";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function LeadPage(props: PageProps<"/leads/[id]">) {
  const { id } = await props.params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) notFound();

  const lead = getLead(leadId);
  if (!lead) notFound();

  const settings = getSettings();
  const events = db
    .select()
    .from(leadEvents)
    .where(eq(leadEvents.leadId, leadId))
    .orderBy(asc(leadEvents.createdAt))
    .all();

  const categoryLabel = getCategory(lead.category ?? "")?.label ?? lead.category ?? "";
  const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${lead.placeId}`;

  return (
    <>
      <nav className="mb-4 text-sm">
        <Link href="/leads" className="text-ink-muted hover:text-accent">
          ← Leads
        </Link>
      </nav>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{lead.name}</h1>
          <Badge tone="accent">Score {lead.leadScore}</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-secondary">
          {categoryLabel}
          {lead.areaName ? ` · ${lead.areaName}` : ""}
          {lead.address ? ` · ${lead.address}` : ""}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <LeadDetail
          leadId={lead.leadId}
          status={lead.status}
          quoteAmount={lead.quoteAmount}
          currency={lead.currency}
          demoUrl={lead.demoUrl}
          notes={lead.notes}
          businessName={lead.name}
          categoryLabel={categoryLabel}
          areaName={lead.areaName}
          phone={lead.phone}
          templates={{
            myName: settings.myName,
            myPhone: settings.myPhone,
            defaultQuote: settings.defaultQuote,
            currency: settings.currency,
            emailSubject: settings.emailSubject,
            emailTemplate: settings.emailTemplate,
            whatsappTemplate: settings.whatsappTemplate,
          }}
        />

        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold tracking-tight">The business</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Phone</dt>
                <dd className="text-right">
                  {lead.phone ? (
                    <a href={`tel:${lead.phone}`} className="text-accent hover:underline">
                      {lead.phone}
                    </a>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Rating</dt>
                <dd className="tnum text-right">
                  {lead.rating != null ? lead.rating.toFixed(1) : "—"}
                  {lead.userRatingCount ? (
                    <span className="text-ink-muted"> · {lead.userRatingCount} reviews</span>
                  ) : null}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Listed site</dt>
                <dd className="min-w-0 text-right">
                  {lead.websiteUri ? (
                    <a
                      href={lead.websiteUri}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-accent hover:underline"
                    >
                      {lead.websiteHost ?? lead.websiteUri}
                    </a>
                  ) : (
                    <span className="text-ink-muted">Nothing listed</span>
                  )}
                </dd>
              </div>
            </dl>

            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 block rounded-lg border border-line px-3 py-2 text-center text-sm font-medium transition-colors hover:border-line-strong"
            >
              Open in Google Maps
            </a>
          </div>

          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="mb-2 text-sm font-semibold tracking-tight">Why it qualifies</h2>
            <Badge tone="accent">{WEBSITE_CLASS_LABELS[lead.websiteClass]}</Badge>
            <p className="mt-2 text-xs text-ink-secondary">
              {WEBSITE_CLASS_HINTS[lead.websiteClass]}
            </p>
          </div>

          <div className="rounded-xl border border-line bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold tracking-tight">Activity</h2>
            {events.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing yet.</p>
            ) : (
              <ul className="space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="text-sm">
                    <div className="text-ink-secondary">{event.message ?? event.type}</div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {event.createdAt.toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
