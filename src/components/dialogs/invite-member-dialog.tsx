"use client";

import { useState } from "react";

import type { Group } from "@/lib/models";
import { useAuth } from "@/hooks/use-auth";
import { useRepository } from "@/hooks/use-repository";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteMemberDialog({
  group,
  open,
  onOpenChange,
}: {
  group: Group | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repo = useRepository();
  const { displayName } = useAuth();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function handleInvite() {
    if (!repo || !group) return;
    if (!email.trim()) {
      setMessage("Email is required.");
      return;
    }
    setWorking(true);
    setMessage(null);
    try {
      const ok = await repo.inviteToGroupByEmail(group, email, displayName);
      if (ok) {
        setEmail("");
        onOpenChange(false);
      } else {
        setMessage("No SplitSync user found with that email.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not send invite.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            Send a group invite to a SplitSync user by email. They&apos;ll see
            it on their dashboard and can accept to join{" "}
            <span className="font-semibold">{group?.name}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setMessage(null);
              }}
              placeholder="friend@example.com"
            />
          </div>
          {message && (
            <p className="text-sm font-semibold text-destructive">{message}</p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={working || !email.trim()}>
            Send invite
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
