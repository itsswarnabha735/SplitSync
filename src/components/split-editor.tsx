"use client";

import { Check, Info } from "lucide-react";

import { currencySymbol } from "@/lib/currency";
import type { DraftSplitMethod } from "@/lib/splits";
import { buildSplitsForMethod } from "@/lib/splits";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface Participant {
  id: string;
  name: string;
}

export interface SplitState {
  equalSelections: Record<string, boolean>;
  exactInputs: Record<string, string>;
  shareInputs?: Record<string, string>;
  percentInputs?: Record<string, string>;
  adjustmentInputs?: Record<string, string>;
}

export function emptySplitState(participants: Participant[]): SplitState {
  const equalSelections: Record<string, boolean> = {};
  for (const p of participants) equalSelections[p.id] = true;
  return {
    equalSelections,
    exactInputs: {},
    shareInputs: {},
    percentInputs: {},
    adjustmentInputs: {},
  };
}

interface SplitEditorProps {
  participants: Participant[];
  amount: number;
  currency: string;
  splitType: DraftSplitMethod;
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
                "flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 shadow-sm transition-colors",
                checked
                  ? "border-primary/35 bg-primary/5"
                  : "border-border/70 bg-card/80"
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

  if (splitType === "SHARES") {
    const result = buildSplitsForMethod({
      splitMethod: "SHARES",
      amount,
      equalParticipantIds: selectedParticipantIds(participants, value),
      exactDistribution: {},
      shareDistribution: parseInputs(value.shareInputs),
      currency,
    });

    return (
      <div className="space-y-2">
        <SplitStatus
          ok={result.ok}
          okLabel="Shares are ready"
          issueLabel={result.error ?? "Enter shares for selected participants"}
        />
        {participants.map((p) => (
          <SplitInputRow
            key={p.id}
            participant={p}
            value={value.shareInputs?.[p.id] ?? ""}
            suffix="shares"
            onChange={(nextValue) =>
              onChange({
                ...value,
                shareInputs: {
                  ...(value.shareInputs ?? {}),
                  [p.id]: nextValue,
                },
              })
            }
          />
        ))}
      </div>
    );
  }

  if (splitType === "PERCENT") {
    const total = Object.values(parseInputs(value.percentInputs)).reduce(
      (sum, next) => sum + next,
      0
    );
    const result = buildSplitsForMethod({
      splitMethod: "PERCENT",
      amount,
      equalParticipantIds: selectedParticipantIds(participants, value),
      exactDistribution: {},
      percentDistribution: parseInputs(value.percentInputs),
      currency,
    });

    return (
      <div className="space-y-2">
        <SplitStatus
          ok={result.ok}
          okLabel="Percent split is ready"
          issueLabel={`Percent total is ${total.toFixed(2)}%. It must equal 100%.`}
        />
        {participants.map((p) => (
          <SplitInputRow
            key={p.id}
            participant={p}
            value={value.percentInputs?.[p.id] ?? ""}
            suffix="%"
            onChange={(nextValue) =>
              onChange({
                ...value,
                percentInputs: {
                  ...(value.percentInputs ?? {}),
                  [p.id]: nextValue,
                },
              })
            }
          />
        ))}
      </div>
    );
  }

