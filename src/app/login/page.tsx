"use client";

import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const validate = () => {
    let valid = true;
    setEmailError("");
    setPasswordError("");

    if (!email.trim()) {
      setEmailError("Email address is required");
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Please enter a valid email address");
      valid = false;
    }

    if (!password) {
      setPasswordError("Password is required");
      valid = false;
    }

    return valid;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validate()) return;

    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid credentials");
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
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="EventPulse Logo"
              width={16}
              height={16}
              className="w-4 h-4 rounded-sm"
            />
            <span className="font-mono text-sm font-semibold tracking-wider text-ink uppercase">
              EVENTPULSE
            </span>
          </Link>
          <h1 className="mt-4 text-lg font-semibold text-ink">Sign in to workspace</h1>
          <p className="mt-1 text-xs text-ink-2">
            Enter your credentials to access your tenant dashboard
          </p>
        </div>

        {error && (
          <div className="mb-4 border border-crimson/30 bg-crimson-subtle p-3 text-xs text-crimson flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSignIn} className="space-y-4" noValidate>
          <div>
            <label className="text-xs font-medium text-ink-2">Work Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError("");
              }}
              placeholder="you@company.com"
              className={`mt-1 h-[32px] w-full bg-surface border px-3 text-[13px] text-ink placeholder:text-ink-3 transition-colors duration-150 focus:outline-none ${
                emailError ? "border-crimson" : "border-hairline hover:border-hairline-strong focus:border-accent"
              }`}
            />
            {emailError && (
              <p className="mt-1 text-[11px] text-crimson">{emailError}</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink-2">Password</label>
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-[11px] text-ink-3 hover:text-ink transition-colors"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError("");
                }}
                placeholder="••••••••"
                className={`h-[32px] w-full bg-surface border px-3 pr-9 text-[13px] text-ink placeholder:text-ink-3 transition-colors duration-150 focus:outline-none ${
                  passwordError ? "border-crimson" : "border-hairline hover:border-hairline-strong focus:border-accent"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink transition-colors p-0.5"
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {passwordError && (
              <p className="mt-1 text-[11px] text-crimson">{passwordError}</p>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={loading}
            className="w-full justify-center h-[32px]"
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
          className="w-full justify-center h-[32px]"
        >
          {demoLoading ? "Loading sandbox..." : "Explore Demo Workspace"}
        </Button>

        <div className="mt-6 text-center text-xs text-ink-2 border-t border-hairline-subtle pt-4">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Sign up
          </Link>
          <div className="mt-3 text-[11px] text-ink-3">
            <Link href="/privacy" className="hover:text-ink underline">Privacy</Link>
            {" "}•{" "}
            <Link href="/terms" className="hover:text-ink underline">Terms</Link>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/80">
          <div className="bg-surface border border-hairline max-w-sm w-full p-6 space-y-4">
            <h3 className="type-section text-ink">Reset Password</h3>
            <p className="type-body text-ink-2 text-xs">
              Password credentials for active tenants are managed via your workspace OWNER or administrator. To reset your access, contact your tenant admin or use your linked SSO provider.
            </p>
            <div className="flex justify-end pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowForgotPassword(false)}
              >
                Understood
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
