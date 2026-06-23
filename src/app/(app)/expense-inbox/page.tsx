"use client";

import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Inbox,
  MailPlus,
  Paperclip,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

import type {
  TransactionCandidate,
  TransactionRule,
  TransactionSuggestedTarget,
} from "@/lib/models";
import { YOU_ID } from "@/lib/models";
import { formatMoney } from "@/lib/currency";
import { type ExpenseCategorySlug } from "@/lib/expense-categories";
import {
  buildTransactionFingerprint,
  enrichCandidateContext,
  normalizeMerchant,
  parseGmailTransactionCandidate,
  reasonLabel,
  statusLabel,
  type GroupContextSlice,
} from "@/lib/transaction-radar";
import { useAuth } from "@/hooks/use-auth";
import { useGroups } from "@/hooks/use-groups";
import { useFriends } from "@/hooks/use-friends";
import { useRepository } from "@/hooks/use-repository";
import { useTransactionRadar } from "@/hooks/use-transaction-radar";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";

type InboxTab = "suggested" | "needs-context" | "duplicates" | "personal" | "rules";
type CandidateEditPatch = Pick<
  TransactionCandidate,
  "merchant" | "amount" | "currency" | "transactionAt"
>;
type CandidateEditDraft = {
  merchant: string;
  amount: string;
  currency: string;
  transactionAt: string;
};

