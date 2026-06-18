import { formatMoney } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Renders a map of currency -> amount. Used for the multi-currency
 * "you are owed" / "you owe" / net summaries.
 */
export function CurrencyTotals({
  totals,
  className,
  emptyLabel = "—",
  signed = false,
}: {
  totals: Record<string, number>;
  className?: string;
  emptyLabel?: string;
  signed?: boolean;
}) {
  const entries = Object.entries(totals).filter(([, v]) => Math.abs(v) > 0.001);
  if (entries.length === 0) {
    return <span className={className}>{emptyLabel}</span>;
  }
  return (
    <span className={cn("flex flex-wrap gap-x-3", className)}>
      {entries.map(([code, amount]) => (
        <span key={code}>
          {signed && amount > 0 ? "+" : ""}
          {formatMoney(amount, code)}
        </span>
      ))}
    </span>
  );
}
