"use client";

import { AlertTriangle, CheckCircle2, Users } from "lucide-react";

import type {
  DuplicateExpenseCandidate,
  ExpenseDraftSource,
  ExpenseWarning,
} from "@/lib/expense-drafts";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type ParticipantPreset =
  | "everyone"
  | "payer-only"
  | "last-expense"
  | "category-pattern"
  | "custom";

export function ExpenseFieldProvenance({
  source,
  confidence,
  warning,
}: {
  source?: ExpenseDraftSource | "edited";
  confidence?: number;
  warning?: string;
}) {
  if (!source && confidence === undefined && !warning) return null;
  const review = confidence !== undefined && confidence < 0.85;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {source && (
        <Badge variant={source === "edited" ? "outline" : "default"}>
          {sourceLabel(source)}
        </Badge>
      )}
      {confidence !== undefined && (
        <Badge variant={review ? "outline" : "muted"}>
          {Math.round(confidence * 100)}% confidence
        </Badge>
      )}
      {warning && (
        <span className="text-xs font-semibold text-amber-700">{warning}</span>
      )}
    </div>
  );
}

export function ParticipantPresetPicker({
  value,
  onChange,
  disabledPresets = [],
}: {
  value: ParticipantPreset;
  onChange: (preset: ParticipantPreset) => void;
  disabledPresets?: ParticipantPreset[];
}) {
  const options: Array<{ value: ParticipantPreset; label: string }> = [
    { value: "everyone", label: "Everyone" },
    { value: "payer-only", label: "Me + payer" },
    { value: "last-expense", label: "Last expense" },
    { value: "category-pattern", label: "Category pattern" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div className="flex gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-card/80 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabledPresets.includes(option.value)}
          onClick={() => onChange(option.value)}
          className={cn(
            "shrink-0 rounded-xl px-3 py-2 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-45",
            value === option.value
              ? "bg-primary text-primary-foreground shadow-[0_10px_20px_-14px_hsl(var(--primary))]"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ParticipantPreview({
  included,
  excluded,
  needsConfirmation,
  onConfirm,
}: {
  included: string;
  excluded: string;
  needsConfirmation: boolean;
  onConfirm: () => void;
}) {
  return (
    <Card
      className={cn(
        "space-y-2 border-primary/10 p-3",
        needsConfirmation && "border-amber-300/60 bg-amber-50/70 text-amber-950"
      )}
    >
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-bold">Included: {included}</p>
          <p className="text-muted-foreground">Excluded: {excluded}</p>
        </div>
        {needsConfirmation && (
          <Button type="button" size="sm" variant="outline" onClick={onConfirm}>
            Confirm
          </Button>
        )}
      </div>
    </Card>
  );
}

export function DuplicateExpenseWarning({
  candidates,
  acknowledged,
  onAcknowledge,
}: {
  candidates: DuplicateExpenseCandidate[];
  acknowledged: boolean;
  onAcknowledge: () => void;
}) {
  if (candidates.length === 0) return null;
  const strongest = candidates[0];
  return (
    <div
      className="space-y-2 rounded-2xl border border-amber-300/60 bg-amber-50/80 px-3 py-2 text-sm text-amber-950"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-black">
            {strongest.strength === "hard"
              ? "Possible duplicate expense"
              : "Similar expense found"}
          </p>
          <p className="font-semibold">
            This looks similar to {strongest.expense.description} from{" "}
            {new Date(strongest.expense.timestamp).toLocaleDateString()}.
          </p>
        </div>
      </div>
      {!acknowledged && strongest.strength === "hard" && (
        <Button type="button" size="sm" variant="outline" onClick={onAcknowledge}>
          Save anyway
        </Button>
      )}
    </div>
  );
}

export function ExpenseImpactPreview({
  summary,
  warnings,
}: {
  summary: string;
  warnings: ExpenseWarning[];
}) {
  const blocking = warnings.filter((warning) => warning.blocking);
  return (
    <div
      className={cn(
        "space-y-2 rounded-2xl border px-3 py-2 text-sm",
        blocking.length > 0
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : "border-primary/15 bg-primary/10 text-primary"
      )}
      role={blocking.length > 0 ? "alert" : "status"}
    >
      <div className="flex items-start gap-2">
        {blocking.length > 0 ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        )}
        <p className="font-semibold">{summary}</p>
      </div>
      {warnings.length > 0 && (
        <ul className="space-y-1 text-xs font-semibold">
          {warnings.map((warning, index) => (
            <li key={`${warning.code}:${warning.field ?? ""}:${index}`}>
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sourceLabel(source: ExpenseDraftSource | "edited"): string {
  const labels: Record<ExpenseDraftSource | "edited", string> = {
    manual: "Typed",
    "ai-text": "AI",
    "pasted-message": "Paste",
    "receipt-image": "Scan",
    "statement-import": "Statement",
    edited: "Edited",
  };
  return labels[source];
}
