"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { TEMPLATE_VARIABLES } from "@/lib/leads/outreach";

type Settings = {
  myName: string;
  myPhone: string;
  defaultQuote: number;
  currency: string;
  emailSubject: string;
  emailTemplate: string;
  whatsappTemplate: string;
  extraAggregatorDomains: string;
};

const field =
  "mt-1 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm";

export function SettingsForm({
  initial,
  uncheckedCount,
}: {
  initial: Settings;
  uncheckedCount: number;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          defaultQuote: String(values.defaultQuote),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save settings");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function runLinkCheck() {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Link check failed");
      setCheckResult(
        `Checked ${data.checked}. Found ${data.dead} dead, creating ${data.newLeads} new leads. ${data.remaining} still to check.`,
      );
      router.refresh();
    } catch (err) {
      setCheckResult(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="text-sm font-semibold tracking-tight">You</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Dropped into your outreach messages.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="myName">
              Your name
            </label>
            <input
              id="myName"
              value={values.myName}
              onChange={(e) => set("myName", e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="myPhone">
              Your phone
            </label>
            <input
              id="myPhone"
              value={values.myPhone}
              onChange={(e) => set("myPhone", e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="defaultQuote">
              Default quote
            </label>
            <input
              id="defaultQuote"
              type="number"
              min={0}
              value={values.defaultQuote}
              onChange={(e) => set("defaultQuote", Number(e.target.value))}
              className={`${field} tnum`}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="currency">
              Currency
            </label>
            <input
              id="currency"
              value={values.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
              className={field}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="text-sm font-semibold tracking-tight">Outreach templates</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Placeholders:{" "}
          {TEMPLATE_VARIABLES.map((variable) => (
            <code key={variable} className="mr-1 font-mono">
              {`{{${variable}}}`}
            </code>
          ))}
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="emailSubject">
              Email subject
            </label>
            <input
              id="emailSubject"
              value={values.emailSubject}
              onChange={(e) => set("emailSubject", e.target.value)}
              className={field}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="emailTemplate">
              Email body
            </label>
            <textarea
              id="emailTemplate"
              rows={12}
              value={values.emailTemplate}
              onChange={(e) => set("emailTemplate", e.target.value)}
              className={`${field} resize-y font-mono text-xs leading-relaxed`}
            />
          </div>
          <div>
            <label className="block text-xs text-ink-muted" htmlFor="whatsappTemplate">
              WhatsApp message
            </label>
            <textarea
              id="whatsappTemplate"
              rows={5}
              value={values.whatsappTemplate}
              onChange={(e) => set("whatsappTemplate", e.target.value)}
              className={`${field} resize-y font-mono text-xs leading-relaxed`}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="text-sm font-semibold tracking-tight">Extra directory domains</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Domains to treat as &ldquo;not a real website&rdquo; on top of the built-in list.
          One per line. Useful for local directories you keep running into.
        </p>
        <textarea
          rows={4}
          value={values.extraAggregatorDomains}
          onChange={(e) => set("extraAggregatorDomains", e.target.value)}
          placeholder={"midirectorio.es\nguialocal.es"}
          className={`${field} resize-y font-mono text-xs`}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved ? <span className="text-xs text-good">Saved</span> : null}
        {error ? <span className="text-xs text-critical">{error}</span> : null}
      </div>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="text-sm font-semibold tracking-tight">Check for dead websites</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Visits the sites of businesses that appear to have one. Anything that fails to
          respond becomes a lead — those owners usually don&apos;t know their site is down.
          Uses no Places API quota. {uncheckedCount} left to check.
        </p>

        <button
          type="button"
          onClick={runLinkCheck}
          disabled={checking || uncheckedCount === 0}
          className="mt-3 rounded-lg border border-line px-3.5 py-2 text-sm font-medium transition-colors hover:border-line-strong disabled:opacity-60"
        >
          {checking ? "Checking…" : "Check next 100"}
        </button>

        {checkResult ? (
          <p className="mt-3 text-xs text-ink-secondary">{checkResult}</p>
        ) : null}
      </section>
    </div>
  );
}
