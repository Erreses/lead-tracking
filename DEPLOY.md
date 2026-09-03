# Deploying to Coolify

The VPS runs two containers: the dashboard, and a Postgres that is never
published. You and your partner both open the same URL and sign in with one
shared password. Nobody needs the repo, Node, or a database client.

```
  browser ──HTTPS──▶ Coolify proxy ──▶ app :3000 ──▶ postgres :5432
                                                     (private network only)
```

Postgres is published only to the VPS's own loopback interface, never to its
public one. From the internet there is no route to your leads except through the
app, behind its password; from an SSH session on the box there is, which is what
makes local development against the real data possible.

---

## 1. Push the branch

Coolify deploys from Git, so the code has to be somewhere it can reach.

```bash
git push -u origin claude/google-maps-scraper-dashboard-3w3qto
```

A private repo is fine — you will connect it with a deploy key or the GitHub App
in the next step.

## 2. Create the resource

In Coolify: **Project → New Resource → Docker Compose**.

- **Source**: your repository, branch as above
- **Compose file**: `docker-compose.yml`
- **Build pack**: Docker Compose

Coolify reads the compose file and finds two services, `app` and `postgres`.

## 3. Set the environment variables

Under the resource's **Environment Variables**, add:

| Name | Value |
| --- | --- |
| `APP_ACCESS_PASSWORD` | the shared password — generate one, don't invent it |
| `GOOGLE_MAPS_API_KEY` | the same key from your local `.env.local` |

Generate the password with:

```bash
openssl rand -base64 24
```

Two more are handled for you and should **not** be added by hand:

- `SERVICE_PASSWORD_POSTGRES` — Coolify generates the database password on the
  first deploy and reuses it afterwards.
- `SERVICE_FQDN_APP_3000` — Coolify allocates the domain and points its proxy at
  port 3000.

The app refuses to serve at all if `APP_ACCESS_PASSWORD` is missing, and says so
on the page rather than in a log file. That is deliberate: a public URL should
never be able to end up unprotected by accident.

## 4. Deploy

Hit **Deploy**. The first build takes a few minutes; later ones reuse layers.

On start the container runs the pending migrations itself, behind a Postgres
advisory lock so two containers overlapping during a redeploy can't both apply
them. If migrations fail the container exits rather than serving against a
schema it doesn't understand, and Coolify keeps the previous deployment up.

Check it is alive:

```bash
curl https://your-domain/api/health     # {"status":"ok"}
```

That endpoint is intentionally reachable without signing in — Docker's health
check has no password to present — and reports nothing but up or down.

## 5. Move your existing data across

The VPS starts with an empty database. Your 2,012 businesses and 808 leads are
in local Postgres.

```bash
# 1. Dump locally.
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file=leads-local.dump

# 2. Open a tunnel to the VPS database. Leave it running.
ssh -N -L 5433:localhost:5432 root@your-vps

# 3. In another terminal, restore through it. The password is the generated
#    SERVICE_PASSWORD_POSTGRES, visible in the resource's environment in Coolify.
REMOTE="postgres://lead_tracking:<password>@localhost:5433/lead_tracking"
pg_restore --dbname="$REMOTE" --no-owner --no-privileges \
  --data-only --disable-triggers --exclude-schema=drizzle \
  leads-local.dump
```

Every flag on that last command is load-bearing:

- **`--data-only`** — the container already created the schema when it ran
  migrations at startup, so this copies rows into tables that exist rather than
  trying to create them again.
- **`--disable-triggers`** — a data-only restore loads tables in alphabetical
  order, which puts `lead_events` before the `leads` rows it references. Without
  this, every event fails its foreign key and `pg_restore` reports it as a
  warning it "ignored" — you end up with businesses and leads intact and the
  entire history silently missing.
- **`--exclude-schema=drizzle`** — the migration bookkeeping already has its own
  row from startup, and restoring a second one over it conflicts.

Afterwards, check the counts match what you had:

```bash
psql "$REMOTE" -c "select
  (select count(*) from businesses)    as businesses,
  (select count(*) from leads)         as leads,
  (select count(*) from lead_events)   as events,
  (select count(*) from cell_coverage) as coverage;"
```

