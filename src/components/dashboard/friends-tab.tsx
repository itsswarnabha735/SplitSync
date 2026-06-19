"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, UserPlus, Receipt, HandCoins } from "lucide-react";

import type { Friend, FriendWithBalance } from "@/lib/models";
import { formatMoney } from "@/lib/currency";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { AddFriendDialog } from "@/components/dialogs/add-friend-dialog";
import { AddAdHocExpenseDialog } from "@/components/dialogs/add-adhoc-expense-dialog";
import { SettleAdHocDialog } from "@/components/dialogs/settle-adhoc-dialog";

export function FriendsTab({
  friends,
  friendsWithBalances,
}: {
  friends: Friend[];
  friendsWithBalances: FriendWithBalance[];
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);

  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [settleTarget, setSettleTarget] = useState<FriendWithBalance | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  // Group balances by friend so each friend shows one row (with per-currency).
  const byFriend = useMemo(() => {
    const map = new Map<string, { friend: Friend; balances: FriendWithBalance[] }>();
    for (const f of friends) map.set(f.id, { friend: f, balances: [] });
    for (const fb of friendsWithBalances) {
      const entry = map.get(fb.friend.id);
      if (entry) entry.balances.push(fb);
    }
    return Array.from(map.values());
  }, [friends, friendsWithBalances]);

  async function handleDeleteFriend(friend: Friend) {
    if (!repo) return;
    setError(null);
    try {
      await runSyncing(() => repo.deleteFriend(friend));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not delete this friend."
      );
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Friends
        </h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddFriend(true)}
          >
            <UserPlus className="h-4 w-4" />
            Add friend
          </Button>
          <Button
            size="sm"
            onClick={() => setShowAddExpense(true)}
            disabled={friends.length === 0}
          >
            <Plus className="h-4 w-4" />
            Expense
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}

      {friends.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No friends yet"
          description="Add a friend to start tracking one-on-one expenses and IOUs."
          action={
            <Button size="sm" onClick={() => setShowAddFriend(true)}>
              <UserPlus className="h-4 w-4" />
              Add a friend
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {byFriend.map(({ friend, balances }) => {
            const nonZero = balances.filter(
              (b) => Math.abs(b.netBalance) > 0.01
            );
            const primary = nonZero[0];
            return (
              <Card key={friend.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground">
                    {friend.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{friend.name}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      {nonZero.length === 0 ? (
                        <Badge variant="muted">Settled up</Badge>
                      ) : (
                        nonZero.map((b) => (
                          <Badge
                            key={b.currency}
                            variant={b.netBalance > 0 ? "success" : "destructive"}
                          >
                            {b.netBalance > 0
                              ? `owes you ${formatMoney(b.netBalance, b.currency)}`
                              : `you owe ${formatMoney(-b.netBalance, b.currency)}`}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  {primary && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSettleTarget(primary)}
                    >
                      <HandCoins className="h-4 w-4" />
                      Settle
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete friend"
                    onClick={() => handleDeleteFriend(friend)}
                    disabled={!repo}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <AddFriendDialog open={showAddFriend} onOpenChange={setShowAddFriend} />
      <AddAdHocExpenseDialog
        open={showAddExpense}
        onOpenChange={setShowAddExpense}
        friends={friends}
      />
      <SettleAdHocDialog
        target={settleTarget}
        onClose={() => setSettleTarget(null)}
      />
    </div>
  );
}
