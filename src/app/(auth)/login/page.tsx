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
import { Loader2, LogIn, AlertCircle } from "lucide-react";

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
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: emailToUse,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Middleware will handle role-based redirect
    router.push("/");
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
    <div className="w-full max-w-sm">
      <div className="mb-4 flex items-center justify-between">
        <Brand
          markClassName="size-7 rounded-md text-sm"
          wordmarkClassName="text-base"
        />
        <ThemeToggle />
      </div>
      <Card className="shadow-xl shadow-black/[0.04]">
        <CardHeader className="space-y-3 pb-2">
          <div className="dash-chip flex size-11 items-center justify-center rounded-xl">
            <LogIn className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
              Welcome back
            </p>
            <CardTitle className="text-xl">Sign in to your account</CardTitle>
            <CardDescription>
              Enter your credentials to continue.
            </CardDescription>
          </div>
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
  );
}
