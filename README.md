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

Runs entirely on your machine. Your API key and lead data never leave it.

---

## Setup

```bash
npm install
cp .env.example .env.local     # then paste your Google Maps API key in
npm run dev                    # http://localhost:3000
```

The SQLite database is created and migrated automatically on first run at
`data/leads.db`.

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
API. Delete `data/leads.db` to start clean.

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

In practice a single district with a handful of categories runs 100–250 requests, so most
months land inside the free tier. Some real numbers from the built-in areas:

| Sweep | Cells | Requests (est.) | Cost |
|---|---|---|---|
| Madrid · Centro, 3 categories, 500 m cells | 25 | 75–120 | $2.63–$4.20 |
| Madrid · Centro, 6 categories, 800 m cells | 13 | 78–125 | $2.73–$4.38 |
| Madrid whole city, 6 categories, 1.5 km cells | 69 | 414–663 | $14.49–$23.21 |

All three are under the 1,000 free monthly requests, so on a fresh month they cost nothing.

**Three guards keep this honest:**

1. **Estimate before you run.** The Scrape page prices the sweep without calling the API.
2. **Hard budget cap.** Every job carries a maximum request count. It stops cleanly there
   and keeps everything it found.
3. **Free-tier meter.** The Overview shows requests used this month against the free 1,000.

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

## Commands

| | |
|---|---|
| `npm run dev` | Start the app |
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
    └── db/                 Drizzle schema + SQLite connection
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
