import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-line bg-card p-5 ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
        {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

/** 1,284 → "1,284"; 12,900 → "12.9K". Proportional figures, per the stat-tile spec. */
export function formatCompact(value: number): string {
  if (Math.abs(value) < 10_000) return value.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatMoney(amount: number, currency = "EUR"): string {
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

/**
 * Stat tile: label · value · optional note. The value is the chart — no
 * one-bar bar charts.
 */
export function StatTile({
  label,
  value,
  note,
  hero = false,
  tone,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  hero?: boolean;
  tone?: "good" | "warning" | "critical";
}) {
  const toneClass =
    tone === "good"
      ? "text-good"
      : tone === "warning"
        ? "text-warning"
        : tone === "critical"
          ? "text-critical"
          : "";

  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3.5">
      <div className="text-xs text-ink-muted">{label}</div>
      <div
        className={`mt-1 font-semibold tracking-tight ${
          hero ? "text-5xl" : "text-2xl"
        } ${toneClass}`}
      >
        {value}
      </div>
      {note ? <div className="mt-1 text-xs text-ink-muted">{note}</div> : null}
    </div>
  );
}

export type BarDatum = {
  label: string;
  value: number;
  href?: string;
  /** Overrides the single-series colour. Only the ordinal funnel uses this. */
  color?: string;
};

/**
 * Ranked horizontal bars.
 *
 * One hue for every bar by default: these categories have no natural order, and
 * shading them by size would double-encode the length the bar already shows.
 */
export function BarList({
  data,
  emptyMessage = "Nothing yet.",
  valueSuffix = "",
}: {
  data: BarDatum[];
  emptyMessage?: string;
  valueSuffix?: string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">{emptyMessage}</p>;
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <ul className="space-y-2.5">
      {data.map((datum) => {
        const share = total > 0 ? (datum.value / total) * 100 : 0;
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-ink-secondary">{datum.label}</span>
              <span className="tnum shrink-0 text-sm font-medium">
                {formatCompact(datum.value)}
                {valueSuffix}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-r-[4px]"
                style={{
                  width: `${Math.max((datum.value / max) * 100, datum.value > 0 ? 2 : 0)}%`,
                  background: datum.color ?? "var(--accent)",
                }}
              />
            </div>
          </>
        );

        return (
          <li
            key={datum.label}
            className="group"
            // Hover surfaces share-of-total, which the bar itself doesn't show.
            title={`${datum.label}: ${datum.value.toLocaleString("en-US")}${valueSuffix} · ${share.toFixed(1)}% of total`}
          >
            {datum.href ? (
              <Link href={datum.href} className="block rounded-md">
                {row}
              </Link>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "warning" | "critical";
}) {
  const tones = {
    neutral: "bg-card-muted text-ink-secondary",
    accent: "bg-accent-soft text-accent",
    good: "bg-card-muted text-good",
    warning: "bg-card-muted text-ink-secondary",
    critical: "bg-card-muted text-critical",
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? (
        <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">{children}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