export default function ExpenseInboxPage() {
  const router = useRouter();
  const repo = useRepository();
  const { user } = useAuth();
  const { groups } = useGroups();
  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);
  const { friends, adHocExpenses, groupSlices } = useFriends(groupIds);
  const { candidates, rules, settings } = useTransactionRadar();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const showToast = useUiStore((s) => s.showToast);
  const [activeTab, setActiveTab] = useState<InboxTab>("suggested");
  const [gmailText, setGmailText] = useState("");
  const [targetOverrides, setTargetOverrides] = useState<Record<string, string>>(
    {}
  );
  const [handledNotificationAction, setHandledNotificationAction] = useState("");

  const radarGroupSlices = useMemo<GroupContextSlice[]>(
    () =>
      groups.map((group) => {
        const slice = groupSlices[group.id] ?? {
          members: [],
          expenses: [],
          payments: [],
        };
        return {
          group,
          members: slice.members,
          expenses: slice.expenses.map((expense) => ({
            id: expense.id,
            description: expense.description,
            amount: expense.amount,
            currency: expense.currency,
            timestamp: expense.timestamp,
            paidById: expense.paidById,
            splits: expense.splits,
            transactionFingerprint: expense.transactionFingerprint,
          })),
        };
      }),
    [groups, groupSlices]
  );

  const visible = useMemo(
    () => ({
      suggested: candidates.filter((item) => item.status === "suggested"),
      "needs-context": candidates.filter((item) => item.status === "new"),
      duplicates: candidates.filter((item) => item.status === "duplicate"),
      personal: candidates.filter((item) =>
        ["personal", "ignored", "expired"].includes(item.status)
      ),
    }),
    [candidates]
  );

  const targetOptions = useMemo(
    () => [
      ...groups
        .filter((group) => group.status !== "archived")
        .map((group) => ({
          value: `group:${group.id}`,
          label: `Group · ${group.name}`,
        })),
      ...friends.map((friend) => ({
        value: `friend:${friend.id}`,
        label: `Friend · ${friend.name}`,
      })),
    ],
    [friends, groups]
  );

  async function parsePastedGmail() {
    if (!repo || !gmailText.trim()) return;
    const candidate = parseGmailTransactionCandidate(
      {
        messageId: `gmail-${Date.now()}`,
        sender: "forwarded@gmail.local",
        subject: gmailText.split("\n")[0] || "Forwarded Gmail transaction",
        snippet: gmailText,
        body: gmailText,
        receivedAt: Date.now(),
      },
      {
        userId: repo.uid,
        retentionDays: settings?.retentionDays ?? 30,
      }
    );
    if (!candidate) {
      showToast({
        title: "No transaction found",
        body: "This does not look like a payment or receipt email.",
      });
      return;
    }
    if (
      settings?.ignoredMerchants?.some(
        (merchant) => merchant === candidate.normalizedMerchant
      )
    ) {
      showToast({
        title: "Merchant is ignored",
        body: `${candidate.merchant} is currently suppressed in Transaction Radar.`,
      });
      return;
    }
    const enriched = enrichCandidateContext({
      candidate,
      groupSlices: radarGroupSlices,
      friends,
      adHocExpenses,
      rules,
    });
    await runSyncing(() => repo.upsertTransactionCandidate(enriched), {
      loading: "Creating private suggestion...",
      success: "Transaction candidate added.",
      error: "Could not create transaction candidate.",
    });
    setGmailText("");
    setActiveTab(
      enriched.status === "duplicate"
        ? "duplicates"
        : enriched.status === "new"
          ? "needs-context"
          : "suggested"
    );
  }

  async function addCandidate(candidate: TransactionCandidate) {
    if (!repo) return;
    const target = resolveTarget(candidate);
    if (!target) {
      showToast({
        title: "Choose a target first",
        body: "Select a group or friend before adding this transaction.",
      });
      return;
    }
    if (target.kind === "group") {
      const slice = radarGroupSlices.find((item) => item.group.id === target.targetId);
      const payer = slice?.members.find((member) => member.linkedUid === user?.uid);
      const suggestedParticipants =
        candidate.suggestedSplit?.participantIds?.filter((id) =>
          slice?.members.some((member) => member.id === id)
        ) ?? [];
      const participants =
        suggestedParticipants.length > 0
          ? suggestedParticipants
          : slice?.members.map((member) => member.id) ?? [];
      if (!slice || !payer || participants.length === 0) {
        showToast({
          title: "Cannot add to group",
          body: "The group needs a linked member for your account.",
        });
        return;
      }
      await runSyncing(
        () =>
          repo.confirmTransactionCandidateAsGroupExpense({
            candidate,
            groupId: target.targetId,
            description: candidate.merchant,
            amount: candidate.amount,
            paidById: payer.id,
            splitType: "EQUAL",
            splits: equalSplits(participants, candidate.amount),
            timestamp: candidate.transactionAt,
            currency: candidate.currency,
            category: candidate.category,
          }),
        {
          loading: "Adding expense...",
          success: "Expense added to group.",
          error: "Could not add expense.",
        }
      );
      return;
    }

    const friend = friends.find((item) => item.id === target.targetId);
    if (!friend) return;
    await runSyncing(
      () =>
        repo.confirmTransactionCandidateAsAdHocExpense({
          candidate,
          description: candidate.merchant,
          amount: candidate.amount,
          paidByFriendId: YOU_ID,
          splitType: "EQUAL",
          splits: equalSplits([YOU_ID, friend.id], candidate.amount),
          timestamp: candidate.transactionAt,
          currency: candidate.currency,
          category: candidate.category,
        }),
      {
        loading: "Adding friend expense...",
        success: "Friend expense added.",
        error: "Could not add friend expense.",
      }
    );
  }

  async function markPersonal(candidate: TransactionCandidate) {
    if (!repo) return;
    await repo.updateTransactionCandidateStatus(candidate.id, "personal");
  }

  async function attachEvidence(candidate: TransactionCandidate) {
    if (!repo) return;
    await runSyncing(() => repo.attachTransactionCandidateEvidence(candidate), {
      loading: "Attaching Gmail evidence...",
      success: "Gmail evidence attached.",
      error: "Could not attach Gmail evidence.",
    });
  }

  async function editCandidate(
    candidate: TransactionCandidate,
    patch: CandidateEditPatch
  ) {
    if (!repo) return;
    const normalizedMerchant = normalizeMerchant(patch.merchant);
    const edited = {
      ...candidate,
      ...patch,
      merchant: patch.merchant.trim() || candidate.merchant,
      currency: patch.currency.trim().toUpperCase() || candidate.currency,
      normalizedMerchant: normalizedMerchant || candidate.normalizedMerchant,
    };
    const withFingerprint: TransactionCandidate = {
      ...edited,
      fingerprint: buildTransactionFingerprint({
        merchant: edited.normalizedMerchant,
        amount: edited.amount,
        currency: edited.currency,
        transactionAt: edited.transactionAt,
        sourceSender: edited.sourceSender,
      }),
    };
    const enriched = enrichCandidateContext({
      candidate: withFingerprint,
      groupSlices: radarGroupSlices,
      friends,
      adHocExpenses,
      rules,
    });
    await runSyncing(() => repo.upsertTransactionCandidate(enriched), {
      loading: "Updating suggestion...",
      success: "Suggestion updated.",
      error: "Could not update suggestion.",
    });
  }

  async function ignoreMerchant(candidate: TransactionCandidate) {
    if (!repo) return;
    const ignored = new Set(settings?.ignoredMerchants ?? []);
    ignored.add(candidate.normalizedMerchant);
    await runSyncing(
      async () => {
        await repo.updateTransactionCandidateStatus(candidate.id, "ignored");
        await repo.upsertTransactionRadarSettings({
          ignoredMerchants: Array.from(ignored),
        });
      },
      {
        loading: "Ignoring merchant...",
        success: "Merchant ignored.",
        error: "Could not ignore merchant.",
      }
    );
  }

  async function createRule(candidate: TransactionCandidate) {
    if (!repo || !candidate.suggestedTarget) return;
    await runSyncing(
      () =>
        repo.createTransactionRule({
          status: "suggest_only",
          merchantPattern: candidate.normalizedMerchant,
          senderPattern: candidate.sourceSender,
          category: candidate.category as ExpenseCategorySlug,
          currency: candidate.currency,
          targetKind: candidate.suggestedTarget!.kind,
          targetId: candidate.suggestedTarget!.targetId,
          splitPreset: "equal",
          createdFromCandidateId: candidate.id,
        }),
      {
        loading: "Creating rule...",
        success: "One-tap rule created.",
        error: "Could not create rule.",
      }
    );
  }

  async function toggleRule(rule: TransactionRule) {
    if (!repo) return;
    await repo.updateTransactionRule(rule.id, {
      status: rule.status === "paused" ? "suggest_only" : "paused",
    });
  }

  async function deleteRule(rule: TransactionRule) {
    if (!repo) return;
    await runSyncing(() => repo.deleteTransactionRule(rule.id), {
      loading: "Deleting rule...",
      success: "Rule deleted.",
      error: "Could not delete rule.",
    });
  }

  function resolveTarget(
    candidate: TransactionCandidate
  ): TransactionSuggestedTarget | undefined {
    const override = targetOverrides[candidate.id];
    if (!override) return candidate.suggestedTarget;
    const [kind, targetId] = override.split(":");
    if (kind === "group") {
      const group = groups.find((item) => item.id === targetId);
      if (!group) return undefined;
      return {
        kind,
        targetId,
        targetName: group.name,
        reasonCodes: ["user_rule_match"],
        confidence: 1,
      };
    }
    const friend = friends.find((item) => item.id === targetId);
    if (!friend) return undefined;
    return {
      kind: "friend",
      targetId,
      targetName: friend.name,
      reasonCodes: ["user_rule_match"],
      confidence: 1,
    };
  }

  useEffect(() => {
    if (typeof window === "undefined" || candidates.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const candidateId = params.get("candidateId") ?? "";
    const action = params.get("candidateAction") ?? "";
    const actionKey = `${candidateId}:${action}`;
    if (!candidateId || !action || handledNotificationAction === actionKey) return;
    const candidate = candidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    setHandledNotificationAction(actionKey);
    if (candidate.status === "duplicate") setActiveTab("duplicates");
    else if (candidate.status === "new") setActiveTab("needs-context");
    else setActiveTab("suggested");

    if (action === "personal") {
      void markPersonal(candidate);
    } else if (action === "ignore") {
      void ignoreMerchant(candidate);
    } else if (action === "add" && candidate.suggestedTarget) {
      void addCandidate(candidate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, handledNotificationAction]);

  return (
    <div className="pb-16">
      <AppHeader
        title="Expense Inbox"
        subtitle="Private Gmail suggestions waiting for confirmation"
        showBack
        onBack={() => router.push("/dashboard")}
      />

      <main id="main-content" className="container space-y-5 py-6">
        <Card className="space-y-4 border-primary/10 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MailPlus className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-black">Forwarded Gmail capture</p>
              <p className="text-sm text-muted-foreground">
                Paste a bank alert or receipt email to simulate the Gmail watch
                ingestion path. The saved candidate remains private.
              </p>
            </div>
          </div>
          <textarea
            value={gmailText}
            onChange={(event) => setGmailText(event.target.value)}
            className="min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="Example: INR 920 was spent at Uber India using card ending 1234 on 2026-06-22."
          />
          <div className="flex justify-end">
            <Button onClick={parsePastedGmail} disabled={!gmailText.trim()}>
              <Sparkles className="h-4 w-4" />
              Detect transaction
            </Button>
          </div>
        </Card>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InboxTab)}>
          <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-5">
            <TabsTrigger value="suggested">Suggested</TabsTrigger>
            <TabsTrigger value="needs-context">Needs context</TabsTrigger>
            <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="suggested" className="space-y-3">
            <CandidateList
              items={visible.suggested}
              targetOptions={targetOptions}
              targetOverrides={targetOverrides}
              setTargetOverrides={setTargetOverrides}
              onAdd={addCandidate}
              onEdit={editCandidate}
              onAttach={attachEvidence}
              onPersonal={markPersonal}
              onIgnore={ignoreMerchant}
              onRule={createRule}
              resolveTarget={resolveTarget}
            />
          </TabsContent>
          <TabsContent value="needs-context" className="space-y-3">
            <CandidateList
              items={visible["needs-context"]}
              targetOptions={targetOptions}
              targetOverrides={targetOverrides}
              setTargetOverrides={setTargetOverrides}
              onAdd={addCandidate}
              onEdit={editCandidate}
              onAttach={attachEvidence}
              onPersonal={markPersonal}
              onIgnore={ignoreMerchant}
              onRule={createRule}
              resolveTarget={resolveTarget}
            />
          </TabsContent>
          <TabsContent value="duplicates" className="space-y-3">
            <CandidateList
              items={visible.duplicates}
              targetOptions={targetOptions}
              targetOverrides={targetOverrides}
              setTargetOverrides={setTargetOverrides}
              onAdd={addCandidate}
              onEdit={editCandidate}
              onAttach={attachEvidence}
              onPersonal={markPersonal}
              onIgnore={ignoreMerchant}
              onRule={createRule}
              resolveTarget={resolveTarget}
            />
          </TabsContent>
          <TabsContent value="personal" className="space-y-3">
            <CandidateList
              items={visible.personal}
              targetOptions={targetOptions}
              targetOverrides={targetOverrides}
              setTargetOverrides={setTargetOverrides}
              onAdd={addCandidate}
              onEdit={editCandidate}
              onAttach={attachEvidence}
              onPersonal={markPersonal}
              onIgnore={ignoreMerchant}
              onRule={createRule}
              resolveTarget={resolveTarget}
              readOnly
            />
          </TabsContent>
          <TabsContent value="rules" className="space-y-3">
            {rules.length === 0 ? (
              <EmptyInbox
                title="No one-tap rules yet"
                body="Rules appear after you create them from repeated transaction suggestions."
              />
            ) : (
              rules.map((rule) => (
                <Card key={rule.id} className="border-primary/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-black">
                        {rule.merchantPattern || rule.senderPattern || "Any merchant"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {rule.currency ?? "Any currency"} · {rule.splitPreset} · triggered{" "}
                        {rule.triggerCount} time{rule.triggerCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={rule.status === "paused" ? "outline" : "default"}>
                        {rule.status.replace(/_/g, " ")}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => toggleRule(rule)}>
                        {rule.status === "paused" ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteRule(rule)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function CandidateList({
  items,
  targetOptions,
  targetOverrides,
  setTargetOverrides,
  onAdd,
  onEdit,
  onAttach,
  onPersonal,
  onIgnore,
  onRule,
  resolveTarget,
  readOnly,
}: {
  items: TransactionCandidate[];
  targetOptions: { value: string; label: string }[];
  targetOverrides: Record<string, string>;
  setTargetOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  onAdd: (candidate: TransactionCandidate) => void | Promise<void>;
  onEdit: (
    candidate: TransactionCandidate,
    patch: CandidateEditPatch
  ) => void | Promise<void>;
  onAttach: (candidate: TransactionCandidate) => void | Promise<void>;
  onPersonal: (candidate: TransactionCandidate) => void | Promise<void>;
  onIgnore: (candidate: TransactionCandidate) => void | Promise<void>;
  onRule: (candidate: TransactionCandidate) => void | Promise<void>;
  resolveTarget: (candidate: TransactionCandidate) => TransactionSuggestedTarget | undefined;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState<Record<string, CandidateEditDraft>>({});
  if (items.length === 0) {
    return (
      <EmptyInbox
        title="No detected expenses need review"
        body="New Gmail candidates will appear here after Transaction Radar detects them."
      />
    );
  }
  return (
    <>
      {items.map((candidate) => {
        const target = resolveTarget(candidate);
        const editDraft = editing[candidate.id];
        const evidenceRows = recognitionEvidenceRows(candidate.recognitionEvidence);
        const parsedAmount = editDraft ? Number(editDraft.amount) : candidate.amount;
        const canSaveEdit =
          !!editDraft &&
          editDraft.merchant.trim().length > 0 &&
          Number.isFinite(parsedAmount) &&
          parsedAmount > 0 &&
          /^[A-Z]{3}$/.test(editDraft.currency.trim().toUpperCase()) &&
          Number.isFinite(new Date(editDraft.transactionAt).getTime());
        return (
          <Card key={candidate.id} className="space-y-4 border-primary/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-black">{candidate.merchant}</p>
                  <Badge variant={candidate.status === "duplicate" ? "destructive" : "outline"}>
                    {statusLabel(candidate.status)}
                  </Badge>
                  <Badge variant="muted">Gmail</Badge>
                  {candidate.recognitionMode === "ai" && (
                    <Badge variant="success" className="gap-1">
                      <Sparkles className="h-3 w-3" />
                      AI recognized
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatMoney(candidate.amount, candidate.currency)} ·{" "}
                  {new Date(candidate.transactionAt).toLocaleString()}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-sm font-black">
                  {Math.round(candidate.confidence * 100)}% confidence
                </p>
                <p className="text-xs text-muted-foreground">
                  parse {Math.round(candidate.parseConfidence * 100)}% · context{" "}
                  {Math.round(candidate.contextConfidence * 100)}%
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/35 px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="font-bold">
                    {target
                      ? `Suggested for ${target.targetName}`
                      : "No target selected yet"}
                  </p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {target?.reasonCodes.length
                      ? target.reasonCodes.map(reasonLabel).join("; ")
                      : "Choose a group or friend to create a private draft."}
                  </p>
                </div>
              </div>
            </div>

            {candidate.recognitionMode === "ai" && evidenceRows.length > 0 ? (
              <div className="rounded-xl border border-success/15 bg-success/10 px-3 py-2 text-sm">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <div className="min-w-0">
                    <p className="font-bold">Why this suggestion?</p>
                    <div className="mt-1 grid gap-1 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                      {evidenceRows.map((row) => (
                        <p key={row.label} className="min-w-0">
                          <span className="font-semibold text-foreground">
                            {row.label}:
                          </span>{" "}
                          <span className="break-words">{row.value}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Evidence: {candidate.rawSnippetRedacted}
              </p>
            )}

            {editDraft && (
              <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/35 p-3 sm:grid-cols-[1.3fr_0.8fr_0.7fr_1fr_auto_auto]">
                <Input
                  value={editDraft.merchant}
                  onChange={(event) =>
                    setEditing((current) => ({
                      ...current,
                      [candidate.id]: {
                        ...editDraft,
                        merchant: event.target.value,
                      },
                    }))
                  }
                  aria-label="Merchant"
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={editDraft.amount}
                  onChange={(event) =>
                    setEditing((current) => ({
                      ...current,
                      [candidate.id]: {
                        ...editDraft,
                        amount: event.target.value,
                      },
                    }))
                  }
                  aria-label="Amount"
                />
                <Input
                  value={editDraft.currency}
                  maxLength={3}
                  onChange={(event) =>
                    setEditing((current) => ({
                      ...current,
                      [candidate.id]: {
                        ...editDraft,
                        currency: event.target.value.toUpperCase(),
                      },
                    }))
                  }
                  aria-label="Currency"
                />
                <Input
                  type="datetime-local"
                  value={editDraft.transactionAt}
                  onChange={(event) =>
                    setEditing((current) => ({
                      ...current,
                      [candidate.id]: {
                        ...editDraft,
                        transactionAt: event.target.value,
                      },
                    }))
                  }
                  aria-label="Transaction time"
                />
                <Button
                  onClick={async () => {
                    if (!canSaveEdit) return;
                    await onEdit(candidate, {
                      merchant: editDraft.merchant.trim(),
                      amount: parsedAmount,
                      currency: editDraft.currency.trim().toUpperCase(),
                      transactionAt: new Date(editDraft.transactionAt).getTime(),
                    });
                    setEditing((current) => {
                      const next = { ...current };
                      delete next[candidate.id];
                      return next;
                    });
                  }}
                  disabled={!canSaveEdit}
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setEditing((current) => {
                      const next = { ...current };
                      delete next[candidate.id];
                      return next;
                    })
                  }
                >
                  Cancel
                </Button>
              </div>
            )}

            {!readOnly && (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]">
                <NativeSelect
                  value={
                    targetOverrides[candidate.id] ??
                    (candidate.suggestedTarget
                      ? `${candidate.suggestedTarget.kind}:${candidate.suggestedTarget.targetId}`
                      : "")
                  }
                  onChange={(event) =>
                    setTargetOverrides((current) => ({
                      ...current,
                      [candidate.id]: event.target.value,
                    }))
                  }
                >
                  <option value="">Choose target...</option>
                  {targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button onClick={() => onAdd(candidate)} disabled={!target}>
                  <CheckCircle2 className="h-4 w-4" />
                  Add
                </Button>
                {candidate.duplicateExpensePath && (
                  <Button variant="outline" onClick={() => onAttach(candidate)}>
                    <Paperclip className="h-4 w-4" />
                    Attach
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    setEditing((current) => ({
                      ...current,
                      [candidate.id]: {
                        merchant: candidate.merchant,
                        amount: String(candidate.amount),
                        currency: candidate.currency,
                        transactionAt: toDateTimeLocal(candidate.transactionAt),
                      },
                    }))
                  }
                >
                  Edit
                </Button>
                <Button variant="outline" onClick={() => onPersonal(candidate)}>
                  Personal
                </Button>
                <Button variant="outline" onClick={() => onRule(candidate)} disabled={!target}>
                  Rule
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onIgnore(candidate)}
                >
                  <Trash2 className="h-4 w-4" />
                  Ignore
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}

function EmptyInbox({ title, body }: { title: string; body: string }) {
  return (
    <Card className="flex items-center gap-3 border-success/15 bg-success/10 p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-success/15 text-success">
        <Inbox className="h-5 w-5" />
      </span>
      <div>
        <p className="font-black">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </Card>
  );
}

function recognitionEvidenceRows(
  evidence: TransactionCandidate["recognitionEvidence"]
) {
  if (!evidence) return [];
  return [
    { label: "Amount", value: evidence.amountText },
    { label: "Merchant", value: evidence.merchantText },
    { label: "Date", value: evidence.dateText },
    { label: "Completion", value: evidence.completionText },
  ].filter(
    (row): row is { label: string; value: string } =>
      typeof row.value === "string" && row.value.trim().length > 0
  );
}

function equalSplits(ids: string[], amount: number): [string, number][] {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / ids.length);
  let remainder = cents - base * ids.length;
  return ids.map((id) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return [id, (base + extra) / 100];
  });
}

function toDateTimeLocal(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
