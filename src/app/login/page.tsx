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
      className="flex min-h-screen items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="brand-gradient flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg shadow-primary/30">
            <Wallet className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">SplitSync</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to sync your groups"
              : "Create your SplitSync account"}
          </p>
          <p className="max-w-xs text-xs leading-5 text-muted-foreground">
            Continue with Google for provider-managed sign-in, or use an email
            password saved through Firebase Authentication.
          </p>
        </div>

        <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Split data is tied to your signed-in account. SplitSync stores only
            the profile details needed for group invites and friend lookup.
          </p>
        </div>

        {error && (
          <div
            className="mb-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive"
            role="alert"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <div
            className="mb-4 rounded-lg bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"
            role="status"
            aria-live="polite"
          >
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
            className="mt-3 w-full text-center text-sm font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handlePasswordReset}
            disabled={working || resetting}
          >
            {resetting ? "Sending reset email..." : "Forgot password?"}
          </button>
        )}

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={handleGoogle}
          disabled={working || resetting}
        >
          {working ? "Connecting..." : "Continue with Google"}
        </Button>

        <button
          type="button"
          className="mt-6 w-full text-center text-sm font-semibold text-primary hover:underline"
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
      </div>
    </main>
  );
}
