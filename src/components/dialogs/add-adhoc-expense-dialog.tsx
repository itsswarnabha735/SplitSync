"use client";

import { useMemo, useState } from "react";

import type { Friend, SplitType } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
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

  const participants = useMemo<Participant[]>(
    () => [{ id: YOU_ID, name: "You" }, ...friends.map((f) => ({ id: f.id, name: f.name }))],
    [friends]
  );

  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidBy, setPaidBy] = useState<string>(YOU_ID);
  const [currency, setCurrency] = useState("USD");
  const [splitType, setSplitType] = useState<SplitType>("EQUAL");
  const [split, setSplit] = useState<SplitState>(() =>
    emptySplitState(participants)
  );
  const [error, setError] = useState<string | null>(null);

  const amount = parseFloat(amountStr) || 0;

  function reset() {
    setDescription("");
    setAmountStr("");
    setPaidBy(YOU_ID);
    setCurrency("USD");
    setSplitType("EQUAL");
    setSplit(emptySplitState(participants));
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

    await runSyncing(() =>
      repo.createAdHocExpenseWithSplits({
        description,
        amount,
        paidByFriendId: paidBy,
        splitType,
        splits: result.splits,
        currency,
      })
    );
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log a shared expense</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save expense</Button>
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
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {(["EQUAL", "EXACT"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "flex-1 rounded-md py-2 text-sm font-bold transition-colors",
            value === t
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground"
          )}
        >
          {t === "EQUAL" ? "Split equally" : "Split exactly"}
        </button>
      ))}
    </div>
  );
}