  if (splitType === "ADJUSTMENT") {
    const result = buildSplitsForMethod({
      splitMethod: "ADJUSTMENT",
      amount,
      equalParticipantIds: selectedParticipantIds(participants, value),
      exactDistribution: {},
      adjustmentDistribution: parseInputs(value.adjustmentInputs),
      currency,
    });

    return (
      <div className="space-y-2">
        <SplitStatus
          ok={result.ok}
          okLabel="Adjustments keep the total balanced"
          issueLabel={result.error ?? "Adjustments must preserve the total"}
        />
        {participants.map((p) => (
          <SplitInputRow
            key={p.id}
            participant={p}
            value={value.adjustmentInputs?.[p.id] ?? ""}
            prefix={symbol}
            suffix="+/-"
            onChange={(nextValue) =>
              onChange({
                ...value,
                adjustmentInputs: {
                  ...(value.adjustmentInputs ?? {}),
                  [p.id]: nextValue,
                },
              })
            }
          />
        ))}
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
  const diffLabel =
    diffCents > 0
      ? `Still need ${symbol}${Math.abs(diff).toFixed(2)}`
      : `Over by ${symbol}${Math.abs(diff).toFixed(2)}`;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold",
          matches
            ? "rounded-2xl border border-primary/15 bg-primary/10 text-primary"
            : "rounded-2xl border border-destructive/15 bg-destructive/10 text-destructive"
        )}
      >
        <span className="flex items-center gap-2">
          {matches ? (
            <Check className="h-4 w-4" />
          ) : (
            <Info className="h-4 w-4" />
          )}
          {matches ? "Split matches total" : "Adjust split amounts"}
        </span>
        <span>{matches ? "Ready to save" : diffLabel}</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange(fillRemainingForLastParticipant(participants, value, amount))
          }
          disabled={matches || participants.length === 0}
        >
          Fill remaining
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(splitRemainingEqually(participants, value, amount))}
          disabled={matches || participants.length === 0}
        >
          Split remaining equally
        </Button>
      </div>

      {participants.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between rounded-2xl border border-border/70 bg-card/80 px-4 py-2.5 shadow-sm"
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

function SplitStatus({
  ok,
  okLabel,
  issueLabel,
}: {
  ok: boolean;
  okLabel: string;
  issueLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-2xl border px-3 py-2 text-sm font-semibold",
        ok
          ? "border-primary/15 bg-primary/10 text-primary"
          : "border-destructive/15 bg-destructive/10 text-destructive"
      )}
    >
      <span className="flex items-center gap-2">
        {ok ? <Check className="h-4 w-4" /> : <Info className="h-4 w-4" />}
        {ok ? okLabel : issueLabel}
      </span>
    </div>
  );
}

function SplitInputRow({
  participant,
  value,
  prefix,
  suffix,
  onChange,
}: {
  participant: Participant;
  value: string;
  prefix?: string;
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-card/80 px-4 py-2.5 shadow-sm">
      <span className="font-semibold">{participant.name}</span>
      <div className="relative w-36">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-primary">
            {prefix}
          </span>
        )}
        <Input
          inputMode="decimal"
          className={cn(prefix ? "pl-7" : "", suffix ? "pr-14" : "", "text-right")}
          placeholder="0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function selectedParticipantIds(
  participants: Participant[],
  value: SplitState
): string[] {
  return participants
    .filter((participant) => value.equalSelections[participant.id] ?? true)
    .map((participant) => participant.id);
}

function parseInputs(inputs: Record<string, string> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(inputs ?? {})) {
    const value = parseFloat(raw);
    if (!Number.isNaN(value)) out[id] = value;
  }
  return out;
}

function fillRemainingForLastParticipant(
  participants: Participant[],
  value: SplitState,
  amount: number
): SplitState {
  const selected = selectedParticipantIds(participants, value);
  const targetId = [...selected].reverse().find((id) => {
    const current = parseFloat(value.exactInputs[id] ?? "");
    return Number.isNaN(current) || current === 0;
  }) ?? selected[selected.length - 1];
  if (!targetId) return value;
  const currentTotal = selected.reduce((sum, id) => {
    if (id === targetId) return sum;
    return sum + (parseFloat(value.exactInputs[id] ?? "") || 0);
  }, 0);
  const remaining = Math.max(0, amount - currentTotal);
  return {
    ...value,
    exactInputs: {
      ...value.exactInputs,
      [targetId]: remaining.toFixed(2),
    },
  };
}

function splitRemainingEqually(
  participants: Participant[],
  value: SplitState,
  amount: number
): SplitState {
  const selected = selectedParticipantIds(participants, value);
  const blankIds = selected.filter((id) => {
    const current = parseFloat(value.exactInputs[id] ?? "");
    return Number.isNaN(current) || current === 0;
  });
  if (blankIds.length === 0) return value;
  const filledTotal = selected.reduce((sum, id) => {
    if (blankIds.includes(id)) return sum;
    return sum + (parseFloat(value.exactInputs[id] ?? "") || 0);
  }, 0);
  const perPerson = Math.max(0, amount - filledTotal) / blankIds.length;
  return {
    ...value,
    exactInputs: {
      ...value.exactInputs,
      ...Object.fromEntries(blankIds.map((id) => [id, perPerson.toFixed(2)])),
    },
  };
}
