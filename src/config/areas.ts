/**
 * Search areas. An area is a centre point plus a radius in metres; the scraper
 * tiles it into cells (see `src/lib/scrape/grid.ts`).
 *
 * Madrid is broken into its 21 districts as well as a whole-city preset, so you
 * can work one neighbourhood at a time instead of paying to sweep the entire
 * city in one go.
 */

export type Area = {
  slug: string;
  label: string;
  lat: number;
  lng: number;
  /** Radius in metres. */
  radius: number;
  parent?: string;
};

export const AREAS: Area[] = [
  // Whole cities
  { slug: "madrid", label: "Madrid (whole city)", lat: 40.4168, lng: -3.7038, radius: 8000 },
  { slug: "barcelona", label: "Barcelona", lat: 41.3874, lng: 2.1686, radius: 6000 },
  { slug: "valencia", label: "Valencia", lat: 39.4699, lng: -0.3763, radius: 5000 },
  { slug: "sevilla", label: "Sevilla", lat: 37.3891, lng: -5.9845, radius: 5000 },
  { slug: "malaga", label: "Málaga", lat: 36.7213, lng: -4.4214, radius: 4500 },
  { slug: "zaragoza", label: "Zaragoza", lat: 41.6488, lng: -0.8891, radius: 4500 },
  { slug: "bilbao", label: "Bilbao", lat: 43.263, lng: -2.935, radius: 4000 },
  { slug: "murcia", label: "Murcia", lat: 37.9922, lng: -1.1307, radius: 4000 },
  { slug: "palma", label: "Palma de Mallorca", lat: 39.5696, lng: 2.6502, radius: 4000 },
  { slug: "alicante", label: "Alicante", lat: 38.3452, lng: -0.4815, radius: 4000 },

  // Madrid districts — cheaper, more targeted sweeps
  { slug: "madrid-centro", label: "Madrid · Centro", lat: 40.4155, lng: -3.7074, radius: 1500, parent: "madrid" },
  { slug: "madrid-salamanca", label: "Madrid · Salamanca", lat: 40.43, lng: -3.678, radius: 1300, parent: "madrid" },
  { slug: "madrid-chamberi", label: "Madrid · Chamberí", lat: 40.436, lng: -3.703, radius: 1200, parent: "madrid" },
  { slug: "madrid-retiro", label: "Madrid · Retiro", lat: 40.41, lng: -3.68, radius: 1500, parent: "madrid" },
  { slug: "madrid-arganzuela", label: "Madrid · Arganzuela", lat: 40.395, lng: -3.695, radius: 1600, parent: "madrid" },
  { slug: "madrid-chamartin", label: "Madrid · Chamartín", lat: 40.46, lng: -3.68, radius: 1800, parent: "madrid" },
  { slug: "madrid-tetuan", label: "Madrid · Tetuán", lat: 40.46, lng: -3.7, radius: 1500, parent: "madrid" },
  { slug: "madrid-moncloa", label: "Madrid · Moncloa-Aravaca", lat: 40.435, lng: -3.735, radius: 2000, parent: "madrid" },
  { slug: "madrid-latina", label: "Madrid · Latina", lat: 40.39, lng: -3.745, radius: 2200, parent: "madrid" },
  { slug: "madrid-carabanchel", label: "Madrid · Carabanchel", lat: 40.38, lng: -3.73, radius: 2000, parent: "madrid" },
  { slug: "madrid-usera", label: "Madrid · Usera", lat: 40.38, lng: -3.705, radius: 1500, parent: "madrid" },
  { slug: "madrid-vallecas-puente", label: "Madrid · Puente de Vallecas", lat: 40.39, lng: -3.66, radius: 1800, parent: "madrid" },
  { slug: "madrid-moratalaz", label: "Madrid · Moratalaz", lat: 40.407, lng: -3.645, radius: 1400, parent: "madrid" },
  { slug: "madrid-ciudad-lineal", label: "Madrid · Ciudad Lineal", lat: 40.445, lng: -3.65, radius: 2000, parent: "madrid" },
  { slug: "madrid-hortaleza", label: "Madrid · Hortaleza", lat: 40.47, lng: -3.64, radius: 2200, parent: "madrid" },
  { slug: "madrid-villaverde", label: "Madrid · Villaverde", lat: 40.345, lng: -3.695, radius: 2000, parent: "madrid" },
  { slug: "madrid-san-blas", label: "Madrid · San Blas-Canillejas", lat: 40.43, lng: -3.61, radius: 2200, parent: "madrid" },
  { slug: "madrid-barajas", label: "Madrid · Barajas", lat: 40.47, lng: -3.58, radius: 2500, parent: "madrid" },
  { slug: "madrid-fuencarral", label: "Madrid · Fuencarral-El Pardo", lat: 40.49, lng: -3.71, radius: 2500, parent: "madrid" },
  { slug: "madrid-vicalvaro", label: "Madrid · Vicálvaro", lat: 40.405, lng: -3.6, radius: 2000, parent: "madrid" },
  { slug: "madrid-villa-vallecas", label: "Madrid · Villa de Vallecas", lat: 40.375, lng: -3.62, radius: 2200, parent: "madrid" },
];

export const AREAS_BY_SLUG = new Map(AREAS.map((a) => [a.slug, a]));

export function getArea(slug: string): Area | undefined {
  return AREAS_BY_SLUG.get(slug);
}
