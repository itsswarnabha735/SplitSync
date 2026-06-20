"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";

import {
  applyExpenseAutocompleteDraft,
  detectLargeExpenseWarning,
  mergeAutocompleteWarnings,
  validateExpenseAutocompleteResponse,
  type AppliedExpenseAutocomplete,
  type ExpenseAutocompleteCurrentFields,
  type ExpenseAutocompleteMode,
  type ExpenseAutocompleteParticipant,
  type ExpenseAutocompleteRecentContext,
  type ExpenseAutocompleteRequest,
} from "@/lib/expense-autocomplete";
import type { SplitType } from "@/lib/models";
import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ExpenseAutocompletePanelProps {
  mode: ExpenseAutocompleteMode;
  participants: ExpenseAutocompleteParticipant[];
  supportedCurrencies: string[];
  recentContext: ExpenseAutocompleteRecentContext[];
  largeExpenseThresholds: Record<string, number>;
  current: ExpenseAutocompleteCurrentFields;
  onApply: (result: AppliedExpenseAutocomplete) => void;
  placeholder: string;
  className?: string;
  actionLabel?: string;
  initialInput?: string;
  multiline?: boolean;
}

export function ExpenseAutocompletePanel({
  mode,
  participants,
  supportedCurrencies,
  recentContext,
  largeExpenseThresholds,
  current,
  onApply,
  placeholder,
  className,
  actionLabel = "Fill with AI",
  initialInput,
  multiline = false,
}: ExpenseAutocompletePanelProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] =
    useState<AppliedExpenseAutocomplete | null>(null);

  const request = useMemo<ExpenseAutocompleteRequest>(
    () => ({
      input,
      mode,
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      today: current.dateStr,
      defaults: {
        currency: current.currency,
        date: current.dateStr,
        paidById: current.paidBy,
        splitType: current.splitType,
      },
      participants,
      supportedCurrencies,
      recentContext,
    }),
    [
      current.currency,
      current.dateStr,
      current.paidBy,
      current.splitType,
      input,
      mode,
      participants,
      recentContext,
      supportedCurrencies,
    ]
  );

  useEffect(() => {
    if (initialInput) setInput(initialInput);
  }, [initialInput]);

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (input.replace(/\s+/g, "").length < 4) {
      setError("Add a few more expense details.");
      return;
    }
    if (participants.length === 0) {
      setError("No participants are available.");
      return;
    }

    setLoading(true);
    setError(null);
    setLastResult(null);
    try {
      const response = await fetch("/api/expense-autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "Could not fill this expense."
        );
      }

      const normalized = validateExpenseAutocompleteResponse(payload, request);
      const largeWarning = detectLargeExpenseWarning({
        amount: normalized.draft.amount,
        currency: normalized.draft.currency,
        thresholds: largeExpenseThresholds,
      });
      const merged = {
        ...normalized,
        warnings: mergeAutocompleteWarnings(
          normalized.warnings,
          largeWarning ? [largeWarning] : []
        ),
      };
      const applied = applyExpenseAutocompleteDraft({
        response: merged,
        current,
        participants,
        supportedCurrencies,
      });
      onApply(applied);
      setLastResult(applied);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not fill this expense.";
      setError(message);
      const failed: AppliedExpenseAutocomplete = {
        status: "failed",
        draft: {},
        confidence: {},
        appliedFields: [],
        warnings: [
          {
            code: "low-confidence",
            message,
          },
        ],
        fields: {},
      };
      onApply(failed);
      setLastResult(failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className={cn("space-y-3 border-primary/10 p-4", className)}>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSubmit}>
        <div className="relative min-w-0 flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
          {multiline ? (
            <textarea
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              className="min-h-28 w-full rounded-xl border border-input bg-card/80 px-9 py-3 text-sm shadow-inner shadow-foreground/[0.02] ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={placeholder}
              disabled={loading}
              aria-label="Smart expense command"
            />
          ) : (
            <Input
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setError(null);
              }}
              className="pl-9"
              placeholder={placeholder}
              disabled={loading}
              aria-label="Smart expense command"
            />
          )}
        </div>
        <Button type="submit" disabled={loading || !input.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? "Filling..." : actionLabel}
        </Button>
      </form>

      {error && (
        <p
          className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {lastResult && !error && (
        <div
          className={cn(
            "space-y-2 rounded-xl border px-3 py-2 text-sm",
            lastResult.status === "filled"
              ? "border-primary/20 bg-primary/10 text-primary"
              : lastResult.status === "failed"
                ? "border-destructive/20 bg-destructive/10 text-destructive"
                : "border-amber-300/50 bg-amber-50/60 text-amber-800"
          )}
          role="status"
        >
          <div className="flex items-center gap-2 font-bold">
            {lastResult.status === "filled" ? (
              <Sparkles className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
            <span>{statusCopy(lastResult)}</span>
          </div>
          {lastResult.warnings.length > 0 && (
            <ul className="space-y-1 text-xs font-semibold">
              {lastResult.warnings.slice(0, 4).map((warning, index) => (
                <li key={`${warning.code}:${warning.field ?? ""}:${index}`}>
                  {warning.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function statusCopy(result: AppliedExpenseAutocomplete): string {
  if (result.status === "failed") return "No fields were filled.";
  const count = result.appliedFields.length;
  if (result.status === "filled") {
    return `AI filled ${count} field${count === 1 ? "" : "s"}. Review before saving.`;
  }
  if (result.status === "needs_review") {
    return `AI filled ${count} field${count === 1 ? "" : "s"} with review warnings.`;
  }
  return `AI filled ${count} field${count === 1 ? "" : "s"}.`;
}

export function buildAutocompleteCurrentFields(params: {
  description: string;
  amountStr: string;
  currency: string;
  dateStr: string;
  paidBy: string;
  category: ExpenseCategorySlug;
  splitType: SplitType;
}): ExpenseAutocompleteCurrentFields {
  return params;
}
