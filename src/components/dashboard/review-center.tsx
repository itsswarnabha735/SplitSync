"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Edit3,
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
            className="rounded-2xl border border-border/70 px-3 py-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
                <ReceiptText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{entry.scopeName}</p>
                <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {entry.category === "other"
                    ? "Uncategorized"
                    : "Imported row needs review"}{" "}
                  · {entry.categoryName}
                </p>
              </div>
            </div>
            <div className="mt-3 flex min-w-0 items-center justify-between gap-2 border-t border-border/60 pt-3">
              <p className="min-w-0 truncate text-sm font-black">
                {formatMoney(entry.myShare, entry.currency)}
              </p>
              {(entry.editableTarget || entry.deletableTarget) && (
                <div className="flex shrink-0 gap-1">
                  {entry.editableTarget && onEditEntry && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-11 w-11 px-0 sm:h-9 sm:w-auto sm:px-3"
                      onClick={() => onEditEntry(entry)}
                      aria-label={`Edit ${entry.scopeName}`}
                    >
                      <Edit3 className="h-4 w-4" />
                      <span className="sr-only sm:not-sr-only">Edit</span>
                    </Button>
                  )}
                  {entry.deletableTarget && onDeleteEntry && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-11 w-11 px-0 text-destructive hover:text-destructive sm:h-9 sm:w-auto sm:px-3"
                      onClick={() => onDeleteEntry(entry)}
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
        ))}
        {outstanding.slice(0, 2).map(([currency, amount]) => (
          <div
            key={currency}
            className="rounded-2xl border border-border/70 px-3 py-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Wallet className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {amount > 0 ? "You are owed" : "You owe"}
                </p>
                <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  Open balances need settlement follow-up.
                </p>
              </div>
            </div>
            <div className="mt-3 border-t border-border/60 pt-3">
              <p className="truncate text-sm font-black">
                {formatMoney(Math.abs(amount), currency)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {(importedNeedsReview.length > 0 || uncategorized.length > 0) && (
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-9"
            onClick={onOpenSpend}
          >
            Review spend
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {outstanding.length > 0 && (
          <Button size="sm" className="h-11 sm:h-9" onClick={onOpenBalances}>
            Review balances
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}
