/**
 * Currency helpers. The Android UI repeated this symbol map across every
 * screen; here it lives in one place.
 */

export const SUPPORTED_CURRENCIES = [
  { code: "USD", label: "USD ($)", symbol: "$" },
  { code: "EUR", label: "EUR (€)", symbol: "€" },
  { code: "GBP", label: "GBP (£)", symbol: "£" },
  { code: "INR", label: "INR (₹)", symbol: "₹" },
  { code: "JPY", label: "JPY (¥)", symbol: "¥" },
  { code: "CAD", label: "CAD (C$)", symbol: "C$" },
  { code: "AUD", label: "AUD (A$)", symbol: "A$" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

const SYMBOL_MAP: Record<string, string> = SUPPORTED_CURRENCIES.reduce(
  (acc, c) => {
    acc[c.code] = c.symbol;
    return acc;
  },
  {} as Record<string, string>
);

export function currencySymbol(code: string): string {
  return SYMBOL_MAP[code] ?? "$";
}

export function currencyName(code: string): string {
  const names: Record<string, string> = {
    USD: "US Dollar (USD)",
    EUR: "Euro (EUR)",
    GBP: "British Pound (GBP)",
    INR: "Indian Rupee (INR)",
    JPY: "Japanese Yen (JPY)",
    CAD: "Canadian Dollar (CAD)",
    AUD: "Australian Dollar (AUD)",
  };
  return names[code] ?? code;
}

/** Formats an amount with its currency symbol, e.g. "$12.50". */
export function formatMoney(amount: number, code: string): string {
  return `${currencySymbol(code)}${amount.toFixed(2)}`;
}
