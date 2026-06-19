"use client";

import { useState } from "react";
import { Search, UserCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UserResult {
  uid: string;
  displayName: string;
  email: string;
  photoUrl: string;
}

export function AddFriendDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repo = useRepository();
  const runSyncing = useUiStore((s) => s.runSyncing);
  const { user, displayName } = useAuth();

  const [email, setEmail] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [addingUid, setAddingUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setResults([]);
    setSearched(false);
    setSearching(false);
    setAddingUid(null);
    setError(null);
  }

  async function handleSearch() {
    if (!email.trim()) {
      setError("Please enter an email address.");
      return;
    }
    if (!repo) return;
    setError(null);
    setSearching(true);
    try {
      const found = await repo.searchUsersByEmail(email);
      setResults(found);
      setSearched(true);
      if (found.length === 0) {
        setError("No registered user found with that email.");
      }
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  async function handleAdd(target: UserResult) {
    if (!repo) return;
    setAddingUid(target.uid);
    setError(null);
    try {
      await runSyncing(
        () =>
          repo.addRegisteredFriend(
            {
              uid: target.uid,
              name: target.displayName,
              email: target.email,
            },
            { name: displayName, email: user?.email ?? "" }
          ),
        {
          loading: "Adding friend...",
          success: "Friend added.",
          error: "Could not add friend.",
        }
      );
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add friend.");
    } finally {
      setAddingUid(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && addingUid) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a friend</DialogTitle>
          <DialogDescription>
            Search for a registered user by their email to add them as a friend.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {error && (
            <p
              className="rounded-xl border border-destructive/15 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="friend-email">Email address</Label>
            <div className="flex gap-2">
              <Input
                id="friend-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                  setSearched(false);
                  setResults([]);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="friend@example.com"
              />
              <Button
                variant="outline"
                onClick={handleSearch}
                disabled={searching || addingUid !== null || !email.trim()}
              >
                <Search className="h-4 w-4" />
                {searching ? "..." : "Search"}
              </Button>
            </div>
          </div>

          {searched && results.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                User found — tap to add:
              </p>
              {results.map((user) => (
                <button
                  key={user.uid}
                  type="button"
                  onClick={() => handleAdd(user)}
                  disabled={addingUid !== null}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/80 p-3 text-left shadow-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent font-black text-accent-foreground">
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{user.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    {addingUid === user.uid ? "Adding..." : "Add"}
                  </span>
                  <UserCheck className="h-5 w-5 text-primary" />
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={addingUid !== null}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
