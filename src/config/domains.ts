/**
 * Domain lists that drive the "does this business actually have a website?"
 * decision. Spanish platforms are included by default because Madrid is the
 * first target area. These are overridable from the Settings page.
 *
 * Matching is on the registrable host and any subdomain of it, so `facebook.com`
 * also matches `m.facebook.com` and `es-es.facebook.com`.
 */

/** Social profiles and link-in-bio pages. Not a website you can be found on. */
export const SOCIAL_DOMAINS = [
  "facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "instagr.am",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "bio.link",
  "campsite.bio",
  "wa.me",
  "whatsapp.com",
  "t.me",
  "telegram.me",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "pinterest.es",
  "linkedin.com",
  "snapchat.com",
  "threads.net",
  "threads.com",
  "vk.com",
];

/**
 * Google's own hosted pages. Google discontinued Business Profile websites in
 * 2024 and those URLs now just bounce to the Maps listing, so a business
 * pointing here effectively has nothing.
 */
export const GOOGLE_SITE_DOMAINS = [
  "business.site",
  "negocio.site",
  "sites.google.com",
  "goo.gl",
  "maps.app.goo.gl",
  "google.com",
  "g.page",
];

/**
 * Marketplaces, booking platforms and directories. The business is listed on
 * someone else's property and pays for the privilege — a strong pitch angle.
 */
export const AGGREGATOR_DOMAINS = [
  // Food delivery / reservations
  "glovoapp.com",
  "glovo.es",
  "ubereats.com",
  "deliveroo.es",
  "deliveroo.co.uk",
  "just-eat.es",
  "justeat.es",
  "thefork.es",
  "thefork.com",
  "eltenedor.es",
  "opentable.com",
  "resy.com",
  "covermanager.com",
  "restaurantes.com",
  // Reviews / directories
  "tripadvisor.com",
  "tripadvisor.es",
  "yelp.com",
  "yelp.es",
  "paginasamarillas.es",
  "11870.com",
  "infoisinfo.es",
  "cylex.es",
  "milanuncios.com",
  // Beauty / wellness booking
  "treatwell.es",
  "treatwell.com",
  "fresha.com",
  "planity.com",
  "booksy.com",
  "uala.es",
  // Health
  "doctoralia.es",
  "topdoctors.es",
  "mifisio.es",
  // Travel / property
  "booking.com",
  "airbnb.com",
  "airbnb.es",
  "idealista.com",
  "fotocasa.es",
  "habitaclia.com",
  "pisos.com",
  // Trades / services marketplaces
  "habitissimo.es",
  "cronoshare.com",
  "wallapop.com",
];

/**
 * Free website-builder subdomains. These are real sites, but on rented
 * addresses with weak SEO — a softer lead ("let's move you to your own domain"),
 * scored lower than the others.
 */
export const BUILDER_SUBDOMAIN_DOMAINS = [
  "wixsite.com",
  "weebly.com",
  "blogspot.com",
  "wordpress.com",
  "myshopify.com",
  "square.site",
  "squarespace.com",
  "webnode.es",
  "jimdosite.com",
  "jimdo.com",
  "webador.es",
  "godaddysites.com",
  "site123.me",
  "strikingly.com",
  "carrd.co",
  "netlify.app",
  "vercel.app",
  "github.io",
];
