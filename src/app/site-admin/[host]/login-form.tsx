"use client";

import { useState } from "react";
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
import {
  CircleNotch as Loader2,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react/ssr";

/**
 * Per-site /admin login. Visually identical to the staff (CRM) login at
 * src/app/(auth)/login/page.tsx — same backdrop, Brand lockup, Card, inputs and
 * button — so the client sees the same polished sign-in. The only differences:
 * the logo is intentionally larger here, and auth goes to the per-site endpoint
 * (POST /api/platform/auth/login) instead of Supabase Auth.
 */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/platform/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not sign in. Please try again.");
        setLoading(false);
        return;
      }
      // Reload — the server component now sees the session cookie.
      window.location.reload();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="auth-backdrop relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Theme toggle pinned to the screen corner, off the card */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* Brand lockup, centered above the card — enlarged vs the staff login. */}
        <div className="mb-8 flex justify-center">
          <Brand wordmarkClassName="h-14" />
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
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
    </div>
  );
}