Against the current local database that is 2012 / 808 / 808 / 145. Check the
events and coverage numbers, not just the first two: events are what the
foreign-key trap above would have quietly dropped, and coverage is what stops a
re-run paying Google again for areas you have already swept.

Confirm the id sequences came across too, or the first new business inserted
will collide with an existing row:

```bash
psql "$REMOTE" -c "select last_value from businesses_id_seq;"   # 2012
```

> **Version note.** The VPS runs Postgres 17; your Mac has 14. Dumping from 14
> and restoring into 17 is fine — that direction always works. Going the other
> way is not: to restore a *VPS* backup locally you need version 17 client
> tools, `brew install postgresql@17`.

## 6. Give your partner access

Send them the URL and the password. That is the whole setup — no repo, no Node,
no `.env` file. Sessions last 30 days, and changing `APP_ACCESS_PASSWORD` in
Coolify signs everyone out immediately.

---

## Backups

The app snapshots the database with `pg_dump` before every scrape, keeping the
last three in the `lead-tracking-data` volume. A scrape is the only thing that
writes leads in bulk, so it is the only moment worth guarding against.

To pull one down:

```bash
ssh root@your-vps
docker exec <app-container> ls -la /app/data/backups
docker cp <app-container>:/app/data/backups/leads-....dump /tmp/
# then scp it to your machine
```

The volume survives redeploys. It does **not** survive deleting the resource in
Coolify, so keep a copy elsewhere if a run matters.

## Logs

Structured JSONL, one line per event, with the API key redacted three different
ways before anything is written.

```bash
docker exec <app-container> tail -f /app/data/logs/app-$(date +%F).jsonl
```

Or use Coolify's log viewer for stdout.

---

## Running locally against the VPS data

The database is bound to the VPS's loopback interface, so nothing off that
machine can reach it. An SSH tunnel can, and you already need a key for that:

```bash
# Leave this running in one terminal.
ssh -N -L 5433:localhost:5432 root@your-vps
```

With the tunnel up, point your local app at it:

```bash
DATABASE_URL="postgres://lead_tracking:<password>@localhost:5433/lead_tracking" npm run dev
```

Get `<password>` from the resource's environment in Coolify — it is the
generated `SERVICE_PASSWORD_POSTGRES`.

Be aware this is the live database. There is no staging copy; a `DELETE` here is
a `DELETE` there.

---

## Local development, unchanged

Nothing above affects day-to-day work. With no `APP_ACCESS_PASSWORD` set, the
login screen is skipped entirely:

```bash
npm run dev
```

If you want a throwaway Postgres in Docker instead of the Homebrew one:

```bash
docker compose -f docker-compose.dev.yml up -d
```

## Environment variables in full

| Name | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | both | Postgres connection string. Required. |
| `APP_ACCESS_PASSWORD` | VPS | Shared login password. Required in production. |
| `GOOGLE_MAPS_API_KEY` | both | Places API key. Only needed to run a scrape. |
| `DATABASE_SSL` | optional | `require` / `disable`. Defaults by host. |
| `COOKIE_SECURE` | optional | Override the Secure cookie flag. See below. |
| `LOG_LEVEL` | optional | `debug` / `info` / `warn` / `error`. Defaults to `info`. |
| `MAX_BACKUPS` | optional | Snapshots to keep. Defaults to 3. |
| `BACKUP_DIR` | optional | Defaults to `./data/backups`. |

`COOKIE_SECURE` exists for one specific failure: reaching the deployment over
plain HTTP — a raw IP, or a domain before its certificate is issued. The browser
accepts a Secure cookie and then refuses to send it back, so every login bounces
straight back to the login page with no error shown. Setting it to `false` gets
you in; turn it off again once HTTPS is working.

## Troubleshooting

**The page says `APP_ACCESS_PASSWORD is not set`.** Exactly what it says — add it
in Coolify and redeploy. This is the fail-closed path, not a bug.

**Login loops back to the login page with no error.** The session cookie isn't
coming back. Almost always plain HTTP; see `COOKIE_SECURE` above.

**The container restarts repeatedly.** Migrations are failing. `docker logs` on
the app container shows the SQL error. The previous deployment keeps serving
while this is true.

**A scrape reports the backup failed but ran anyway.** `pg_dump` couldn't reach
the database. The scrape is allowed to continue on purpose — it adds data rather
than destroying it — but fix this before relying on the snapshots.
