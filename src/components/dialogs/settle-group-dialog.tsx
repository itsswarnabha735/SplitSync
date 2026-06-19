"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import type { DebtOverview } from "@/lib/models";
import { currencySymbol } from "@/lib/currency";
import {
  centsToMoney,
  parseMoneyInputToCents,
  toCurrencyCents,
} from "@/lib/money";
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

export function SettleGroupDialog({
  groupId,
  debt,
  onClose,
}: {
  groupId: string;
  debt: DebtOverview | null;
  onClose: () => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (debt) {
      setAmountStr(debt.amount.toFixed(2));
      setError(null);
    }
  }, [debt]);

  if (!debt) return null;
  const symbol = currencySymbol(debt.currency);

  async function handleConfirm() {
    if (!repo || !debt) return;
    const amountCents = parseMoneyInputToCents(amountStr);
    if (amountCents === null) {
      setError("Amount must be greater than 0.");
      return;
    }
    const outstandingCents = toCurrencyCents(debt.amount);
    if (amountCents > outstandingCents) {
      setError(
        `Amount cannot exceed the outstanding balance (${symbol}${debt.amount.toFixed(
          2
        )}).`
      );
      return;
    }
    setRecording(true);
    try {
      await runSyncing(
        () =>
          repo.recordPayment({
            groupId,
            fromMemberId: debt.debtor.id,
            toMemberId: debt.creditor.id,
            amount: centsToMoney(amountCents),
            currency: debt.currency,
            timestamp: Date.now(),
          }),
        {
          loading: "Recording settlement...",
          success: "Settlement recorded.",
          error: "Could not record settlement.",
        }
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not record settlement."
      );
    } finally {
      setRecording(false);
    }
  }

  return (
    <Dialog open={!!debt} onOpenChange={(o) => !o && !recording && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record settle-up payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <p className="text-sm font-semibold text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center justify-center gap-3 rounded-xl bg-muted px-4 py-3">
            <div className="flex-1 rounded-lg bg-destructive/10 px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-destructive">PAYS</p>
              <p className="font-bold">{debt.debtor.name}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1 rounded-lg bg-success/15 px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-success">
                RECEIVES
              </p>
              <p className="font-bold">{debt.creditor.name}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-settle-amount">Amount ({symbol})</Label>
            <Input
              id="group-settle-amount"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value);
                setError(null);
              }}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={recording}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={recording}>
            {recording ? "Recording..." : "Confirm settle"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
