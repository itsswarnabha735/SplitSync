"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AppliedExpenseAutocomplete } from "@/lib/expense-autocomplete";
import type { AdHocExpense, Friend, SplitType } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import type { ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  EXPENSE_CATEGORIES,
  suggestExpenseCategory,
} from "@/lib/expense-categories";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { dateInputToLocalTimestamp, toDateInputValue } from "@/lib/dates";
import { buildSplits } from "@/lib/splits";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import {
  buildAutocompleteCurrentFields,
  ExpenseAutocompletePanel,
} from "@/components/expense-autocomplete-panel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  SplitEditor,
  emptySplitState,
  type Participant,
  type SplitState,
} from "@/components/split-editor";
import { cn } from "@/lib/utils";

export function AddAdHocExpenseDialog({
  open,
  onOpenChange,
  friends,
  adHocExpenses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  friends: Friend[];
  adHocExpenses: AdHocExpense[];
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);

  const [selectedFriendId, setSelectedFriendId] = useState("");
  const selectedFriend = useMemo(
    () => friends.find((f) => f.id === selectedFriendId) ?? friends[0] ?? null,
    [friends, selectedFriendId]
  );
  const participants = useMemo<Participant[]>(
    () =>
      selectedFriend
        ? [
            { id: YOU_ID, name: "You" },
            { id: selectedFriend.id, name: selectedFriend.name },
          ]
        : [{ id: YOU_ID, name: "You" }],
    [selectedFriend]
  );

  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidBy, setPaidBy] = useState<string>(YOU_ID);
  const [currency, setCurrency] = useState("USD");
  const [dateStr, setDateStr] = useState(() => toDateInputValue());
  const [category, setCategory] = useState<ExpenseCategorySlug>("other");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [splitType, setSplitType] = useState<SplitType>("EQUAL");
  const [split, setSplit] = useState<SplitState>(() =>
    emptySplitState(participants)
  );
  const pendingAutocompleteSplitRef = useRef<Partial<SplitState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const amount = parseFloat(amountStr) || 0;
  const suggestedCategory = useMemo(
    () => suggestExpenseCategory(description)?.categorySlug ?? "other",
    [description]
  );

  useEffect(() => {
    if (!selectedFriend) return;
    if (selectedFriend.id !== selectedFriendId) {
      setSelectedFriendId(selectedFriend.id);
    }
    setPaidBy((current) =>
      current === YOU_ID || current === selectedFriend.id ? current : YOU_ID
    );
    const pendingAutocompleteSplit = pendingAutocompleteSplitRef.current;
    if (pendingAutocompleteSplit) {
      setSplit({
        equalSelections:
          pendingAutocompleteSplit.equalSelections ??
          emptySplitState(participants).equalSelections,
        exactInputs: pendingAutocompleteSplit.exactInputs ?? {},
      });
      pendingAutocompleteSplitRef.current = null;
    } else {
      setSplit(emptySplitState(participants));
    }
  }, [participants, selectedFriend, selectedFriendId]);

  useEffect(() => {
    if (!categoryTouched) {
      setCategory(suggestedCategory);
    }
  }, [categoryTouched, suggestedCategory]);

  function reset() {
    setDescription("");
    setAmountStr("");
    setSelectedFriendId(friends[0]?.id ?? "");
    setPaidBy(YOU_ID);
    setCurrency("USD");
    setDateStr(toDateInputValue());
    setCategory("other");
    setCategoryTouched(false);
    setSplitType("EQUAL");
    setSplit(emptySplitState(participants));
    pendingAutocompleteSplitRef.current = null;
    setError(null);
    setSaving(false);
  }

  const autocompleteParticipants = useMemo(
    () => [
      {
        id: YOU_ID,
        name: "You",
        isCurrentUser: true,
        aliases: ["me", "myself", "i", "you"],
      },
      ...friends.map((friend) => ({
        id: friend.id,
        name: friend.name,
        isCurrentUser: false,
        aliases: [friend.name, friend.email, friend.phone].filter(Boolean),
      })),
    ],
    [friends]
  );
  const recentContext = useMemo(
    () =>
      adHocExpenses.slice(0, 12).map((expense) => ({
        description: expense.description,
        amount: expense.amount,
        currency: expense.currency,
        category: expense.category,
        paidById: expense.paidByFriendId,
        splitType: expense.splitType,
        participantIds: Object.keys(expense.splits),
        timestamp: expense.timestamp,
      })),
    [adHocExpenses]
  );
  const supportedCurrencyCodes = useMemo(
    () => SUPPORTED_CURRENCIES.map((item) => item.code),
    []
  );

  function handleAutocompleteApply(result: AppliedExpenseAutocomplete) {
    const next = result.fields;
    const nextFriendId = friendIdFromAutocomplete(result, selectedFriendId);

    if (nextFriendId && nextFriendId !== selectedFriendId) {
      setSelectedFriendId(nextFriendId);
    }

    if (next.description !== undefined) setDescription(next.description);
    if (next.amountStr !== undefined) setAmountStr(next.amountStr);
    if (next.currency !== undefined) setCurrency(next.currency);
    if (next.dateStr !== undefined) setDateStr(next.dateStr);
    if (next.category !== undefined) {
      setCategory(next.category);
      setCategoryTouched(true);
    }
    if (next.splitType !== undefined) setSplitType(next.splitType);

    const scopedFriendId = nextFriendId || selectedFriendId;
    if (next.paidBy !== undefined) {
      setPaidBy(next.paidBy === YOU_ID || next.paidBy === scopedFriendId ? next.paidBy : YOU_ID);
    }

    if (scopedFriendId && (next.equalSelections || next.exactInputs)) {
      const allowed = new Set([YOU_ID, scopedFriendId]);
      const equalSelections = next.equalSelections
        ? Object.fromEntries(
            [YOU_ID, scopedFriendId].map((id) => [
              id,
              next.equalSelections?.[id] ?? true,
            ])
          )
        : undefined;
      const exactInputs = next.exactInputs
        ? Object.fromEntries(
            Object.entries(next.exactInputs).filter(([id]) => allowed.has(id))
          )
        : undefined;
      const pendingSplit = { equalSelections, exactInputs };
      if (nextFriendId && nextFriendId !== selectedFriendId) {
        pendingAutocompleteSplitRef.current = pendingSplit;
      } else {
        setSplit({
          equalSelections:
            pendingSplit.equalSelections ?? emptySplitState(participants).equalSelections,
          exactInputs: pendingSplit.exactInputs ?? {},
        });
      }
    }

    setError(null);
  }

  async function handleSave() {
    if (!description.trim()) {
      setError("Description cannot be empty.");
      return;
    }
    if (amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (!selectedFriend) {
      setError("Choose a friend for this expense.");
      return;
    }
    const equalIds = participants
      .filter((p) => split.equalSelections[p.id] ?? true)
      .map((p) => p.id);
    const exactDistribution: Record<string, number> = {};
    for (const p of participants) {
      const v = parseFloat(split.exactInputs[p.id] ?? "");
      if (!Number.isNaN(v)) exactDistribution[p.id] = v;
    }

    const result = buildSplits({
      splitType,
      amount,
      equalParticipantIds: equalIds,
      exactDistribution,
      participantLabel: "participant",
    });
    if (!result.ok) {
      setError(result.error ?? "Invalid split.");
      return;
    }
    if (!repo) return;

    setSaving(true);
    try {
      await runSyncing(
        () =>
          repo.createAdHocExpenseWithSplits({
            description,
            amount,
            paidByFriendId: paidBy,
            splitType,
            splits: result.splits,
            currency,
            timestamp: dateInputToLocalTimestamp(dateStr) ?? Date.now(),
            category,
          }),
        {
          loading: "Saving expense...",
          success: "Expense saved.",
          error: "Could not save expense.",
        }
      );
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save expense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && saving) return;
        if (!o && !saving) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log a shared expense</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <p
              className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <ExpenseAutocompletePanel
            mode="friend"
            participants={autocompleteParticipants}
            supportedCurrencies={supportedCurrencyCodes}
            recentContext={recentContext}
            largeExpenseThresholds={{}}
            current={buildAutocompleteCurrentFields({
              description,
              amountStr,
              currency,
              dateStr,
              paidBy,
              category,
              splitType,
            })}
            onApply={handleAutocompleteApply}
            placeholder="Cab to airport ₹1380 paid by me, split with Priya"
          />

          <div className="space-y-1.5">
            <Label htmlFor="adhoc-desc">Description</Label>
            <Input
              id="adhoc-desc"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setError(null);
              }}
              placeholder="Dinner, groceries, ..."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="adhoc-amount">Amount</Label>
              <Input
                id="adhoc-amount"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="adhoc-currency">Currency</Label>
              <NativeSelect
                id="adhoc-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="adhoc-date">Date</Label>
              <Input
                id="adhoc-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="adhoc-category">Category</Label>
              <NativeSelect
                id="adhoc-category"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value as ExpenseCategorySlug);
                  setCategoryTouched(true);
                }}
              >
                {EXPENSE_CATEGORIES.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adhoc-friend">Friend</Label>
            <NativeSelect
              id="adhoc-friend"
              value={selectedFriend?.id ?? ""}
              onChange={(e) => {
                setSelectedFriendId(e.target.value);
                setError(null);
              }}
            >
              {friends.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adhoc-paidby">Paid by</Label>
            <NativeSelect
              id="adhoc-paidby"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <SplitTypeToggle value={splitType} onChange={setSplitType} />

          <SplitEditor
            participants={participants}
            amount={amount}
            currency={currency}
            splitType={splitType}
            value={split}
            onChange={(s) => {
              setSplit(s);
              setError(null);
            }}
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving expense..." : "Save expense"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function friendIdFromAutocomplete(
  result: AppliedExpenseAutocomplete,
  fallbackFriendId: string
): string {
  const candidates = [
    result.draft.paidById,
    ...(result.draft.equalParticipantIds ?? []),
    ...Object.keys(result.draft.exactSplits ?? {}),
  ].filter((id): id is string => Boolean(id && id !== YOU_ID));

  return candidates[0] ?? fallbackFriendId;
}

export function SplitTypeToggle({
  value,
  onChange,
}: {
  value: SplitType;
  onChange: (t: SplitType) => void;
}) {
  const options = [
    { value: "EQUAL", label: "Split equally" },
    { value: "EXACT", label: "Split exactly" },
  ] as const;

  function selectNext(current: SplitType, direction: 1 | -1) {
    const index = options.findIndex((option) => option.value === current);
    const next = options[(index + direction + options.length) % options.length];
    onChange(next.value);
  }

  return (
    <div
      className="flex gap-1 rounded-2xl border border-border/70 bg-card/80 p-1 shadow-sm"
      role="radiogroup"
      aria-label="Split type"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              selectNext(value, 1);
            }
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              selectNext(value, -1);
            }
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              onChange(option.value);
            }
          }}
          className={cn(
            "flex-1 rounded-xl py-2 text-sm font-bold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            value === option.value
              ? "bg-primary text-primary-foreground shadow-[0_10px_20px_-14px_hsl(var(--primary))]"
              : "text-muted-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
