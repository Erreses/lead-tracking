# Lead Tracking

Find local businesses that have **no website**, then track selling them one.

Point it at an area (Madrid is set up out of the box), pick some categories, and hit
Scrape. It sweeps Google Maps, keeps every business without a real website of its own, and
drops them into a pipeline you work through: build a demo → send the link with a quote →
close.

- **Overview** — how many leads you have, where they are in the pipeline, what's in play
- **Scrape** — run a sweep, with the cost shown *before* anything runs
- **Leads** — filter, sort by opportunity score, export to CSV
- **Lead detail** — quote, demo link, notes, and a ready-to-send WhatsApp/email pitch

Runs locally, or on your own server — see [DEPLOY.md](DEPLOY.md) to put it on a Coolify
VPS behind a shared password, so more than one person can work the same pipeline.

---

## Setup

You need Postgres. Homebrew's is fine (`brew install postgresql@17 && brew services start
postgresql@17`), or use the throwaway one in Docker:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Then:

```bash
npm install
cp .env.example .env.local     # set DATABASE_URL, paste your Google Maps API key
createdb lead_tracking         # skip if you used the Docker one
npm run db:migrate
npm run dev                    # http://localhost:3000
```

Migrations also run automatically whenever the server starts, so after pulling changes you
can just restart it.

Coming from the old SQLite build? `npm run db:import` copies `data/leads.db` across. It
refuses to run against a Postgres database that already has rows, so it can't duplicate
anything.

### Getting a Google Maps API key

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com/)
2. Enable **Places API (New)** for it
3. **Credentials → Create credentials → API key**
4. **Enable billing on the project.** This is required even for the free monthly
   allowance — you aren't charged until you go past it
5. Restrict the key to the Places API (New)

Put it in `.env.local` as `GOOGLE_MAPS_API_KEY=...` and restart the dev server.

`npm run dev` is the command that starts the server — it prints the URL when it's
ready:

```
▲ Next.js 16.3.0 (Turbopack)
- Local:         http://localhost:3000
✓ Ready in 436ms
```

### Want to look around first?

```bash
npm run seed:demo      # 60 fake Madrid businesses, tagged "DEMO ·"
npm run dev            # then open http://localhost:3000
```

`seed:demo` only fills the database and exits — it doesn't start the app, so it
prints no URL. Run `npm run dev` after it. Seeding costs nothing and touches no
API. To start clean:

```bash
dropdb lead_tracking && createdb lead_tracking && npm run db:migrate
```

---

## What it costs

The scraper uses the Places API **Text Search** endpoint, asking for `websiteUri` — the
field this whole tool depends on. That puts every call in the **Text Search Enterprise**
SKU:

| | |
|---|---|
| Price | **$35 per 1,000 requests** |
| Free every month | **1,000 requests** |
| Businesses per request | up to **20** |
| Effective cost | **~$1.75 per 1,000 businesses** |

Requests are the billable unit; businesses are what you actually want. One request buys you
up to 20 of them, which is where the $1.75 comes from — and it's why the Scrape page shows
both, so a sweep returning 3 businesses per request is visibly poor value rather than just
a number on a bill.

The estimate is built from three multipliers, all in `src/lib/scrape/cost.ts`:

| | |
|---|---|
| **Searches** | cells × categories — the floor, one request each |
| **Paging** | ×1.6, since ~40% of searches need a 2nd or 3rd page |
| **Subdivision** | ×1.6 at depth 1, up to ×2.18 at depth 3 — full cells split into four |

Some real numbers from the built-in areas, at the default 1 level of subdivision:

| Sweep | Cells | Searches | Requests (est.) | List price | Businesses reachable |
|---|---|---|---|---|---|
| Madrid · Centro, 3 categories, 500 m cells | 25 | 75 | 75–192 | $2.63–$6.72 | up to 3,840 |
| Madrid · Centro, 6 categories, 800 m cells | 13 | 78 | 78–200 | $2.73–$7.00 | up to 4,000 |
| Madrid whole city, 6 categories, 1.5 km cells | 69 | 414 | 414–1,060 | $14.49–$37.10 | up to 21,200 |

The first two are under the 1,000 free monthly requests, so on a fresh month they cost
nothing. The whole-city sweep can cross the line — the Scrape page tells you by how much
before you start.

**Four guards keep this honest:**

1. **Estimate before you run.** The Scrape page prices the sweep without calling the API,
   and shows what you'd actually be *charged* after the free allowance, not just list price.
2. **Budget cap.** Every job carries a maximum request count, checked between cells *and*
   between pages. It stops cleanly there and keeps everything it found.
3. **Free-tier meter.** The Overview shows requests used this month against the free 1,000.
   Demo rows are excluded from it — `seed:demo` writes a job that never called Google.
4. **Coverage cache.** A repeat sweep doesn't pay twice for the same ground — see below.

### Not paying twice

Google bills per **request**, not per business, and Text Search has no way to say "skip the
places I already have". So deduplicating businesses saves nothing: by the time you see a
duplicate, the request is already paid for. The `place_id` dedup exists for data quality.

The only real saving is not issuing the request. Every cell × category search that
completes is recorded in `cell_coverage`, and a re-run inside the coverage window skips it:

| | |
|---|---|
| Window | **30 days**, editable in Settings — 0 disables it |
| Re-running Centro the next day | **$0**, all 75 searches skipped |
| Adding one new category | only that category's 25 searches are charged |
| Listings may have changed | tick **Re-sweep everything** to pay for a fresh pass |

The Scrape page shows the skip before you run (`Already covered −50 skipped`), so the quote
is for the re-run rather than the first run. A search that the budget cap cut short is
deliberately *not* recorded — marking a partial sweep as covered would hide the missing
pages until the window expired.

Beyond that, the levers are: fewer categories (cost is exactly linear in them), lower
subdivision depth, and larger cells. One thing you can't optimise away is the lattice
overlap — every point in an area sits inside ~1.67 cells on average, which is the price of
leaving no gaps.

### Backups

Every scrape snapshots the database first, into `data/backups/`, keeping the **last 3** and
deleting the oldest to make room. Snapshots are `pg_dump` in its custom format — a
consistent picture taken while the database keeps serving — so `pg_dump` has to be on PATH.
A failed snapshot is reported but doesn't block the scrape: the run adds data rather than
destroying it. To roll back:

```bash
pg_restore --dbname="$DATABASE_URL" --clean --no-owner data/backups/leads-....dump
```

Note that `npm run seed:demo -- --reset` clears **all** rows, not just demo ones, and takes
no backup. Don't point it at a database with real leads in it.

---

## How the scraping works

Google's Text Search returns **at most 60 results per query** (20 per page, 3 pages). "Every
restaurant in Madrid" is far more than 60, so the area gets tiled.

1. **Tile the area.** Circular cells on a square lattice spaced just under `radius × √2` —
   the widest spacing that still leaves no gaps. The lattice extends one cell radius past
   the boundary, because a point on the edge is covered by a cell centred beyond it.
2. **Sweep each cell × category** with `locationRestriction`, following pages to 60.
3. **Subdivide what comes back full.** A cell returning 60 results was truncated, so it
   splits into four half-size children which are searched in turn. Dense streets get drilled
   into; a city park costs one request. This is the main thing keeping the bill down.
4. **Classify and store.** Deduplicated on Google's `place_id`, so re-running a sweep
   updates rather than duplicates.

Cells still saturated at the deepest level are counted and reported after the run, so
incomplete coverage is visible rather than silent.

## What counts as "no website"

An empty website field is only the most obvious case:

| Verdict | What it means |
|---|---|
| **No website** | Nothing listed on Google. The strongest pitch. |
| **Dead Google site** | Points at `business.site` / `negocio.site`. Google discontinued those, so the link goes nowhere. |
| **Social only** | Just Facebook, Instagram, a Linktree, a WhatsApp link. |
| **Marketplace only** | Only on Glovo, TheFork, Doctoralia, Booking… paying commission for someone else's property. |
| **Free subdomain** | A real site, but on `wixsite.com`, `wordpress.com` etc. Rented address, weak on search. Scored lower. |
| **Broken website** | Has a domain, but it didn't respond when checked. Owners often don't know. |

The domain lists live in `src/config/domains.ts` and can be extended from **Settings**.

**Broken websites** are found by a separate opt-in pass (Settings → *Check for dead
websites*). It visits the sites of businesses that appear to have one, uses no Places API
quota, and promotes anything that fails to respond into a lead.

### Lead score

Each lead gets a 0–100 score so the list opens on the ones most likely to pay: base weight
by why they qualify, plus review volume (visibly busy), rating (well-liked), and whether
there's a phone number to call. Businesses that aren't operational are heavily discounted.

---

## After a run: results and what to do next

When a scrape finishes, the Scrape page reads its counters and says what they
mean — coverage, value for money, and the settings that would fix what went
wrong. Each recommendation that has a concrete fix carries a button that loads
those settings into the form. It doesn't start the run: the price changes, and
you should see the new number first.

| Signal | What it means | What it offers |
|---|---|---|
| Searches hit the 60-result cap | Google truncated those areas — results are missing | Re-run one subdivision level deeper, or a finer grid once depth is maxed |
| Stopped at the budget cap with work left | The sweep is incomplete | A cap big enough to finish the queue |
| Under 5 of 20 results per request | Paying full price for near-empty pages | A coarser grid covering the same ground for fewer requests |
| Every search already covered | Free run, nothing to do | Re-sweep anyway, if listings may have changed |
| Failed | Still billed for what it sent | The error, the spend, and the `npm run logs` command |

Truncated searches are **not** recorded in the coverage cache — neither the ones
Google capped at 60 nor the ones the budget cut short. That is what makes
"re-run deeper" work: the re-run goes back into exactly those cells and pays
only for them, instead of skipping them as already covered.

## Logs

Every scrape spends money, so failures are written down rather than left in a
terminal you've already closed. Structured JSONL, one object per line, in
`data/logs/app-YYYY-MM-DD.jsonl`, kept 7 days.

```bash
npm run logs                    # today, info and above
npm run logs -- --errors        # only warnings and errors
npm run logs -- --job 4         # one scrape, start to finish
npm run logs -- --spend         # per-job request and cost summary
npm run logs -- --scope places  # just the API layer
npm run logs -- --level debug   # every request, with timings
npm run logs -- --json | jq ... # raw, for anything else
```

Two lines carry most of the value. `job.finished` is the post-mortem — requests,
cost, businesses, leads, results-per-request, saturated cells, dropped types.
`request.failed` records the HTTP status *and* Google's own error code, which is
what distinguishes an unenabled API from a billing problem from a bad key
restriction.

Spend is on every line that involves the API, including failures — a job that
dies halfway has still been billed for what it sent.

**The API key is never written.** It's stripped by exact match, by an
`AIza…`-shaped pattern, and by field name, including inside error messages and
stack traces where a key can hide in a URL. This is enforced by tests.

Writes are synchronous and the logger never throws: a job that gets killed still
leaves the lines explaining why, and a read-only log directory can't take down a
paid scrape.

Levels are controlled by `LOG_LEVEL` (`debug`/`info`/`warn`/`error`), the
location by `LOG_DIR`, and console mirroring by `LOG_CONSOLE=0`.

## Commands

| | |
|---|---|
| `npm run dev` | Start the app |
| `npm run logs` | Read the structured logs (see above) |
| `npm test` | Unit + integration tests |
| `npm run typecheck` | Generate route types, then typecheck |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run seed:demo` | Fill the database with fake leads to click around |
| `npm run db:generate` | Regenerate migrations after editing the schema |
| `npm run db:studio` | Browse the database in Drizzle Studio |

