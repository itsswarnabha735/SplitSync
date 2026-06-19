"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import type { FriendWithBalance } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
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

export function SettleAdHocDialog({
  target,
  onClose,
}: {
  target: FriendWithBalance | null;
  onClose: () => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (target) {
      setAmountStr(Math.abs(target.netBalance).toFixed(2));
      setError(null);
    }
  }, [target]);

  if (!target) return null;

  const symbol = currencySymbol(target.currency);
  // Positive balance => friend owes you (friend pays). Negative => you pay.
  const friendOwesYou = target.netBalance > 0;
  const fromName = friendOwesYou ? target.friend.name : "You";
  const toName = friendOwesYou ? "You" : target.friend.name;

  async function handleConfirm() {
    if (!target) return;
    const amountCents = parseMoneyInputToCents(amountStr);
    if (amountCents === null) {
      setError("Amount must be greater than 0.");
      return;
    }
    const outstandingCents = toCurrencyCents(Math.abs(target.netBalance));
    if (amountCents > outstandingCents) {
      setError(
        `Amount cannot exceed the outstanding balance (${symbol}${Math.abs(
          target.netBalance
        ).toFixed(2)}).`
      );
      return;
    }
    if (!repo) return;
    setRecording(true);
    try {
      await runSyncing(
        () =>
          repo.recordAdHocPayment({
            fromFriendId: friendOwesYou ? target.friend.id : YOU_ID,
            toFriendId: friendOwesYou ? YOU_ID : target.friend.id,
            amount: centsToMoney(amountCents),
            currency: target.currency,
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
    <Dialog open={!!target} onOpenChange={(o) => !o && !recording && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a settlement</DialogTitle>
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
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-border/70 bg-muted/50 px-4 py-3">
            <div className="flex-1 rounded-2xl bg-destructive/10 px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-destructive">PAYS</p>
              <p className="font-bold">{fromName}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1 rounded-2xl bg-success/15 px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-success">
                RECEIVES
              </p>
              <p className="font-bold">{toName}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settle-amount">Amount ({symbol})</Label>
            <Input
              id="settle-amount"
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
            {recording ? "Recording..." : "Confirm settlement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
