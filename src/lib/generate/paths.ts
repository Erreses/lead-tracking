import path from "node:path";

/**
 * Where generated sites live, and the only names allowed inside it.
 *
 * Two different things depend on getting this right: an agent is given write
 * access to one of these directories, and a route handler serves files back out
 * of them over HTTP. A slug that escaped the root would turn either of those
 * into a way to read or write anywhere on the machine, so slugs are built here
 * and validated here, and nothing else constructs one.
 */

export const SITES_ROOT =
  process.env.GENERATED_SITES_DIR ?? path.join(process.cwd(), "generated-sites");

/**
 * Scratch space for a build: the real Google photos, and the JSON the agent
 * reads. Deliberately *not* inside the site directory.
 *
 * Both are Google's data. The photos carry Places licensing and attribution
 * terms and the JSON carries customers' reviews verbatim; neither is ours to
 * commit to a public repository. Keeping them under a separate root means
 * `generated-sites/` holds nothing but the page we wrote, which is what makes
 * it publishable at all.
 *
 * The agent reads from here and writes only to the site directory.
 */
export const WORK_ROOT =
  process.env.SITE_WORK_DIR ?? path.join(process.cwd(), ".site-work");

/** Anything outside this set is stripped, so a slug is always path-safe. */
const SLUG_SAFE = /[^a-z0-9]+/g;

/**
 * `Peluquería Sin Web` + 823 → `peluqueria-sin-web-823`.
 *
 * The id suffix is not decoration: two businesses on the same street can share
 * a name, and without it the second would silently overwrite the first's site.
 */
export function siteSlug(name: string, businessId: number): string {
  const base = name
    .normalize("NFD")
    // Strip accents rather than dropping the letters they sit on, so
    // "Peluquería" becomes "peluqueria" and not "peluquera". NFD splits an
    // accented letter into base + combining mark; this removes the marks.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(SLUG_SAFE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");

  // A name of nothing but punctuation or non-Latin script leaves base empty;
  // the id alone is still a valid, unique directory name.
  return base ? `${base}-${businessId}` : `business-${businessId}`;
}

/** Exactly what `siteSlug` produces, and nothing else. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 80;
}

/**
 * Absolute directory for a slug, or null if the slug is not one we made.
 *
 * The shape check alone would be enough — `..` cannot survive it — but the
 * containment check is what this function actually promises, so it is asserted
 * rather than reasoned about. Cheap, and it stays true if the regex ever
 * loosens.
 */
export function siteDir(slug: string): string | null {
  if (!isValidSlug(slug)) return null;

  // `SITES_ROOT` is configurable, so the build's file tracer cannot tell where
  // these resolve and defensively pulls the whole project into the server
  // bundle. These paths are runtime data written by the app, never build
  // inputs — the same reasoning as the backup directory in src/lib/db/backup.ts.
  const resolved = path.resolve(/*turbopackIgnore: true*/ SITES_ROOT, slug);
  const root = path.resolve(/*turbopackIgnore: true*/ SITES_ROOT);
  if (resolved !== path.join(/*turbopackIgnore: true*/ root, slug)) return null;
  if (!resolved.startsWith(root + path.sep)) return null;

  return resolved;
}

/**
 * Absolute path to one file inside a site, or null if it escapes.
 *
 * Serving files is where this matters most: the request path is attacker
 * controlled, and `photo-1.jpg` and `../../../.env.local` are both just
 * strings until something resolves them.
 */
export function siteFile(slug: string, relative: string): string | null {
  const dir = siteDir(slug);
  if (!dir) return null;

  // Reject anything that even looks like traversal before resolving, so a
  // decoded `%2e%2e` never reaches the filesystem call.
  if (relative.includes("\0") || relative.split(/[\\/]/).includes("..")) return null;

  const resolved = path.resolve(/*turbopackIgnore: true*/ dir, relative);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return null;

  return resolved;
}

/** Build scratch space for one business, outside the published site. */
export function workDir(slug: string): string | null {
  if (!isValidSlug(slug)) return null;

  const root = path.resolve(/*turbopackIgnore: true*/ WORK_ROOT);
  const resolved = path.resolve(/*turbopackIgnore: true*/ WORK_ROOT, slug);
  if (resolved !== path.join(/*turbopackIgnore: true*/ root, slug)) return null;

  return resolved;
}

/** The page itself. Every build writes this file and the app links to it. */
export const INDEX_FILE = "index.html";

/**
 * Public URL for a generated site — always naming index.html, never the bare
 * directory.
 *
 * `/demos/<slug>/` looks tidier but Next strips the trailing slash with a 308,
 * landing the browser on `/demos/<slug>`. The page's own `<img src="photo-1.png">`
 * would then resolve against `/demos/`, and every photo on the page 404s. Ending
 * the path in a filename keeps the directory in it, so relative links resolve
 * where the files actually are.
 */
export function demoPath(slug: string): string {
  return `/demos/${slug}/${INDEX_FILE}`;
}
