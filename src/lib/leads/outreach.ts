/**
 * Outreach message rendering. Templates are plain text with `{{placeholder}}`
 * slots, editable from the Settings page.
 *
 * Defaults are in Spanish because the first target area is Madrid, and they lead
 * with the demo link rather than the price — the pitch is "look what I already
 * built for you", not a cold quote.
 */

export const TEMPLATE_VARIABLES = [
  "business_name",
  "category",
  "area",
  "demo_url",
  "quote",
  "my_name",
  "my_phone",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string>>;

export const DEFAULT_EMAIL_SUBJECT = "Una web para {{business_name}}";

export const DEFAULT_EMAIL_TEMPLATE = `Hola,

Soy {{my_name}}. He visto la ficha de {{business_name}} en Google Maps y me he dado cuenta de que no tenéis web propia, así que quien os busca solo encuentra la ficha.

Le he montado una demo para que veáis cómo quedaría:
{{demo_url}}

Si os encaja, la dejo publicada con vuestro dominio por {{quote}}. Incluye diseño, textos, vuestras fotos y que se vea bien en el móvil.

¿Le echáis un vistazo y me decís qué os parece?

Un saludo,
{{my_name}}
{{my_phone}}`;

export const DEFAULT_WHATSAPP_TEMPLATE = `Hola! Soy {{my_name}}. He visto que {{business_name}} no tiene web propia, solo la ficha de Google. Os he preparado una demo para que la veáis: {{demo_url}} — si os encaja, la dejo publicada por {{quote}}. ¿La miráis y me decís?`;

/** Replace `{{var}}` slots. Unknown or unset variables are left visible so you can spot gaps before sending. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name as TemplateVariable];
    return value != null && value !== "" ? value : match;
  });
}

/** Which placeholders are still unfilled, so the UI can warn before you send. */
export function missingVariables(template: string, vars: TemplateVars): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    const name = match[1] as TemplateVariable;
    if (!vars[name]) found.add(name);
  }
  return [...found];
}

/**
 * Digits only, in the form wa.me expects. Spanish nine-digit numbers get the 34
 * country code added; anything already carrying a country code is left alone.
 */
export function normalizePhone(
  phone: string | null | undefined,
  defaultCountryCode = "34",
): string | null {
  if (!phone) return null;

  const hadPlus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (hadPlus) return digits;
  if (digits.startsWith("00")) return digits.slice(2);
  // Spanish national numbers are nine digits and never start with a zero.
  if (digits.length === 9) return `${defaultCountryCode}${digits}`;

  return digits;
}

export function whatsappLink(
  phone: string | null | undefined,
  message: string,
): string | null {
  const number = normalizePhone(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function mailtoLink(subject: string, body: string, to = ""): string {
  const params = new URLSearchParams({ subject, body });
  // URLSearchParams encodes spaces as "+", which mail clients render literally.
  return `mailto:${to}?${params.toString().replace(/\+/g, "%20")}`;
}

export function formatQuote(amount: number | null | undefined, currency = "EUR"): string {
  if (amount == null) return "";
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
