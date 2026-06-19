"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet, Loader2, AlertCircle, ShieldCheck } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import {
  friendlyAuthError,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "@/services/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signin" && (!email || !password)) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "signup" && (!displayName || !email || password.length < 6)) {
      setError("Name, email, and a 6+ character password are required.");
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signin") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(displayName, email, password);
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setWorking(false);
    }
  }

  async function handleGoogle() {
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setWorking(false);
    }
  }

  async function handlePasswordReset() {
    if (!email.trim()) {
      setError("Enter your email address first.");
      setMessage(null);
      return;
    }
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      await sendPasswordReset(email);
      setMessage("Password reset email sent.");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <main
      id="main-content"
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10"
    >
      <div className="brand-gradient absolute inset-x-0 top-0 h-2" />
      <Card className="surface-glow w-full max-w-sm border-primary/10 bg-card/90 p-4 sm:p-5">
        <div className="mb-4 flex flex-col items-center gap-2 text-center">
          <div className="social-gradient surface-glow flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-[1.1rem] shadow-lg shadow-primary/25">
            <Wallet className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-foreground">
            SplitSync
          </h1>
          <p className="text-sm font-medium text-muted-foreground">
            {mode === "signin"
              ? "Sign in to sync your groups"
              : "Create your SplitSync account"}
          </p>
          <p className="max-w-xs text-[11px] leading-4 text-muted-foreground">
            Continue with Google for provider-managed sign-in, or use an email
            password saved through Firebase Authentication.
          </p>
        </div>

        <div className="mb-3 flex items-start gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2 text-[11px] font-medium leading-4 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Split data is tied to your signed-in account. SplitSync stores only
            the profile details needed for group invites and friend lookup.
          </p>
        </div>

        {error && (
          <div
            className="mb-4 flex items-center gap-2 rounded-2xl border border-destructive/15 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <div
            className="mb-4 rounded-2xl border border-primary/15 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
            role="status"
            aria-live="polite"
          >
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setError(null);
                }}
                placeholder="Jordan Lee"
                autoComplete="name"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder="••••••••"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={working || resetting}
          >
            {working && <Loader2 className="h-4 w-4 animate-spin" />}
            {working ? (
              mode === "signin" ? (
                "Signing in..."
              ) : (
                "Creating account..."
              )
            ) : mode === "signin" ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </Button>
        </form>

        {mode === "signin" && (
          <button
            type="button"
            className="mt-3 w-full rounded-lg py-1 text-center text-sm font-bold text-primary transition-colors hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handlePasswordReset}
            disabled={working || resetting}
          >
            {resetting ? "Sending reset email..." : "Forgot password?"}
          </button>
        )}

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full bg-card"
          onClick={handleGoogle}
          disabled={working || resetting}
        >
          {working ? "Connecting..." : "Continue with Google"}
        </Button>

        <button
          type="button"
          className="mt-6 w-full rounded-lg py-1 text-center text-sm font-bold text-primary transition-colors hover:bg-primary/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
          }}
          disabled={working || resetting}
        >
          {mode === "signin"
            ? "Don't have an account? Create one"
            : "Already have an account? Sign in"}
        </button>
      </Card>
    </main>
  );
}
