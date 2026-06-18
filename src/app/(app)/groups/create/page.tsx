"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserRound } from "lucide-react";

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
    const groupId = await runSyncing(() =>
      repo.createGroupWithMembers(name, description, newMembers, {
        name: displayName,
        email: user?.email ?? "",
      })
    );
    router.replace(`/groups/${groupId}`);
  }

  return (
    <div className="pb-24">
      <AppHeader title="Create group" showBack />

      <main className="container space-y-5 py-5">
        {error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <Card className="space-y-4 p-5">
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
            >
              <Plus className="h-4 w-4" />
              Add member
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex h-10 items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 text-sm font-semibold">
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
            <p className="mt-2 text-xs text-muted-foreground">
              Tip: add friends from the dashboard first to pick them here. Only
              registered users you&apos;ve added as friends can join a group.
            </p>
          )}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/90 p-4 backdrop-blur">
        <div className="container">
          <Button className="w-full" size="lg" onClick={handleCreate}>
            Create group
          </Button>
        </div>
      </div>
    </div>
  );
}
