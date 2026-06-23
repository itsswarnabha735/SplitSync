"use client";

import { LogOut, Mail } from "lucide-react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { NotificationSettings } from "@/components/notification-settings";
import { TransactionRadarSettings } from "@/components/transaction-radar-settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { signOut } from "@/services/auth";

export default function SettingsPage() {
  const router = useRouter();
  const { user, displayName } = useAuth();

  return (
    <div className="pb-16">
      <AppHeader
        title="Settings"
        subtitle="Manage notifications and account"
        showBack
        onBack={() => router.push("/dashboard")}
      />

      <main id="main-content" className="container space-y-5 py-6">
        <NotificationSettings />
        <TransactionRadarSettings />

        <Card className="space-y-4 border-primary/10 p-5">
          <div className="flex items-center gap-3">
            <div className="social-gradient surface-glow flex h-12 w-12 items-center justify-center rounded-2xl text-lg font-black text-white">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-bold">{displayName}</p>
              <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                {user?.email}
              </p>
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </Card>
      </main>
    </div>
  );
}
