"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserRound, UserPlus } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useFriends } from "@/hooks/use-friends";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { AddFriendDialog } from "@/components/dialogs/add-friend-dialog";

export default function CreateGroupPage() {
  const router = useRouter();
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { friends } = useFriends();
  const { user, displayName } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Selectable friend slots (by friend id). The creator is implicit.
  const [memberIds, setMemberIds] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showAddFriend, setShowAddFriend] = useState(false);

  function setMemberAt(index: number, value: string) {
    setMemberIds((prev) => prev.map((m, i) => (i === index ? value : m)));
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError("Group name cannot be empty.");
      return;
    }
    const selectedIds = [...new Set(memberIds.filter((id) => id.length > 0))];
    if (selectedIds.length < 1) {
      setError("Add at least one friend to the group.");
      return;
    }
    if (!repo) return;
    const newMembers = selectedIds.flatMap((id) => {
      const friend = friends.find((f) => f.id === id);
      if (!friend) return [];
      return [
        { name: friend.name, email: friend.email, linkedUid: friend.linkedUid },
      ];
    });
    setCreating(true);
    try {
      const groupId = await runSyncing(
        () =>
          repo.createGroupWithMembers(name, description, newMembers, {
            name: displayName,
            email: user?.email ?? "",
          }),
        {
          loading: "Creating group...",
          success: "Group created.",
          error: "Could not create group.",
        }
      );
      router.replace(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create group.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="pb-24">
      <AppHeader title="Create group" showBack />

      <main id="main-content" className="container space-y-5 py-6">
        {error && (
          <p
            className="rounded-2xl border border-destructive/15 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <Card className="space-y-4 border-primary/10 p-5">
          <p className="text-xs font-black uppercase tracking-wide text-primary">
            Group profile
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Euro Trip, Apartment 4B, ..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-desc">Description (optional)</Label>
            <Input
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this group for?"
            />
          </div>
        </Card>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="font-bold">Members</p>
              <p className="text-xs text-muted-foreground">
                Minimum 2 people required to split bills
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMemberIds((prev) => [...prev, ""])}
              disabled={
                friends.length === 0 ||
                memberIds.filter(Boolean).length >= friends.length
              }
            >
              <Plus className="h-4 w-4" />
              Add member
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex h-11 items-center gap-2 rounded-2xl border border-primary/25 bg-primary/5 px-3 text-sm font-bold">
              <UserRound className="h-4 w-4 text-primary" />
              You (creator)
            </div>
            {memberIds.map((memberId, index) => (
              <div key={index} className="flex items-center gap-2">
                <NativeSelect
                  className="flex-1"
                  value={memberId}
                  onChange={(e) => setMemberAt(index, e.target.value)}
                >
                  <option value="">Select a friend…</option>
                  {friends.map((f) => (
                    <option
                      key={f.id}
                      value={f.id}
                      disabled={memberIds.includes(f.id) && memberId !== f.id}
                    >
                      {f.name}
                    </option>
                  ))}
                </NativeSelect>
                {memberIds.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove member"
                    onClick={() =>
                      setMemberIds((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {friends.length === 0 && (
            <div className="mt-3 rounded-2xl border border-primary/15 bg-card/80 p-4 shadow-sm">
              <p className="font-bold">Add a friend to continue</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Groups need at least one friend. Search by email here, then pick
                them as a member without leaving this page.
              </p>
              <Button
                className="mt-3"
                size="sm"
                onClick={() => setShowAddFriend(true)}
              >
                <UserPlus className="h-4 w-4" />
                Add friend
              </Button>
            </div>
          )}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-border/60 bg-background/85 p-4 shadow-[0_-18px_42px_-34px_hsl(var(--foreground)/0.45)] backdrop-blur-xl">
        <div className="container">
          <Button
            className="w-full"
            size="lg"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating group..." : "Create group"}
          </Button>
        </div>
      </div>
      <AddFriendDialog open={showAddFriend} onOpenChange={setShowAddFriend} />
    </div>
  );
}
