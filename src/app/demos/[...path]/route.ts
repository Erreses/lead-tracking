import fs from "node:fs/promises";
import { NextResponse } from "next/server";

import { INDEX_FILE, siteFile } from "@/lib/generate/paths";

/**
 * Serves generated demo sites off disk at `/demos/<slug>/`.
 *
 * They live outside `public/` on purpose: `public` is copied into the build
 * output, so pages generated after a build would not appear, and every demo
 * would be baked into the Docker image. Reading them at request time keeps them
 * data rather than source.
 *
 * The path is attacker-controlled, so it goes through `siteFile`, which is the
 * only thing allowed to turn a request into a filesystem path.
 */
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(file: string): string {
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot).toLowerCase();
  // Unknown types download rather than render, so an unexpected file can't be
  // served as something the browser will execute in this origin.
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export async function GET(_request: Request, ctx: RouteContext<"/demos/[...path]">) {
  const { path: segments } = await ctx.params;
  const [slug, ...rest] = segments;

  if (!slug) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // `/demos/<slug>/` means the page itself.
  const relative = rest.length > 0 ? rest.join("/") : INDEX_FILE;

  // `business.json` is the agent's input, which includes the raw Places payload.
  // It sits in the same directory but is not part of the site.
  if (relative === "business.json") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = siteFile(slug, relative);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const bytes = await fs.readFile(file);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType(relative),
        // Regenerating a site reuses the URL, so a cached copy would show the
        // old page. These are viewed a handful of times; freshness wins.
        "cache-control": "no-store",
        // The page is model-written HTML served from our own origin. It has no
        // business reaching the network or being embedded elsewhere.
        "content-security-policy":
          "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'self'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
