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
    <div className="min-h-screen w-full flex items-center justify-center bg-[#09090B] p-4 text-[#F1F5F9]">
      <div className="w-full max-w-[400px] rounded-md border border-[#1E1E24] bg-[#0F0F12] p-8 shadow-2xl">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 bg-[#E11D48]" />
            <span className="font-mono text-sm font-semibold tracking-wider text-[#F1F5F9]">
              EVENTPULSE
            </span>
          </div>
          <h1 className="mt-4 text-lg font-semibold text-[#F1F5F9]">Sign in to Workspace</h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Enter your credentials to access your tenant telemetry
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded border border-[#E11D48]/30 bg-[#E11D48]/10 p-3 text-xs text-[#F43F5E]">
            {error}
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#94A3B8]">Work Email</label>
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
            <label className="text-xs font-medium text-[#94A3B8]">Password</label>
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
          <div className="h-[1px] flex-1 bg-[#1E1E24]" />
          <span className="font-mono text-[10px] text-[#94A3B8] uppercase tracking-wider">
            OR
          </span>
          <div className="h-[1px] flex-1 bg-[#1E1E24]" />
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={handleDemoSignIn}
          disabled={demoLoading}
          className="w-full justify-center"
        >
          {demoLoading ? "Initializing Sandbox..." : "Try Demo Workspace"}
        </Button>

        <div className="mt-6 text-center text-xs text-[#94A3B8]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[#E11D48] hover:underline">
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
