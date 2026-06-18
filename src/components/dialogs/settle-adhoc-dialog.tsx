"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import type { FriendWithBalance } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import { currencySymbol } from "@/lib/currency";
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
    const amount = parseFloat(amountStr);
    if (Number.isNaN(amount) || amount <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (!repo) return;
    await runSyncing(() =>
      repo.recordAdHocPayment({
        fromFriendId: friendOwesYou ? target.friend.id : YOU_ID,
        toFriendId: friendOwesYou ? YOU_ID : target.friend.id,
        amount,
        currency: target.currency,
        timestamp: Date.now(),
      })
    );
    onClose();
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a settlement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <p className="text-sm font-semibold text-destructive">{error}</p>
          )}
          <div className="flex items-center justify-center gap-3 rounded-xl bg-muted px-4 py-3">
            <div className="flex-1 rounded-lg bg-destructive/10 px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-destructive">PAYS</p>
              <p className="font-bold">{fromName}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1 rounded-lg bg-success/15 px-3 py-2 text-center">
              <p className="text-[10px] font-bold text-[hsl(142_71%_30%)]">
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Confirm settlement</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
