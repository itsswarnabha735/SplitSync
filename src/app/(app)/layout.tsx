"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useUiStore } from "@/stores/ui-store";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const isSyncing = useUiStore((s) => s.isSyncing);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <main
        id="main-content"
        className="flex min-h-screen items-center justify-center"
        aria-label="Loading SplitSync"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </main>
    );
  }

  return (
    <div className="relative min-h-screen">
      {isSyncing && (
        <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20">
          <div className="h-full w-1/3 animate-[loading_1s_ease-in-out_infinite] bg-primary" />
        </div>
      )}
      <SyncStatusAnnouncer />
      {children}
    </div>
  );
}

function SyncStatusAnnouncer() {
  const statusMessage = useUiStore((s) => s.statusMessage);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {statusMessage}
    </div>
  );
}
