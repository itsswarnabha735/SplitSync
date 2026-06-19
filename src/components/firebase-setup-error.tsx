import { AlertTriangle, Wallet } from "lucide-react";

import type { FirebaseConfigError } from "@/lib/firebase";

export function FirebaseSetupError({
  error,
}: {
  error: FirebaseConfigError;
}) {
  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-10"
    >
      <section className="w-full max-w-xl rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="brand-gradient flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-lg shadow-primary/20">
            <Wallet className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-muted-foreground">
              SplitSync
            </p>
            <h1 className="text-2xl font-black">{error.title}</h1>
          </div>
        </div>

        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-2">
              <p className="font-semibold">{error.message}</p>
              <p className="text-sm">
                Copy <code>.env.local.example</code> to{" "}
                <code>.env.local</code>, fill the Firebase Web app values, and
                restart the dev server.
              </p>
            </div>
          </div>
        </div>

        {error.keys.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-bold">Check these environment keys:</p>
            <ul className="mt-2 space-y-1 rounded-lg bg-muted p-3 font-mono text-xs text-muted-foreground">
              {error.keys.map((key) => (
                <li key={key}>{key}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
