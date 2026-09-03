import { accessPassword } from "@/lib/auth";

/**
 * A plain HTML form posting to a route handler — no client JavaScript.
 *
 * The one page that must work when everything else is broken is the one that
 * lets you in, so it has no hydration to fail and no fetch to hang.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const failed = params.error !== undefined;

  // Only reachable in development, where the proxy lets everything through.
  const unprotected = accessPassword() === null;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <div className="rounded-xl border border-line bg-card p-6">
        <h1 className="text-lg font-semibold tracking-tight">Lead Tracking</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Enter the shared access password to continue.
        </p>

        {unprotected ? (
          <p className="mt-4 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
            No password is configured, so this app is currently unprotected. That
            is fine locally; set <code>APP_ACCESS_PASSWORD</code> before exposing
            it on a URL.
          </p>
        ) : null}

        <form action="/api/login" method="post" className="mt-5 space-y-3">
          {/* Where to land afterwards. Sanitised server-side before use. */}
          <input type="hidden" name="next" value={next} />

          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          {failed ? (
            <p role="alert" className="text-xs text-critical">
              That password is not correct.
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
