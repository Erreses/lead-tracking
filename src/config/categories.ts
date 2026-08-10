/**
 * Business categories to sweep, biased toward trades, food and small retail —
 * the segments where missing or neglected websites are most common.
 *
 * `textQuery` is the Spanish search term sent to Google (it matches how owners
 * actually label themselves). `includedType` is an optional Places API "Table A"
 * type that narrows results further; the scraper retries without it if Google
 * rejects the value, so an unrecognised type degrades to a plain text search
 * rather than failing the job.
 */

export type Category = {
  slug: string;
  label: string;
  textQuery: string;
  includedType?: string;
  group: "food" | "beauty" | "trades" | "health" | "retail" | "services";
};

export const CATEGORIES: Category[] = [
  // Food & drink
  { slug: "restaurante", label: "Restaurante", textQuery: "restaurante", includedType: "restaurant", group: "food" },
  { slug: "bar", label: "Bar", textQuery: "bar", includedType: "bar", group: "food" },
  { slug: "cafeteria", label: "Cafetería", textQuery: "cafetería", includedType: "cafe", group: "food" },
  { slug: "panaderia", label: "Panadería", textQuery: "panadería", includedType: "bakery", group: "food" },
  { slug: "pasteleria", label: "Pastelería", textQuery: "pastelería", group: "food" },
  { slug: "carniceria", label: "Carnicería", textQuery: "carnicería", group: "food" },
  { slug: "fruteria", label: "Frutería", textQuery: "frutería", group: "food" },

  // Beauty & wellness
  { slug: "peluqueria", label: "Peluquería", textQuery: "peluquería", includedType: "hair_salon", group: "beauty" },
  { slug: "barberia", label: "Barbería", textQuery: "barbería", includedType: "barber_shop", group: "beauty" },
  { slug: "estetica", label: "Centro de estética", textQuery: "centro de estética", includedType: "beauty_salon", group: "beauty" },
  { slug: "unas", label: "Salón de uñas", textQuery: "salón de uñas", includedType: "nail_salon", group: "beauty" },
  { slug: "tatuajes", label: "Estudio de tatuajes", textQuery: "estudio de tatuajes", group: "beauty" },
  { slug: "gimnasio", label: "Gimnasio", textQuery: "gimnasio", includedType: "gym", group: "beauty" },

  // Trades — usually the best targets
  { slug: "fontanero", label: "Fontanero", textQuery: "fontanero", includedType: "plumber", group: "trades" },
  { slug: "electricista", label: "Electricista", textQuery: "electricista", includedType: "electrician", group: "trades" },
  { slug: "cerrajero", label: "Cerrajero", textQuery: "cerrajero", includedType: "locksmith", group: "trades" },
  { slug: "pintor", label: "Pintor", textQuery: "pintor decorador", includedType: "painter", group: "trades" },
  { slug: "reformas", label: "Empresa de reformas", textQuery: "empresa de reformas", group: "trades" },
  { slug: "carpintero", label: "Carpintería", textQuery: "carpintería", group: "trades" },
  { slug: "taller", label: "Taller mecánico", textQuery: "taller mecánico", includedType: "car_repair", group: "trades" },
  { slug: "mudanzas", label: "Mudanzas", textQuery: "empresa de mudanzas", includedType: "moving_company", group: "trades" },

  // Health
  { slug: "dentista", label: "Clínica dental", textQuery: "clínica dental", includedType: "dentist", group: "health" },
  { slug: "fisioterapia", label: "Fisioterapeuta", textQuery: "fisioterapeuta", includedType: "physiotherapist", group: "health" },
  { slug: "veterinario", label: "Veterinario", textQuery: "clínica veterinaria", includedType: "veterinary_care", group: "health" },
  { slug: "optica", label: "Óptica", textQuery: "óptica", group: "health" },
  { slug: "podologo", label: "Podólogo", textQuery: "podólogo", group: "health" },

  // Retail
  { slug: "floristeria", label: "Floristería", textQuery: "floristería", includedType: "florist", group: "retail" },
  { slug: "ferreteria", label: "Ferretería", textQuery: "ferretería", includedType: "hardware_store", group: "retail" },
  { slug: "ropa", label: "Tienda de ropa", textQuery: "tienda de ropa", includedType: "clothing_store", group: "retail" },
  { slug: "zapateria", label: "Zapatería", textQuery: "zapatería", includedType: "shoe_store", group: "retail" },
  { slug: "joyeria", label: "Joyería", textQuery: "joyería", includedType: "jewelry_store", group: "retail" },
  { slug: "mascotas", label: "Tienda de mascotas", textQuery: "tienda de mascotas", includedType: "pet_store", group: "retail" },
  { slug: "muebles", label: "Tienda de muebles", textQuery: "tienda de muebles", includedType: "furniture_store", group: "retail" },
  { slug: "bicicletas", label: "Tienda de bicicletas", textQuery: "tienda de bicicletas", includedType: "bicycle_store", group: "retail" },

  // Professional services
  { slug: "inmobiliaria", label: "Inmobiliaria", textQuery: "inmobiliaria", includedType: "real_estate_agency", group: "services" },
  { slug: "gestoria", label: "Gestoría / asesoría", textQuery: "gestoría asesoría", includedType: "accounting", group: "services" },
  { slug: "abogado", label: "Abogado", textQuery: "abogado", includedType: "lawyer", group: "services" },
  { slug: "autoescuela", label: "Autoescuela", textQuery: "autoescuela", group: "services" },
  { slug: "tintoreria", label: "Tintorería / lavandería", textQuery: "tintorería", includedType: "laundry", group: "services" },
  { slug: "academia", label: "Academia / clases", textQuery: "academia de clases particulares", group: "services" },
  { slug: "seguros", label: "Correduría de seguros", textQuery: "correduría de seguros", includedType: "insurance_agency", group: "services" },
  { slug: "viajes", label: "Agencia de viajes", textQuery: "agencia de viajes", includedType: "travel_agency", group: "services" },
];

export const CATEGORIES_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const CATEGORY_GROUPS: Record<Category["group"], string> = {
  food: "Hostelería y alimentación",
  beauty: "Belleza y bienestar",
  trades: "Oficios y reformas",
  health: "Salud",
  retail: "Comercio",
  services: "Servicios profesionales",
};

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES_BY_SLUG.get(slug);
}
