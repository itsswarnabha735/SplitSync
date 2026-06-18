"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Users, ChevronRight } from "lucide-react";

import type { Group } from "@/lib/models";
import { useAuth } from "@/hooks/use-auth";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function GroupsTab({ groups }: { groups: Group[] }) {
  const { user } = useAuth();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);

  async function confirmDelete() {
    if (!repo || !pendingDelete) return;
    const g = pendingDelete;
    setPendingDelete(null);
    await runSyncing(() => repo.deleteGroup(g));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Your groups
        </h2>
        <Button asChild size="sm">
          <Link href="/groups/create">
            <Plus className="h-4 w-4" />
            New group
          </Link>
        </Button>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No groups yet"
          description="Create a group to start splitting shared expenses with multiple people."
          action={
            <Button asChild size="sm">
              <Link href="/groups/create">
                <Plus className="h-4 w-4" />
                Create your first group
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <Card key={g.id} className="overflow-hidden">
              <div className="flex items-center gap-2 p-2">
                <Link
                  href={`/groups/${g.id}`}
                  className="flex flex-1 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
                >
                  <div className="brand-gradient flex h-11 w-11 items-center justify-center rounded-xl text-white">
                    <Users className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{g.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {g.memberUids.length} member
                      {g.memberUids.length === 1 ? "" : "s"}
                      {g.description ? ` · ${g.description}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
                {g.createdBy === user?.uid && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete group"
                    onClick={() => setPendingDelete(g)}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &quot;{pendingDelete?.name}&quot;?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes the group and all of its expenses,
            members, and settlements. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
