"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

import type { SplitType } from "@/lib/models";
import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { buildSplits } from "@/lib/splits";
import { useGroupDetail } from "@/hooks/use-group-detail";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  SplitEditor,
  emptySplitState,
  type SplitState,
} from "@/components/split-editor";
import { SplitTypeToggle } from "@/components/dialogs/add-adhoc-expense-dialog";

export default function AddExpensePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { members } = useGroupDetail(groupId);

  const participants = useMemo(
    () => members.map((m) => ({ id: m.id, name: m.name })),
    [members]
  );

  const [description, setDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [paidBy, setPaidBy] = useState<string>("");
  const [currency, setCurrency] = useState("USD");
  const [dateStr, setDateStr] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [splitType, setSplitType] = useState<SplitType>("EQUAL");
  const [split, setSplit] = useState<SplitState>({
    equalSelections: {},
    exactInputs: {},
  });
  const [error, setError] = useState<string | null>(null);

  const amount = parseFloat(amountStr) || 0;

  // Default all members into the equal split as they load.
  useEffect(() => {
    if (participants.length === 0) return;
    setSplit((prev) => {
      const equalSelections = { ...prev.equalSelections };
      let changed = false;
      for (const p of participants) {
        if (!(p.id in equalSelections)) {
          equalSelections[p.id] = true;
          changed = true;
        }
      }
      return changed ? { ...prev, equalSelections } : prev;
    });
    if (!paidBy && participants[0]) setPaidBy(participants[0].id);
  }, [participants, paidBy]);

  async function handleSave() {
    if (!description.trim()) {
      setError("Description cannot be empty.");
      return;
    }
    if (amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (!paidBy) {
      setError("Please select who paid for the expense.");
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
      participantLabel: "member",
    });
    if (!result.ok) {
      setError(result.error ?? "Invalid split.");
      return;
    }
    if (!repo) return;

    await runSyncing(() =>
      repo.createExpenseWithSplits({
        groupId,
        description,
        amount,
        paidById: paidBy,
        splitType,
        splits: result.splits,
        timestamp: new Date(dateStr).getTime() || Date.now(),
        currency,
      })
    );
    router.push(`/groups/${groupId}`);
  }

  return (
    <div className="pb-24">
      <AppHeader title="Log new expense" showBack />

      <main className="container space-y-4 py-5">
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Card className="space-y-4 p-5">
          <p className="text-xs font-black uppercase tracking-wide text-primary">
            Expense details
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="exp-desc">Description</Label>
            <Input
              id="exp-desc"
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
              <Label htmlFor="exp-amount">Amount</Label>
              <Input
                id="exp-amount"
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
              <Label htmlFor="exp-paidby">Paid by</Label>
              <NativeSelect
                id="exp-paidby"
                value={paidBy}
                onChange={(e) => {
                  setPaidBy(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Select payer…</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input
                id="exp-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-currency">Currency</Label>
              <NativeSelect
                id="exp-currency"
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
        </Card>

        <SplitTypeToggle value={splitType} onChange={setSplitType} />

        <p className="px-1 text-xs text-muted-foreground">
          {splitType === "EQUAL"
            ? "Who is included in this purchase? Choose anyone participating."
            : "Type the exact amount each member is responsible for."}
        </p>

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
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/90 p-4 backdrop-blur">
        <div className="container">
          <Button className="w-full" size="lg" onClick={handleSave}>
            Save expense
          </Button>
        </div>
      </div>
    </div>
  );
}
