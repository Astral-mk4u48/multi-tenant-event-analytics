"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoSignIn = async () => {
    setError("");
    setDemoLoading(true);

    try {
      const res = await fetch("/api/v1/auth/demo", {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Sandbox login failed");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sandbox login failed");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-canvas p-4 text-ink">
      <div className="w-full max-w-[400px] border border-hairline bg-surface p-8">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 bg-accent" />
            <span className="font-mono text-sm font-semibold tracking-wider text-ink">
              EVENTPULSE
            </span>
          </div>
          <h1 className="mt-4 text-lg font-semibold text-ink">Sign in to workspace</h1>
          <p className="mt-1 text-xs text-ink-2">
            Enter your credentials to access your tenant dashboard
          </p>
        </div>

        {error && (
          <div className="mb-4 border border-accent-border bg-accent-subtle p-3 text-xs text-accent">
            {error}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-ink-2">Work Email</label>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-2">Password</label>
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={loading}
            className="w-full justify-center"
          >
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-[1px] flex-1 bg-hairline-subtle" />
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider">
            OR
          </span>
          <div className="h-[1px] flex-1 bg-hairline-subtle" />
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={handleDemoSignIn}
          disabled={demoLoading}
          className="w-full justify-center"
        >
          {demoLoading ? "Loading sandbox..." : "Explore Demo Workspace"}
        </Button>

        <div className="mt-6 text-center text-xs text-ink-2">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
