"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "@/components/brand";
import { getDefaultRoute } from "@/lib/auth/roles";
import type { UserRole } from "@/types/database";
import { CircleNotch as Loader2, WarningCircle as AlertCircle } from "@phosphor-icons/react/ssr";

export default function LoginPageWrapper() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm" />}>
      <LoginPage />
    </Suspense>
  );
}

function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Single field that accepts either a username or an email. The
  // /api/auth/resolve-identifier endpoint turns it into the email
  // Supabase Auth needs before we call signInWithPassword.
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifyingMagicLink, setVerifyingMagicLink] = useState(false);

  // Handle magic link token from URL on mount
  useEffect(() => {
    const token = searchParams.get("token") || searchParams.get("token_hash");
    const type = searchParams.get("type");

    // Also check hash fragment for #access_token=... (newer Supabase format)
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hashParams = new URLSearchParams(hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    async function handleAuth() {
      const supabase = createClient();

      // Newer format: #access_token=... in URL hash
      if (accessToken && refreshToken) {
        setVerifyingMagicLink(true);
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setError("Sign-in failed: " + error.message);
          setVerifyingMagicLink(false);
          return;
        }
        router.push("/client");
        router.refresh();
        return;
      }

      // Older format: ?token=...&type=magiclink in URL query
      if (token && type) {
        setVerifyingMagicLink(true);
        const { error } = await supabase.auth.verifyOtp({
          token_hash: token,
          type: type as "magiclink" | "email" | "recovery" | "invite",
        });
        if (error) {
          setError("The sign-in link has expired or is invalid. Please sign in with your password below.");
          setVerifyingMagicLink(false);
          return;
        }
        router.push("/client");
        router.refresh();
      }
    }

    handleAuth();
  }, [searchParams, router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Step 1: resolve the identifier to an email. If the user typed
    // an email, the API echoes it back. If they typed a username,
    // the API looks up the matching auth.users.email (or returns the
    // raw input on miss, which then fails the auth call below with
    // a normal "invalid credentials" so we don't leak usernames).
    let emailToUse = identifier.trim();
    try {
      const res = await fetch("/api/auth/resolve-identifier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: emailToUse }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.email) emailToUse = data.email;
      }
    } catch {
      // Network error on the resolver — fall through and let Supabase
      // try with the raw input. Worst case: it fails the same way.
    }

    const supabase = createClient();
    const { data: signInData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // "/" is now the public landing for everyone, so route straight to this
    // user's role dashboard instead of bouncing through "/". (The proxy still
    // handles the sales-on-mobile → dialer hop when we land on /sales.)
    const role = signInData.user?.app_metadata?.role as UserRole | undefined;
    router.push(role ? getDefaultRoute(role) : "/");
    router.refresh();
  }

  if (verifyingMagicLink) {
    return (
      <div className="w-full max-w-sm">
        <Card>
          <CardContent className="flex flex-col items-center py-14 text-center">
            <div className="dash-chip flex size-11 items-center justify-center rounded-xl">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              Signing you in
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Verifying your secure link…
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* Theme toggle pinned to the screen corner, off the card */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* Brand lockup, centered above the card */}
        <div className="mb-6 flex justify-center">
          <Brand
            markClassName="size-8 rounded-lg text-base"
            wordmarkClassName="text-lg"
          />
        </div>

        <Card>
          <CardHeader className="space-y-1.5 pb-2 text-center">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Welcome back
            </p>
            <CardTitle className="text-2xl">Sign in to your account</CardTitle>
            <CardDescription>Enter your credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="identifier">Username or Email</Label>
                <Input
                  id="identifier"
                  type="text"
                  placeholder="your-username  /  you@example.com"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
