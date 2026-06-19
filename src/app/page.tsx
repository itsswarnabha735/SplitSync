"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";

export default function RootRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? "/dashboard" : "/login");
  }, [user, loading, router]);

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
