/**
 * Fills the database with fake Madrid leads so you can click through the
 * dashboard before spending any Places API quota.
 *
 *   npm run seed:demo          # add demo rows
 *   npm run seed:demo -- --reset   # wipe everything first
 *
 * Demo rows are marked with an area name starting "DEMO ·" so they're easy to
 * spot and filter out. Never point this at a database with real leads in it.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  businesses,
  leadEvents,
  leads,
  scrapeJobs,
  type LeadStatus,
} from "@/lib/db/schema";
import { classifyWebsite, scoreLead } from "@/lib/leads/classify";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "leads.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

if (process.argv.includes("--reset")) {
  db.delete(leadEvents).run();
  db.delete(leads).run();
  db.delete(businesses).run();
  db.delete(scrapeJobs).run();
  console.log("Cleared existing rows.");
}

const NAMES: Record<string, string[]> = {
  peluqueria: ["Peluquería Lola", "Estilo Chamberí", "Peluquería Manoli", "Corte y Color"],
  barberia: ["Barbería Ramón", "The Barber Malasaña", "Navaja y Tijera"],
  restaurante: ["Casa Paco", "El Rincón de Ana", "Taberna La Latina", "Bar Manolo"],
  fontanero: ["Fontanería Hnos. García", "Urgencias Agua Madrid"],
  dentista: ["Clínica Dental Sonrisa", "Dental Salamanca"],
  floristeria: ["Flores Carmen", "La Rosaleda"],
  taller: ["Talleres Vallecas", "Auto Reparación Centro"],
  veterinario: ["Clínica Veterinaria Patitas"],
};

const WEBSITES = [
  null,
  null,
  null,
  "https://www.facebook.com/negocio",
  "https://minegocio.business.site",
  "https://glovoapp.com/es/madrid/negocio",
  "https://instagram.com/minegocio",
  "https://minegocio.wixsite.com/inicio",
  "https://www.negocioconweb.es",
];

const AREAS = ["DEMO · Madrid · Centro", "DEMO · Madrid · Chamberí", "DEMO · Madrid · Salamanca"];
const STATUSES: LeadStatus[] = [
  "new",
  "new",
  "new",
  "new",
  "qualified",
  "qualified",
  "demo_built",
  "contacted",
  "contacted",
  "negotiating",
  "won",
  "lost",
];

// Deterministic pseudo-random so repeated seeds produce the same demo set.
let seed = 20260810;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(list: T[]): T => list[Math.floor(random() * list.length)];

let created = 0;
let leadCount = 0;

for (const [category, names] of Object.entries(NAMES)) {
  for (const name of names) {
    for (let variant = 0; variant < 3; variant++) {
      const websiteUri = pick(WEBSITES);
      const { websiteClass, host } = classifyWebsite(websiteUri);
      const rating = Math.round((3.2 + random() * 1.8) * 10) / 10;
      const userRatingCount = Math.floor(random() * 400);
      const phone = random() > 0.2 ? `9${Math.floor(10_000_000 + random() * 89_999_999)}` : null;
      const areaName = pick(AREAS);

      const placeId = `demo_${category}_${created}`;
      const inserted = db
        .insert(businesses)
        .values({
          placeId,
          name: variant === 0 ? name : `${name} ${variant + 1}`,
          address: `Calle Demo ${Math.floor(random() * 120) + 1}, Madrid`,
          lat: 40.41 + random() * 0.04,
          lng: -3.71 + random() * 0.04,
          types: JSON.stringify([category]),
          primaryCategory: category,
          phone,
          websiteUri,
          websiteHost: host,
          rating,
          userRatingCount,
          businessStatus: "OPERATIONAL",
          websiteClass,
          leadScore: scoreLead({
            websiteClass,
            rating,
            userRatingCount,
            phone,
            businessStatus: "OPERATIONAL",
          }),
          areaName,
        })
        .onConflictDoNothing()
        .returning({ id: businesses.id })
        .get();

      created++;
      if (!inserted || websiteClass === "has_website") continue;

      const status = pick(STATUSES);
      const quoted = ["demo_built", "contacted", "negotiating", "won", "lost"].includes(status);

      const lead = db
        .insert(leads)
        .values({
          businessId: inserted.id,
          status,
          quoteAmount: quoted ? [350, 450, 600, 750][Math.floor(random() * 4)] : null,
          demoUrl: quoted ? `https://demo.example.com/${placeId}` : null,
          notes: status === "negotiating" ? "Quiere ver otro diseño antes de decidir." : null,
        })
        .returning({ id: leads.id })
        .get();

      db.insert(leadEvents)
        .values({
          leadId: lead.id,
          type: "created",
          message: `Found in ${areaName} while searching "${category}".`,
        })
        .run();

      leadCount++;
    }
  }
}

db.insert(scrapeJobs)
  .values({
    areaName: "DEMO · Madrid · Centro",
    params: JSON.stringify({ demo: true }),
    status: "completed",
    cellsTotal: 25,
    cellsDone: 25,
    requestsMade: 41,
    estimatedCostUsd: 1.435,
    businessesFound: created,
    newBusinesses: created,
    leadsCreated: leadCount,
    startedAt: new Date(Date.now() - 240_000),
    finishedAt: new Date(),
  })
  .run();

console.log(`Seeded ${created} demo businesses and ${leadCount} demo leads.`);
console.log('They are tagged "DEMO ·" in the area column. Re-run with --reset to clear.');
console.log("");
console.log("This script only fills the database — it does not start the app.");
console.log("Next:  npm run dev     then open http://localhost:3000");
