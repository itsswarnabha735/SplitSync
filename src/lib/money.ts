export function toCurrencyCents(amount: number): number {
  return Math.round(amount * 100);
}

export function centsToMoney(cents: number): number {
  return cents / 100;
}

export function parseMoneyInputToCents(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;

  const cents = toCurrencyCents(amount);
  return cents > 0 ? cents : null;
}
