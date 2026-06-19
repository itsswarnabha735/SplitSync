"use client";

import { Check, Info } from "lucide-react";

import type { SplitType } from "@/lib/models";
import { currencySymbol } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export interface Participant {
  id: string;
  name: string;
}

export interface SplitState {
  equalSelections: Record<string, boolean>;
  exactInputs: Record<string, string>;
}

export function emptySplitState(participants: Participant[]): SplitState {
  const equalSelections: Record<string, boolean> = {};
  for (const p of participants) equalSelections[p.id] = true;
  return { equalSelections, exactInputs: {} };
}

interface SplitEditorProps {
  participants: Participant[];
  amount: number;
  currency: string;
  splitType: SplitType;
  value: SplitState;
  onChange: (next: SplitState) => void;
}

export function SplitEditor({
  participants,
  amount,
  currency,
  splitType,
  value,
  onChange,
}: SplitEditorProps) {
  const symbol = currencySymbol(currency);

  if (splitType === "EQUAL") {
    const selectedCount = participants.filter(
      (p) => value.equalSelections[p.id] ?? true
    ).length;
    const perPerson = selectedCount > 0 ? amount / selectedCount : 0;

    return (
      <div className="space-y-2">
        {participants.map((p) => {
          const checked = value.equalSelections[p.id] ?? true;
          return (
            <label
              key={p.id}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 transition-colors",
                checked
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-card"
              )}
            >
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(c) =>
                    onChange({
                      ...value,
                      equalSelections: {
                        ...value.equalSelections,
                        [p.id]: Boolean(c),
                      },
                    })
                  }
                />
                <span className="font-semibold">{p.name}</span>
              </div>
              <span
                className={cn(
                  "text-sm font-bold",
                  checked ? "text-primary" : "text-muted-foreground"
                )}
              >
                {checked
                  ? `${symbol}${perPerson.toFixed(2)}`
                  : `${symbol}0.00`}
              </span>
            </label>
          );
        })}
      </div>
    );
  }

  // EXACT
  const total = participants.reduce(
    (s, p) => s + (parseFloat(value.exactInputs[p.id] ?? "") || 0),
    0
  );
  const diffCents = Math.round(amount * 100) - Math.round(total * 100);
  const diff = diffCents / 100;
  const matches = diffCents === 0;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold",
          matches
            ? "bg-primary/10 text-primary"
            : "bg-destructive/10 text-destructive"
        )}
      >
        <span className="flex items-center gap-2">
          {matches ? (
            <Check className="h-4 w-4" />
          ) : (
            <Info className="h-4 w-4" />
          )}
          {matches ? "Split matches total" : "Portions differ"}
        </span>
        <span>
          {matches ? "100%" : `Diff: ${symbol}${diff.toFixed(2)}`}
        </span>
      </div>

      {participants.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-xl border bg-card px-4 py-2.5"
        >
          <span className="font-semibold">{p.name}</span>
          <div className="relative w-32">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-primary">
              {symbol}
            </span>
            <Input
              inputMode="decimal"
              className="pl-7 text-right"
              placeholder="0.00"
              value={value.exactInputs[p.id] ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  exactInputs: {
                    ...value.exactInputs,
                    [p.id]: e.target.value,
                  },
                })
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}
