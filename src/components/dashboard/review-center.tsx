"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ReceiptText,
  Trash2,
  Wallet,
} from "lucide-react";

import { formatMoney } from "@/lib/currency";
import type { SpendEntry } from "@/lib/spend-analysis";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface ReviewCenterProps {
  entries: SpendEntry[];
  outstandingNet: Record<string, number>;
  onOpenSpend: () => void;
  onOpenBalances: () => void;
  onEditEntry?: (entry: SpendEntry) => void;
  onDeleteEntry?: (entry: SpendEntry) => void;
}

export function ReviewCenter({
  entries,
  outstandingNet,
  onOpenSpend,
  onOpenBalances,
  onEditEntry,
  onDeleteEntry,
}: ReviewCenterProps) {
  const importedNeedsReview = entries.filter((entry) => entry.needsReview);
  const uncategorized = entries.filter(
    (entry) => entry.category === "other" && !entry.needsReview
  );
  const outstanding = Object.entries(outstandingNet).filter(
    ([, amount]) => Math.abs(amount) > 0.01
  );
  const visibleSpendRows = [...importedNeedsReview, ...uncategorized].slice(0, 4);
  const issueCount =
    importedNeedsReview.length + uncategorized.length + outstanding.length;

  if (issueCount === 0) {
    return (
      <Card className="flex items-center gap-3 border-success/15 bg-success/10 p-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-success/15 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-black">Review center is clear</p>
          <p className="text-sm text-muted-foreground">
            No imported rows, uncategorized spend, or open balances need attention.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 border-primary/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <div>
              <p className="font-black">Review center</p>
              <p className="text-sm text-muted-foreground">
                Resolve confidence, categorization, and settlement follow-ups.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {importedNeedsReview.length > 0 && (
            <Badge variant="destructive">{importedNeedsReview.length} import review</Badge>
          )}
          {uncategorized.length > 0 && (
            <Badge variant="outline">{uncategorized.length} uncategorized</Badge>
          )}
          {outstanding.length > 0 && (
            <Badge variant="default">{outstanding.length} balance</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {visibleSpendRows.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-2"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <ReceiptText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{entry.scopeName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {entry.category === "other" ? "Uncategorized" : "Imported row needs review"} ·{" "}
                {entry.categoryName}
              </p>
            </div>
            <p className="shrink-0 text-sm font-black">
              {formatMoney(entry.myShare, entry.currency)}
            </p>
            {(entry.editableTarget || entry.deletableTarget) && (
              <div className="flex shrink-0 gap-1">
                {entry.editableTarget && onEditEntry && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onEditEntry(entry)}
                  >
                    Edit
                  </Button>
                )}
                {entry.deletableTarget && onDeleteEntry && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDeleteEntry(entry)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
        {outstanding.slice(0, 2).map(([currency, amount]) => (
          <div
            key={currency}
            className="flex items-center gap-3 rounded-2xl border border-border/70 px-3 py-2"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Wallet className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">
                {amount > 0 ? "You are owed" : "You owe"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Open balances need settlement follow-up.
              </p>
            </div>
            <p className="shrink-0 text-sm font-black">
              {formatMoney(Math.abs(amount), currency)}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {(importedNeedsReview.length > 0 || uncategorized.length > 0) && (
          <Button variant="outline" size="sm" onClick={onOpenSpend}>
            Review spend
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {outstanding.length > 0 && (
          <Button size="sm" onClick={onOpenBalances}>
            Review balances
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}
