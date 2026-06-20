"use client";

import { useEffect, useMemo, useState } from "react";

import type { Friend, SplitType } from "@/lib/models";
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  friends: Friend[];
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
    setSplit(emptySplitState(participants));
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
    setError(null);
    setSaving(false);
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
