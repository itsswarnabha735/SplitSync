"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Download,
  Edit3,
  Printer,
  Receipt,
  Trash2,
  TrendingUp,
} from "lucide-react";

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
import { buildSpendCopilotContext } from "@/lib/settlement-copilot-context";
import { CurrencyTotals } from "@/components/currency-totals";
import { EmptyState } from "@/components/empty-state";
import { SettlementCopilotButton } from "@/components/settlement-copilot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

interface SpendTabProps {
  entries: SpendEntry[];
  outstandingNet: Record<string, number>;
  onEditEntry?: (entry: SpendEntry) => void;
  onDeleteEntry?: (entry: SpendEntry) => void;
}

export function SpendTab({
  entries,
  outstandingNet,
  onEditEntry,
  onDeleteEntry,
}: SpendTabProps) {
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
  const insightRows = useMemo(() => buildSpendInsights(filtered), [filtered]);
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
  const copilotContext = useMemo(
    () =>
      buildSpendCopilotContext({
        entries,
        filteredEntries: filtered,
        outstandingNet,
      }),
    [entries, filtered, outstandingNet]
  );

  function patch(next: Partial<SpendFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  function exportCsv() {
    const header = [
      "date",
      "scope",
      "source",
      "category",
      "currency",
      "myShare",
      "fullAmount",
      "paidUpfront",
      "paidBy",
      "origin",
      "needsReview",
    ];
    const rows = filtered.map((entry) => [
      entry.date,
      entry.scopeName,
      entry.source,
      entry.categoryName,
      entry.currency,
      entry.myShare.toFixed(2),
      entry.fullAmount.toFixed(2),
      entry.paidUpfront.toFixed(2),
      entry.paidByName,
      entry.origin,
      entry.needsReview ? "yes" : "no",
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `splitsync-spend-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    const totals = Object.entries(summary)
      .map(
        ([currency, item]) =>
          `<li><strong>${currency}</strong>: ${formatMoney(item.mySpend, currency)} personal spend, ${formatMoney(item.paidUpfront, currency)} paid upfront</li>`
      )
      .join("");
    const rows = filtered
      .slice(0, 120)
      .map(
        (entry) =>
          `<tr><td>${entry.date}</td><td>${entry.scopeName}</td><td>${entry.categoryName}</td><td>${entry.paidByName}</td><td>${formatMoney(entry.myShare, entry.currency)}</td></tr>`
      )
      .join("");
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) return;
    win.document.write(`<!doctype html>
      <html>
        <head>
          <title>SplitSync spend report</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
            h1 { margin: 0 0 8px; }
            p { color: #4b5563; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 12px; }
            th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; }
            th { background: #f9fafb; }
          </style>
        </head>
        <body>
          <h1>SplitSync spend report</h1>
          <p>Generated ${new Date().toLocaleString()}</p>
          <ul>${totals}</ul>
          <table>
            <thead><tr><th>Date</th><th>Group/Friend</th><th>Category</th><th>Paid by</th><th>My share</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>`);
    win.document.close();
    win.focus();
    win.print();
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
      <div className="flex sm:justify-end">
        <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 sm:h-9"
            onClick={exportCsv}
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 sm:h-9"
            onClick={printReport}
          >
            <Printer className="h-4 w-4" />
            PDF
          </Button>
          <SettlementCopilotButton
            contextType="spend"
            context={copilotContext}
            prompt="Which imported expenses need review?"
            label="Ask Spend Copilot"
            buttonVariant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto"
          />
        </div>
      </div>
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

          {insightRows.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {insightRows.map((insight) => (
                <Card key={insight.title} className="border-primary/10 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase text-muted-foreground">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    {insight.title}
                  </div>
                  <p className="mt-2 text-xl font-black">{insight.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {insight.detail}
                  </p>
                </Card>
              ))}
            </div>
          )}

          {reviewRows.length > 0 && (
            <Card className="space-y-2 border-amber-300/50 bg-amber-50/40 p-4">
              <div className="flex items-center gap-2 text-sm font-black text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                Imported rows needing review
              </div>
              {reviewRows.map((entry) => (
                <SpendRow
                  key={entry.id}
                  entry={entry}
                  compact
                  onEdit={onEditEntry}
                  onDelete={onDeleteEntry}
                />
              ))}
            </Card>
          )}

          {recentImported.length > 0 && (
            <Card className="space-y-2 border-primary/10 p-4">
              <h3 className="font-black">Recent imports</h3>
              {recentImported.map((entry) => (
                <SpendRow
                  key={entry.id}
                  entry={entry}
                  compact
                  onEdit={onEditEntry}
                  onDelete={onDeleteEntry}
                />
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
              <SpendRow
                key={entry.id}
                entry={entry}
                onEdit={onEditEntry}
                onDelete={onDeleteEntry}
              />
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
  onEdit,
  onDelete,
}: {
  entry: SpendEntry;
  compact?: boolean;
  onEdit?: (entry: SpendEntry) => void;
  onDelete?: (entry: SpendEntry) => void;
}) {
  const category = getExpenseCategory(entry.category);
  const canEdit = Boolean(entry.editableTarget && onEdit);
  const canDelete = Boolean(entry.deletableTarget && onDelete);
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 px-3 py-3 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:py-2">
      <div className="min-w-0 flex-1">
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
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-3 sm:mt-0 sm:border-0 sm:pt-0">
        <div className="min-w-0 shrink sm:text-right">
          <p className="truncate font-black">
            {formatMoney(entry.myShare, entry.currency)}
          </p>
          {!compact && (
            <p className="truncate text-xs text-muted-foreground">
              bill {formatMoney(entry.fullAmount, entry.currency)}
            </p>
          )}
        </div>
        {(canEdit || canDelete) && (
          <div className="flex shrink-0 gap-1">
            {canEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 w-11 px-0 sm:h-9 sm:w-auto sm:px-3"
                onClick={() => onEdit?.(entry)}
                aria-label={`Edit ${entry.scopeName}`}
              >
                <Edit3 className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Edit</span>
              </Button>
            )}
            {canDelete && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-11 w-11 px-0 text-destructive hover:text-destructive sm:h-9 sm:w-auto sm:px-3"
                onClick={() => onDelete?.(entry)}
                aria-label={`Delete ${entry.scopeName}`}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Delete</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function buildSpendInsights(entries: SpendEntry[]): Array<{
  title: string;
  value: string;
  detail: string;
}> {
  if (entries.length === 0) return [];
  const currentMonth = entries[0]?.date.slice(0, 7);
  const months = Array.from(new Set(entries.map((entry) => entry.date.slice(0, 7)))).sort();
  const previousMonth =
    currentMonth && months.length > 1
      ? months.filter((month) => month < currentMonth).at(-1)
      : undefined;
  const currency = entries[0].currency;
  const sameCurrency = entries.filter((entry) => entry.currency === currency);
  const currentSpend = sameCurrency
    .filter((entry) => entry.date.startsWith(currentMonth ?? ""))
    .reduce((sum, entry) => sum + entry.myShare, 0);
  const previousSpend = previousMonth
    ? sameCurrency
        .filter((entry) => entry.date.startsWith(previousMonth))
        .reduce((sum, entry) => sum + entry.myShare, 0)
    : 0;
  const fronted = sameCurrency.reduce(
    (sum, entry) => sum + Math.max(0, entry.paidUpfront - entry.myShare),
    0
  );
  const categoryTotals = new Map<string, number>();
  const scopeTotals = new Map<string, number>();
  for (const entry of sameCurrency) {
    categoryTotals.set(
      entry.categoryName,
      (categoryTotals.get(entry.categoryName) ?? 0) + entry.myShare
    );
    scopeTotals.set(
      entry.scopeName,
      (scopeTotals.get(entry.scopeName) ?? 0) + entry.myShare
    );
  }
  const topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const topScope = [...scopeTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  const delta = currentSpend - previousSpend;

  return [
    {
      title: "Month change",
      value: previousMonth
        ? `${delta >= 0 ? "+" : ""}${formatMoney(delta, currency)}`
        : formatMoney(currentSpend, currency),
      detail: previousMonth
        ? `${currentMonth} vs ${previousMonth}`
        : `${currentMonth ?? "This month"} spend`,
    },
    {
      title: "You fronted",
      value: formatMoney(fronted, currency),
      detail: "Paid upfront beyond your own share.",
    },
    {
      title: "Largest driver",
      value: topCategory?.[0] ?? "No category",
      detail: topScope
        ? `${formatMoney(topCategory?.[1] ?? 0, currency)} category spend; top scope ${topScope[0]}`
        : "No scope data.",
    },
  ];
}
