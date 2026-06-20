"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CalendarDays, Receipt } from "lucide-react";

import {
  EXPENSE_CATEGORIES,
  getExpenseCategory,
  type ExpenseCategorySlug,
} from "@/lib/expense-categories";
import { formatMoney } from "@/lib/currency";
import {
  breakdownByCategory,
  breakdownByScope,
  filterSpendEntries,
  monthlySpendTrend,
  summarizeSpendByCurrency,
  type SpendEntry,
  type SpendEntryOrigin,
  type SpendEntrySource,
  type SpendFilters,
} from "@/lib/spend-analysis";
import { CurrencyTotals } from "@/components/currency-totals";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

interface SpendTabProps {
  entries: SpendEntry[];
  outstandingNet: Record<string, number>;
}

export function SpendTab({ entries, outstandingNet }: SpendTabProps) {
  const [filters, setFilters] = useState<SpendFilters>({
    category: "all",
    source: "all",
    origin: "all",
  });

  const currencies = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.currency))).sort(),
    [entries]
  );
  const scopes = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) map.set(entry.scopeId, entry.scopeName);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries]);

  const filtered = useMemo(
    () => filterSpendEntries(entries, filters),
    [entries, filters]
  );
  const summary = useMemo(() => summarizeSpendByCurrency(filtered), [filtered]);
  const categoryRows = useMemo(
    () => breakdownByCategory(filtered).slice(0, 8),
    [filtered]
  );
  const scopeRows = useMemo(
    () => breakdownByScope(filtered).slice(0, 8),
    [filtered]
  );
  const trendRows = useMemo(() => monthlySpendTrend(filtered), [filtered]);
  const largest = useMemo(
    () => [...filtered].sort((a, b) => b.myShare - a.myShare).slice(0, 6),
    [filtered]
  );
  const reviewRows = useMemo(
    () =>
      entries
        .filter((entry) => entry.origin === "imported" && entry.needsReview)
        .slice(0, 5),
    [entries]
  );
  const recentImported = useMemo(
    () => entries.filter((entry) => entry.origin === "imported").slice(0, 5),
    [entries]
  );

  function patch(next: Partial<SpendFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No spend to analyze"
        description="Add or import expenses to see personal spending patterns."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 border-primary/10 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="spend-start">From</Label>
            <Input
              id="spend-start"
              type="date"
              value={filters.startDate ?? ""}
              onChange={(event) => patch({ startDate: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spend-end">To</Label>
            <Input
              id="spend-end"
              type="date"
              value={filters.endDate ?? ""}
              onChange={(event) => patch({ endDate: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spend-currency">Currency</Label>
            <NativeSelect
              id="spend-currency"
              value={filters.currency ?? ""}
              onChange={(event) =>
                patch({ currency: event.target.value || undefined })
              }
            >
              <option value="">All currencies</option>
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="spend-category">Category</Label>
            <NativeSelect
              id="spend-category"
              value={filters.category ?? "all"}
              onChange={(event) =>
                patch({
                  category: event.target.value as ExpenseCategorySlug | "all",
                })
              }
            >
              <option value="all">All spend categories</option>
              {EXPENSE_CATEGORIES.filter((category) => category.kind === "spend").map(
                (category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                )
              )}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spend-source">Source</Label>
            <NativeSelect
              id="spend-source"
              value={filters.source ?? "all"}
              onChange={(event) =>
                patch({ source: event.target.value as SpendEntrySource | "all" })
              }
            >
              <option value="all">Groups and friends</option>
              <option value="group">Groups</option>
              <option value="friend">Friends</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spend-origin">Entry type</Label>
            <NativeSelect
              id="spend-origin"
              value={filters.origin ?? "all"}
              onChange={(event) =>
                patch({ origin: event.target.value as SpendEntryOrigin | "all" })
              }
            >
              <option value="all">Manual and imported</option>
              <option value="manual">Manual</option>
              <option value="imported">Imported</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="spend-scope">Group/Friend</Label>
            <NativeSelect
              id="spend-scope"
              value={filters.scopeId ?? ""}
              onChange={(event) =>
                patch({ scopeId: event.target.value || undefined })
              }
            >
              <option value="">All</option>
              {scopes.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No matching spend"
          description="Adjust the filters to include more expenses."
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Object.entries(summary).map(([currency, item]) => (
              <Card key={currency} className="border-primary/10 p-4">
                <p className="text-xs font-black uppercase text-muted-foreground">
                  My spend ({currency})
                </p>
                <p className="mt-2 text-2xl font-black">
                  {formatMoney(item.mySpend, currency)}
                </p>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Paid upfront {formatMoney(item.paidUpfront, currency)}</p>
                  <p>
                    Others paid for me{" "}
                    {formatMoney(item.othersPaidForMe, currency)}
                  </p>
                  <p>
                    {item.uncategorizedCount} uncategorized ·{" "}
                    {item.importedNeedsReviewCount} imported need review
                  </p>
                </div>
              </Card>
            ))}
            <Card className="border-primary/10 p-4">
              <p className="text-xs font-black uppercase text-muted-foreground">
                Outstanding net
              </p>
              <CurrencyTotals
                totals={outstandingNet}
                signed
                className="mt-2 text-2xl font-black"
                emptyLabel="All settled"
              />
            </Card>
          </div>

          {reviewRows.length > 0 && (
            <Card className="space-y-2 border-amber-300/50 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                Imported rows needing review
              </div>
              {reviewRows.map((entry) => (
                <SpendRow key={entry.id} entry={entry} compact />
              ))}
            </Card>
          )}

          {recentImported.length > 0 && (
            <Card className="space-y-2 border-primary/10 p-4">
              <h3 className="font-black">Recent imports</h3>
              {recentImported.map((entry) => (
                <SpendRow key={entry.id} entry={entry} compact />
              ))}
            </Card>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <Breakdown title="Category mix" rows={categoryRows} />
            <Breakdown title="Top groups and friends" rows={scopeRows} />
          </div>

          <Card className="space-y-3 border-primary/10 p-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h3 className="font-black">Monthly trend</h3>
            </div>
            <div className="space-y-2">
              {trendRows.map((row) => (
                <BarRow
                  key={`${row.key}:${row.currency}`}
                  label={`${row.label} (${row.currency})`}
                  amount={row.amount}
                  currency={row.currency}
                  max={Math.max(...trendRows.map((item) => item.amount))}
                />
              ))}
            </div>
          </Card>

          <Card className="space-y-2 border-primary/10 p-4">
            <h3 className="font-black">Largest expenses</h3>
            {largest.map((entry) => (
              <SpendRow key={entry.id} entry={entry} />
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; currency: string; amount: number }[];
}) {
  const max = Math.max(0, ...rows.map((row) => row.amount));
  return (
    <Card className="space-y-3 border-primary/10 p-4">
      <h3 className="font-black">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <BarRow
              key={`${row.key}:${row.currency}`}
              label={row.label}
              amount={row.amount}
              currency={row.currency}
              max={max}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function BarRow({
  label,
  amount,
  currency,
  max,
}: {
  label: string;
  amount: number;
  currency: string;
  max: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-semibold">{label}</span>
        <span className="shrink-0 font-black">{formatMoney(amount, currency)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${max > 0 ? Math.max(4, (amount / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}

function SpendRow({
  entry,
  compact = false,
}: {
  entry: SpendEntry;
  compact?: boolean;
}) {
  const category = getExpenseCategory(entry.category);
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/80 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-bold">{entry.scopeName}</p>
          <Badge variant={entry.origin === "imported" ? "outline" : "muted"}>
            {entry.origin}
          </Badge>
        </div>
        {!compact && (
          <p className="truncate text-xs text-muted-foreground">
            {entry.date} · paid by {entry.paidByName} ·{" "}
            {category?.name ?? "Other"}
          </p>
        )}
      </div>
      <div className="text-right">
        <p className="font-black">{formatMoney(entry.myShare, entry.currency)}</p>
        {!compact && (
          <p className="text-xs text-muted-foreground">
            bill {formatMoney(entry.fullAmount, entry.currency)}
          </p>
        )}
      </div>
    </div>
  );
}
