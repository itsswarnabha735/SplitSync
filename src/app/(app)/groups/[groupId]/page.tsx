"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Lightbulb,
  Plus,
  Receipt,
  Trash2,
  UserPlus,
} from "lucide-react";

import type { DebtOverview } from "@/lib/models";
import { netBalance } from "@/lib/models";
import { currencySymbol, formatMoney } from "@/lib/currency";
import { useAuth } from "@/hooks/use-auth";
import { useGroupDetail } from "@/hooks/use-group-detail";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import { EmptyState } from "@/components/empty-state";
import { CurrencyTotals } from "@/components/currency-totals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InviteMemberDialog } from "@/components/dialogs/invite-member-dialog";
import { SettleGroupDialog } from "@/components/dialogs/settle-group-dialog";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function GroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { user } = useAuth();

  const {
    group,
    members,
    expenses,
    payments,
    balances,
    simplifiedDebts,
    totalsByCurrency,
    loading,
    error,
  } = useGroupDetail(groupId);

  const [showInvite, setShowInvite] = useState(false);
  const [settleDebt, setSettleDebt] = useState<DebtOverview | null>(null);

  const uid = user?.uid;
  const labelForMember = useMemo(() => {
    return (m: { name: string; linkedUid: string }) =>
      m.linkedUid && m.linkedUid === uid ? "You" : m.name;
  }, [uid]);

  const memberName = useMemo(() => {
    const map = new Map(
      members.map((m) => [m.id, m.linkedUid && m.linkedUid === uid ? "You" : m.name])
    );
    return (id: string) => map.get(id) ?? "Unknown";
  }, [members, uid]);

  if (!loading && !group) {
    return (
      <div>
        <AppHeader title="Group" showBack onBack={() => router.push("/dashboard")} />
        <main className="container py-10">
          <EmptyState
            icon={Receipt}
            title={error ? "Cannot load group" : "Group not found"}
            description={
              error ||
              "It may have been deleted, or you no longer have access."
            }
          />
        </main>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <AppHeader
        title={group?.name ?? "Group"}
        subtitle={group?.description || undefined}
        showBack
        onBack={() => router.push("/dashboard")}
        actions={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Invite member"
            onClick={() => setShowInvite(true)}
          >
            <UserPlus className="h-5 w-5" />
          </Button>
        }
      />

      <main className="container space-y-4 py-5">
        <Card className="brand-gradient p-5 text-white">
          <p className="text-xs font-bold uppercase opacity-80">
            Total group spend
          </p>
          <CurrencyTotals
            totals={totalsByCurrency}
            className="mt-1 text-3xl font-black"
            emptyLabel="$0.00"
          />
        </Card>

        <Tabs defaultValue="ledger">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="debts">Solver</TabsTrigger>
            <TabsTrigger value="settlements">Settled</TabsTrigger>
          </TabsList>

          {/* LEDGER */}
          <TabsContent value="ledger" className="space-y-2">
            {expenses.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No expenses logged"
                description="Use 'Add expense' below to start the group ledger."
              />
            ) : (
              expenses.map((e) => (
                <Card key={e.id} className="flex items-center gap-3 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Receipt className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{e.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Paid by {memberName(e.paidById)} · {e.splitType} ·{" "}
                      {formatDate(e.timestamp)}
                    </p>
                  </div>
                  <span className="font-black">
                    {formatMoney(e.amount, e.currency)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete expense"
                    onClick={() => runSyncing(() => repo!.deleteExpense(e))}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </Card>
              ))
            )}
          </TabsContent>

          {/* BALANCES */}
          <TabsContent value="balances" className="space-y-2">
            {balances.map((b) => {
              const net = netBalance(b);
              const isOwed = net > 0.01;
              const settled = Math.abs(net) <= 0.01;
              const totalVol = b.initialPaid + b.initialOwe;
              const ratio = totalVol > 0.1 ? (b.initialPaid / totalVol) * 100 : 0;
              const symbol = currencySymbol(b.currency);
              return (
                <Card
                  key={`${b.member.id}-${b.currency}`}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0 space-y-1.5">
                    <p className="font-bold">
                      {labelForMember(b.member)}{" "}
                      <span className="text-xs font-medium text-muted-foreground">
                        ({b.currency})
                      </span>
                    </p>
                    <div className="flex gap-3 text-xs">
                      <span className="font-bold text-success">
                        Spent {symbol}
                        {b.initialPaid.toFixed(2)}
                      </span>
                      <span className="text-muted-foreground">
                        Share {symbol}
                        {b.initialOwe.toFixed(2)}
                      </span>
                    </div>
                    <Progress
                      value={Math.min(100, Math.max(0, ratio))}
                      className="h-1.5 w-32"
                      indicatorClassName={isOwed ? "bg-success" : "bg-primary"}
                    />
                  </div>
                  <Badge
                    variant={
                      settled ? "muted" : isOwed ? "success" : "destructive"
                    }
                  >
                    {settled
                      ? "Settled"
                      : isOwed
                        ? `+${symbol}${net.toFixed(2)}`
                        : `-${symbol}${Math.abs(net).toFixed(2)}`}
                  </Badge>
                </Card>
              );
            })}
          </TabsContent>

          {/* DEBT SOLVER */}
          <TabsContent value="debts" className="space-y-3">
            {simplifiedDebts.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="All settled up!"
                description="Everyone is square. No pending transactions required."
              />
            ) : (
              <>
                <div className="flex items-start gap-2 rounded-xl bg-primary/10 p-3 text-sm text-primary">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                  <p className="font-semibold">
                    Debt simplification active. Tap &quot;Settle up&quot; to
                    register a cash payment for any optimized transfer.
                  </p>
                </div>
                {simplifiedDebts.map((d, i) => (
                  <Card key={i} className="space-y-3 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 rounded-lg bg-destructive/10 px-3 py-2 text-center">
                        <p className="text-[10px] font-bold text-destructive">
                          SENDER
                        </p>
                        <p className="font-bold">{labelForMember(d.debtor)}</p>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="font-black text-primary">
                          {formatMoney(d.amount, d.currency)}
                        </span>
                        <ArrowRight className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 rounded-lg bg-success/15 px-3 py-2 text-center">
                        <p className="text-[10px] font-bold text-[hsl(142_71%_30%)]">
                          RECIPIENT
                        </p>
                        <p className="font-bold">{labelForMember(d.creditor)}</p>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => setSettleDebt(d)}>
                        <CheckCircle2 className="h-4 w-4" />
                        Settle up
                      </Button>
                    </div>
                  </Card>
                ))}
              </>
            )}
          </TabsContent>

          {/* SETTLEMENTS */}
          <TabsContent value="settlements" className="space-y-2">
            {payments.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No settlements yet"
                description="Record transfers from the Solver tab to clear balances."
              />
            ) : (
              payments.map((p) => (
                <Card key={p.id} className="flex items-center gap-3 p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/15 text-success">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">
                      {memberName(p.fromMemberId)} paid{" "}
                      {memberName(p.toMemberId)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.timestamp)}
                    </p>
                  </div>
                  <span className="font-black text-success">
                    {formatMoney(p.amount, p.currency)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete settlement"
                    onClick={() => runSyncing(() => repo!.deletePayment(p))}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/90 p-4 backdrop-blur">
        <div className="container">
          <Button
            className="w-full"
            size="lg"
            onClick={() => router.push(`/groups/${groupId}/add-expense`)}
          >
            <Plus className="h-5 w-5" />
            Add expense
          </Button>
        </div>
      </div>

      <InviteMemberDialog
        group={group}
        open={showInvite}
        onOpenChange={setShowInvite}
      />
      <SettleGroupDialog
        groupId={groupId}
        debt={settleDebt}
        onClose={() => setSettleDebt(null)}
      />
    </div>
  );
}
