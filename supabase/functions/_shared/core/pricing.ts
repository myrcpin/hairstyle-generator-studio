export type Currency = "GBP" | "USD";
export const SUPPORTED_CURRENCIES: Currency[] = ["GBP", "USD"];

/** Best-effort currency choice from browser locale/time zone. User can always switch. */
export function currencyForLocale(locale: string | undefined, timeZone?: string): Currency {
  const l = (locale ?? "").toLowerCase();
  if (l.endsWith("-gb") || l === "en-gb" || timeZone === "Europe/London") return "GBP";
  if (l.endsWith("-us") || (timeZone ?? "").startsWith("America/")) return "USD";
  return "GBP";
}

export function formatPrice(amount: string | number, currency: Currency): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat(currency === "GBP" ? "en-GB" : "en-US", { style: "currency", currency }).format(n);
}

export function isCurrency(v: unknown): v is Currency {
  return v === "GBP" || v === "USD";
}
