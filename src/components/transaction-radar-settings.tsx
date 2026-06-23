"use client";

import { useState, type ComponentType } from "react";
import {
  EyeOff,
  Loader2,
  MailCheck,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useRepository } from "@/hooks/use-repository";
import { useTransactionRadar } from "@/hooks/use-transaction-radar";
import type { TransactionRadarSettings } from "@/lib/models";
import {
  createGmailOAuthUrl,
  disconnectGmailRadar,
  syncGmailTransactions,
} from "@/services/gmail-radar";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";

export function TransactionRadarSettings() {
  const repo = useRepository();
  const { user } = useAuth();
  const { settings, candidates, rules } = useTransactionRadar();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const showToast = useUiStore((s) => s.showToast);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const connected = settings?.gmailConnected === true;
  const scanStatus = settings?.scanStatus ?? "disconnected";

  async function updateRadar(patch: Partial<TransactionRadarSettings>) {
    if (!repo) return;
    await runSyncing(() => repo.upsertTransactionRadarSettings(patch), {
      loading: "Updating Transaction Radar...",
      success: "Transaction Radar updated.",
      error: "Could not update Transaction Radar.",
    });
  }

  async function connectGmail() {
    setOauthBusy(true);
    setOauthError(null);
    try {
      const url = await createGmailOAuthUrl();
      window.location.assign(url);
    } catch (err) {
      setOauthError(
        err instanceof Error
          ? err.message
          : "Could not start Gmail connection."
      );
    } finally {
      setOauthBusy(false);
    }
  }

  async function useForwardingFallback() {
    await updateRadar({
      gmailConnected: true,
      gmailEmail: user?.email ?? "",
      scanStatus: "active",
      connectedAt: Date.now(),
      retentionDays: settings?.retentionDays ?? 30,
      rawEmailRetention: settings?.rawEmailRetention ?? "24h",
      ignoredMerchants: settings?.ignoredMerchants ?? [],
      activeFilters:
        settings?.activeFilters && settings.activeFilters.length > 0
          ? settings.activeFilters
          : [
              "bank-alerts",
              "card-receipts",
              "upi-confirmations",
              "merchant-receipts",
            ],
    });
  }

  async function syncNow() {
    setSyncBusy(true);
    setOauthError(null);
    try {
      const result = await syncGmailTransactions();
      showToast({
        title: "Gmail sync complete",
        body: `${result.created} new candidate${result.created === 1 ? "" : "s"} from ${result.scanned} message${result.scanned === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "Could not sync Gmail.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function disconnect() {
    if (!repo) return;
    await runSyncing(
      async () => {
        try {
          await disconnectGmailRadar();
        } catch {
          await repo.upsertTransactionRadarSettings({
            gmailConnected: false,
            scanStatus: "disconnected",
          });
        }
      },
      {
        loading: "Disconnecting Gmail...",
        success: "Gmail disconnected.",
        error: "Could not disconnect Gmail.",
      }
    );
  }

  async function deleteDetectedData() {
    if (!repo) return;
    await runSyncing(() => repo.deleteAllTransactionCandidates(), {
      loading: "Deleting detected transactions...",
      success: "Detected transactions deleted.",
      error: "Could not delete detected transactions.",
    });
    showToast({
      title: "Gmail-derived data cleared",
      body: "Confirmed ledger expenses were left untouched.",
    });
  }

  async function expireOldCandidates() {
    if (!repo) return;
    const expired = await runSyncing(
      () => repo.expireStaleTransactionCandidates(),
      {
        loading: "Expiring old candidates...",
        success: "Old candidates expired.",
        error: "Could not expire candidates.",
      }
    );
    showToast({
      title: "Retention cleanup complete",
      body: `${expired} candidate${expired === 1 ? "" : "s"} expired.`,
    });
  }

  return (
    <Card className="space-y-5 border-primary/10 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MailCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="font-black">Gmail Transaction Radar</p>
              <p className="text-sm text-muted-foreground">
                Detected transactions stay private until you add them.
              </p>
            </div>
          </div>
        </div>
        <Badge
          variant={
            scanStatus === "active"
              ? "success"
              : scanStatus === "paused"
                ? "outline"
                : "muted"
          }
        >
          {scanStatus === "active"
            ? "Active"
            : scanStatus === "paused"
              ? "Paused"
              : "Disconnected"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <TrustPoint
          icon={ShieldCheck}
          title="Private by default"
          body="Groups never see Gmail detections before you confirm."
        />
        <TrustPoint
          icon={EyeOff}
          title="Structured storage"
          body="SplitSync stores parsed fields, not long-lived raw email bodies."
        />
        <TrustPoint
          icon={MailCheck}
          title="Explainable nudges"
          body="Each suggestion says why it matched a group or friend."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Connected Gmail account</Label>
          <p className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-sm font-semibold">
            {connected ? settings?.gmailEmail || user?.email || "Connected" : "Not connected"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="radar-retention">Candidate retention</Label>
          <NativeSelect
            id="radar-retention"
            value={String(settings?.retentionDays ?? 30)}
            onChange={(event) => updateRadar({ retentionDays: Number(event.target.value) })}
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="raw-retention">Raw email handling</Label>
          <NativeSelect
            id="raw-retention"
            value={settings?.rawEmailRetention ?? "24h"}
            onChange={(event) =>
              updateRadar({
                rawEmailRetention: event.target.value as "none" | "24h" | "until-reviewed",
              })
            }
          >
            <option value="none">Do not retain raw body</option>
            <option value="24h">Retain up to 24h for review</option>
            <option value="until-reviewed">Retain until reviewed</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label>Recent detections</Label>
          <p className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-sm font-semibold">
            {candidates.length} private candidate{candidates.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Last Gmail sync</Label>
          <p className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-sm font-semibold">
            {settings?.lastSyncedAt
              ? new Date(settings.lastSyncedAt).toLocaleString()
              : "Not synced yet"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Gmail watch</Label>
          <p className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-sm font-semibold">
            {settings?.gmailWatchExpiresAt
              ? `Expires ${new Date(settings.gmailWatchExpiresAt).toLocaleDateString()}`
              : "Scheduled sync fallback"}
          </p>
        </div>
      </div>

      {(oauthError || settings?.lastSyncError) && (
        <p className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
          {oauthError || settings?.lastSyncError}
        </p>
      )}

      <div className="space-y-2">
        <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
          Recent detections audit log
        </p>
        <div className="space-y-2">
          {candidates.slice(0, 5).map((candidate) => (
            <div
              key={candidate.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate font-semibold">
                {candidate.merchant}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {candidate.status} · {new Date(candidate.detectedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
          {candidates.length === 0 && (
            <p className="rounded-xl border border-border/70 px-3 py-2 text-sm text-muted-foreground">
              No Gmail detections yet.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
          Active Gmail filters
        </p>
        <div className="flex flex-wrap gap-2">
          {(settings?.activeFilters?.length
            ? settings.activeFilters
            : ["bank-alerts", "card-receipts", "upi-confirmations", "merchant-receipts"]
          ).map((filter) => (
            <Badge key={filter} variant="outline">
              {filter.replace(/-/g, " ")}
            </Badge>
          ))}
        </div>
      </div>

      {settings?.ignoredMerchants && settings.ignoredMerchants.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
            Ignored merchants
          </p>
          <div className="flex flex-wrap gap-2">
            {settings.ignoredMerchants.map((merchant) => (
              <Badge key={merchant} variant="muted">
                {merchant}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">
            Active one-tap rules
          </p>
          <div className="space-y-2">
            {rules.slice(0, 4).map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate font-semibold">
                  {rule.merchantPattern || rule.senderPattern || "Any merchant"}
                </span>
                <Badge variant={rule.status === "paused" ? "outline" : "default"}>
                  {rule.status.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        {!connected ? (
          <Button onClick={connectGmail} disabled={oauthBusy}>
            {oauthBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
            Connect Gmail
          </Button>
        ) : scanStatus === "active" ? (
          <Button variant="outline" onClick={() => updateRadar({ scanStatus: "paused" })}>
            <Pause className="h-4 w-4" />
            Pause capture
          </Button>
        ) : (
          <Button onClick={() => updateRadar({ scanStatus: "active" })}>
            <Play className="h-4 w-4" />
            Resume capture
          </Button>
        )}
        <Button variant="outline" onClick={syncNow} disabled={!connected || syncBusy}>
          {syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync now
        </Button>
        <Button
          variant="outline"
          onClick={disconnect}
          disabled={!connected}
        >
          Disconnect
        </Button>
        {!connected && (
          <Button variant="outline" onClick={useForwardingFallback}>
            Use forwarding fallback
          </Button>
        )}
        <Button
          variant="outline"
          onClick={expireOldCandidates}
          disabled={candidates.length === 0}
        >
          Expire old candidates
        </Button>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={deleteDetectedData}
          disabled={candidates.length === 0}
        >
          <Trash2 className="h-4 w-4" />
          Delete detected data
        </Button>
      </div>
    </Card>
  );
}

function TrustPoint({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 px-3 py-3">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-2 text-sm font-black">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}
