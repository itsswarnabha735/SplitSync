"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";

import { finishGmailOAuth } from "@/services/gmail-radar";
import { AppHeader } from "@/components/app-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function GmailRadarCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell status="Connecting Gmail..." />}>
      <CallbackContent />
    </Suspense>
  );
}

function CallbackContent() {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState("Connecting Gmail...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = search.get("code") ?? "";
    const state = search.get("state") ?? "";
    const oauthError = search.get("error");
    if (oauthError) {
      setError(`Google returned: ${oauthError}`);
      return;
    }
    if (!code || !state) {
      setError("Missing Gmail authorization details.");
      return;
    }
    let cancelled = false;
    finishGmailOAuth({ code, state })
      .then((result) => {
        if (cancelled) return;
        const created = result.sync?.created ?? 0;
        setStatus(
          result.email
            ? `Connected ${result.email}. Imported ${created} candidate${created === 1 ? "" : "s"}.`
            : "Gmail connected."
        );
        window.setTimeout(() => router.replace("/settings"), 1200);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(safeGmailCallbackError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [router, search]);

  return <CallbackShell status={status} error={error} />;
}

function safeGmailCallbackError(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  if (
    !message ||
    /firestore|value for argument|undefined|permission_denied|gemini|google_gemini|internal|stack|api key/i.test(
      message
    )
  ) {
    return "Could not finish Gmail connection. Try again from Settings.";
  }
  return message;
}

function CallbackShell({
  status,
  error,
}: {
  status: string;
  error?: string | null;
}) {
  const router = useRouter();
  return (
    <div className="pb-16">
      <AppHeader title="Gmail Transaction Radar" showBack onBack={() => router.push("/settings")} />
      <main id="main-content" className="container py-6">
        <Card className="space-y-4 border-primary/10 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {error ? <MailCheck className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
            </span>
            <div>
              <p className="font-black">{error ? "Connection failed" : "Finishing setup"}</p>
              <p className="text-sm text-muted-foreground">{error ?? status}</p>
            </div>
          </div>
          {error && (
            <Button variant="outline" onClick={() => router.push("/settings")}>
              Back to settings
            </Button>
          )}
        </Card>
      </main>
    </div>
  );
}
