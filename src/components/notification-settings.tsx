"use client";

import { useMemo, useState } from "react";
import { BellRing, BellOff, Loader2 } from "lucide-react";

import { SUPPORTED_CURRENCIES } from "@/lib/currency";
import { useNotificationPreferences } from "@/hooks/use-notifications";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export function NotificationSettings() {
  const { preferences, updatePreferences } = useNotificationPreferences();
  const push = usePushNotifications({ preferences, updatePreferences });
  const [thresholdCurrency, setThresholdCurrency] = useState("USD");
  const currentThreshold = useMemo(
    () => preferences.largeExpenseThresholds[thresholdCurrency] ?? "",
    [preferences.largeExpenseThresholds, thresholdCurrency]
  );
  const unsupported = push.supported === false;
  const blocked = push.permission === "denied";

  function updateThreshold(value: string) {
    const parsed = Number(value);
    const next = { ...preferences.largeExpenseThresholds };
    if (!value || Number.isNaN(parsed) || parsed <= 0) {
      delete next[thresholdCurrency];
    } else {
      next[thresholdCurrency] = parsed;
    }
    void updatePreferences({ largeExpenseThresholds: next });
  }

  return (
    <Card className="space-y-3 border-primary/10 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black">Notifications</p>
          <p className="mt-1 text-sm text-muted-foreground">
            In-app notifications are always available. Browser push is enabled
            per device.
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {push.enabled ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <BellOff className="h-5 w-5" />
          )}
        </span>
      </div>

      {push.error && (
        <p
          className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
          role="alert"
        >
          {push.error}
        </p>
      )}

      {unsupported ? (
        <p className="text-sm font-semibold text-muted-foreground">
          This browser does not support Firebase browser push notifications.
        </p>
      ) : blocked ? (
        <p className="text-sm font-semibold text-destructive">
          Browser notification permission is blocked. Enable it in browser
          settings to receive push notifications.
        </p>
      ) : (
        <Button
          variant={push.enabled ? "outline" : "default"}
          disabled={push.busy || push.supported === null}
          onClick={() => {
            if (push.enabled) void push.disable();
            else void push.enable();
          }}
        >
          {push.busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {push.enabled ? "Disable browser push" : "Enable browser push"}
        </Button>
      )}

      <div className="grid grid-cols-1 gap-3 border-t border-border/60 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="large-expense-currency">Large expense currency</Label>
          <NativeSelect
            id="large-expense-currency"
            value={thresholdCurrency}
            onChange={(event) => setThresholdCurrency(event.target.value)}
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="large-expense-threshold">Large expense threshold</Label>
          <Input
            id="large-expense-threshold"
            inputMode="decimal"
            placeholder="No alert"
            value={currentThreshold}
            onChange={(event) => updateThreshold(event.target.value)}
          />
        </div>
      </div>
    </Card>
  );
}
