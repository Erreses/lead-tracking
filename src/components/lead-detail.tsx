"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { LEAD_STATUSES, type LeadStatus } from "@/lib/db/schema";
import {
  formatQuote,
  mailtoLink,
  missingVariables,
  renderTemplate,
  whatsappLink,
} from "@/lib/leads/outreach";

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  demo_built: "Demo built",
  contacted: "Contacted",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  discarded: "Discarded",
};

export type LeadDetailProps = {
  leadId: number;
  status: LeadStatus;
  quoteAmount: number | null;
  currency: string;
  demoUrl: string | null;
  notes: string | null;
  businessName: string;
  categoryLabel: string;
  areaName: string | null;
  phone: string | null;
  templates: {
    myName: string;
    myPhone: string;
    defaultQuote: number;
    currency: string;
    emailSubject: string;
    emailTemplate: string;
    whatsappTemplate: string;
  };
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-line-strong"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function LeadDetail(props: LeadDetailProps) {
  const router = useRouter();

  const [status, setStatus] = useState<LeadStatus>(props.status);
  const [quote, setQuote] = useState<string>(
    props.quoteAmount != null ? String(props.quoteAmount) : String(props.templates.defaultQuote),
  );
  const [demoUrl, setDemoUrl] = useState(props.demoUrl ?? "");
  const [notes, setNotes] = useState(props.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vars = useMemo(
    () => ({
      business_name: props.businessName,
      category: props.categoryLabel,
      area: props.areaName ?? "",
      demo_url: demoUrl,
      quote: formatQuote(Number(quote) || null, props.currency || props.templates.currency),
      my_name: props.templates.myName,
      my_phone: props.templates.myPhone,
    }),
    [props, demoUrl, quote],
  );

  const emailSubject = renderTemplate(props.templates.emailSubject, vars);
  const emailBody = renderTemplate(props.templates.emailTemplate, vars);
  const whatsappBody = renderTemplate(props.templates.whatsappTemplate, vars);
  const missing = missingVariables(props.templates.whatsappTemplate, vars).concat(
    missingVariables(props.templates.emailTemplate, vars),
  );
  const uniqueMissing = [...new Set(missing)];
  const waLink = whatsappLink(props.phone, whatsappBody);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${props.leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function save() {
    void patch({
      status,
      quoteAmount: quote === "" ? null : Number(quote),
      demoUrl: demoUrl || null,
      notes,
    });
  }

  function markSent(channel: "email" | "whatsapp") {
    setStatus("contacted");
    void patch({
      status: status === "new" || status === "qualified" || status === "demo_built"
        ? "contacted"
        : status,
      quoteAmount: quote === "" ? null : Number(quote),
      demoUrl: demoUrl || null,
      markContacted: true,
      event: `Sent via ${channel === "email" ? "email" : "WhatsApp"}`,
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold tracking-tight">Deal</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="status">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as LeadStatus)}
              className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
            >
              {LEAD_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-ink-muted" htmlFor="quote">
              Quote ({props.currency || props.templates.currency})
            </label>
            <input
              id="quote"
              type="number"
              min={0}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              className="tnum mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-ink-muted" htmlFor="demo">
              Demo site URL
            </label>
            <input
              id="demo"
              type="url"
              value={demoUrl}
              onChange={(e) => setDemoUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-ink-muted" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Who you spoke to, what they said, when to follow up…"
            className="mt-1 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved ? <span className="text-xs text-good">Saved</span> : null}
          {error ? <span className="text-xs text-critical">{error}</span> : null}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-card p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Outreach</h2>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          Built from your templates in Settings. Fill in the demo URL and quote above and
          they update here.
        </p>

        {uniqueMissing.length > 0 ? (
          <p className="mb-4 rounded-lg bg-card-muted px-3 py-2 text-xs text-serious">
            Still empty: {uniqueMissing.join(", ")}. Placeholders are left visible in the
            message so you can spot them before sending.
          </p>
        ) : null}

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-secondary">WhatsApp</span>
              <div className="flex gap-2">
                <CopyButton text={whatsappBody} label="Copy" />
                {waLink ? (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => markSent("whatsapp")}
                    className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink transition-colors hover:bg-accent-hover"
                  >
                    Open WhatsApp
                  </a>
                ) : (
                  <span className="rounded-lg px-2.5 py-1.5 text-xs text-ink-muted">
                    No phone number
                  </span>
                )}
              </div>
            </div>
            <pre className="whitespace-pre-wrap rounded-lg bg-card-muted px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
              {whatsappBody}
            </pre>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-secondary">Email</span>
              <div className="flex gap-2">
                <CopyButton text={`${emailSubject}\n\n${emailBody}`} label="Copy" />
                <a
                  href={mailtoLink(emailSubject, emailBody)}
                  onClick={() => markSent("email")}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium transition-colors hover:border-line-strong"
                >
                  Open mail app
                </a>
              </div>
            </div>
            <p className="mb-1 text-xs text-ink-muted">Subject: {emailSubject}</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-card-muted px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
              {emailBody}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
