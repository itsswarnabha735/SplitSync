"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import type { AdHocPayment, Friend, FriendWithBalance } from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import { currencySymbol, SUPPORTED_CURRENCIES } from "@/lib/currency";
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
import { NativeSelect } from "@/components/ui/native-select";

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

export function EditAdHocPaymentDialog({
  payment,
  friend,
  open,
  onOpenChange,
}: {
  payment: AdHocPayment | null;
  friend: Friend | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const [fromFriendId, setFromFriendId] = useState<string>(YOU_ID);
  const [toFriendId, setToFriendId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dateStr, setDateStr] = useState(() => toDateInputValue());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!payment || !friend || !open) return;
    setFromFriendId(
      payment.fromFriendId === YOU_ID || payment.fromFriendId === friend.id
        ? payment.fromFriendId
        : YOU_ID
    );
    setToFriendId(
      payment.toFriendId === YOU_ID || payment.toFriendId === friend.id
        ? payment.toFriendId
        : friend.id
    );
    setAmountStr(String(payment.amount));
    setCurrency(payment.currency);
    setDateStr(toDateInputValue(new Date(payment.timestamp)));
    setError(null);
    setSaving(false);
  }, [friend, open, payment]);

  if (!payment || !friend) return null;

  const participants = [
    { id: YOU_ID, name: "You" },
    { id: friend.id, name: friend.name },
  ];

  async function handleSave() {
    if (!repo || !payment) return;
    const amountCents = parseMoneyInputToCents(amountStr);
    if (amountCents === null) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (fromFriendId === toFriendId) {
      setError("Payer and receiver must be different.");
      return;
    }
    const timestamp = dateInputToLocalTimestamp(dateStr) ?? payment.timestamp;
    setSaving(true);
    setError(null);
    try {
      await runSyncing(
        () =>
          repo.updateAdHocPayment(payment.id, {
            fromFriendId,
            toFriendId,
            amount: centsToMoney(amountCents),
            currency,
            timestamp,
          }),
        {
          loading: "Updating settlement...",
          success: "Settlement updated.",
          error: "Could not update settlement.",
        }
      );
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update settlement."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit settlement</DialogTitle>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-adhoc-payment-from">Paid by</Label>
              <NativeSelect
                id="edit-adhoc-payment-from"
                value={fromFriendId}
                onChange={(event) => {
                  const next = event.target.value;
                  setFromFriendId(next);
                  if (next === toFriendId) {
                    setToFriendId(next === YOU_ID ? friend.id : YOU_ID);
                  }
                  setError(null);
                }}
              >
                {participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participant.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-adhoc-payment-to">Received by</Label>
              <NativeSelect
                id="edit-adhoc-payment-to"
                value={toFriendId}
                onChange={(event) => {
                  setToFriendId(event.target.value);
                  setError(null);
                }}
              >
                {participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participant.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-adhoc-payment-amount">Amount</Label>
              <Input
                id="edit-adhoc-payment-amount"
                inputMode="decimal"
                value={amountStr}
                onChange={(event) => {
                  setAmountStr(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-adhoc-payment-currency">Currency</Label>
              <NativeSelect
                id="edit-adhoc-payment-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {SUPPORTED_CURRENCIES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-adhoc-payment-date">Date</Label>
              <Input
                id="edit-adhoc-payment-date"
                type="date"
                value={dateStr}
                onChange={(event) => setDateStr(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save settlement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function toDateInputValue(date: Date = new Date()): string {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function dateInputToLocalTimestamp(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}
