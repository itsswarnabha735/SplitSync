"use client";

import { useState } from "react";

import type { Group } from "@/lib/models";
import { useAuth } from "@/hooks/use-auth";
import { useRepository } from "@/hooks/use-repository";
import { useUiStore } from "@/stores/ui-store";
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
  const runSyncing = useUiStore((s) => s.runSyncing);
  const setStatusMessage = useUiStore((s) => s.setStatusMessage);
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
      const ok = await runSyncing(
        () => repo.inviteToGroupByEmail(group, email, displayName),
        {
          loading: "Sending invite...",
          success: "Invite request finished.",
          error: "Could not send invite.",
        }
      );
      if (ok) {
        setStatusMessage("Invite sent.");
        setEmail("");
        onOpenChange(false);
      } else {
        setMessage("No SplitSync user found with that email.");
        setStatusMessage("No user found for that email.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not send invite.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && working) return;
        onOpenChange(nextOpen);
      }}
    >
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
            <p className="text-sm font-semibold text-destructive" role="alert">
              {message}
            </p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={working}
          >
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={working || !email.trim()}>
            {working ? "Sending..." : "Send invite"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