## Layout

```
src/
├── app/                    Pages and API routes
├── components/             Dashboard UI
├── config/
│   ├── areas.ts            Cities + all 21 Madrid districts
│   ├── categories.ts       ~40 category presets → Places types
│   └── domains.ts          Social / marketplace / builder domain lists
└── lib/
    ├── places/             Text Search client: field mask, paging, backoff
    ├── scrape/             Grid tiling, cost model, job runner
    ├── leads/              Classifier, scoring, queries, outreach templates
    └── db/                 Drizzle schema, Postgres connection, backups
```

## Tests

```bash
npm test
```

Covers the parts where being wrong is expensive:

- **Grid coverage** — 45,000 sampled points across several area/cell sizes must each fall
  inside some cell, including the outer edge, where a naive lattice leaves gaps
- **Subdivision** — children still cover the parent; recursion terminates
- **Classifier** — every domain category, plus the traps (`m.facebook.com` matches,
  `notfacebook.com` does not)
- **Scoring** — ordering, the low-review-count guard, the 0–100 bounds
- **The runner end to end** — with the Places API stubbed: leads created only for
  businesses without a real site, deduplication on re-scrape, saturated cells subdividing,
  the budget cap stopping a job, API errors recorded, and the `includedType` fallback

No API key or network access needed — nothing in the suite spends money.

## Notes

- Jobs run inside the Next.js server process. If you restart it mid-scrape, the job is
  marked `interrupted` on the next boot rather than leaving a progress bar stuck forever.
- One scrape at a time, so the budget and the progress bar stay meaningful.
- `websiteUri` reflects what the owner put on their Google profile. A business may have a
  site that isn't linked there — which, for your purposes, is still a lead, since an
  unlinked site is nearly as invisible as no site.
