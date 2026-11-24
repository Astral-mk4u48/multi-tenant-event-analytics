"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const orgSlug = useMemo(() => {
    return orgName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }, [orgName]);

  const passwordStrength = useMemo(() => {
    if (!password) return null;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          password,
          orgName,
          orgSlug,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create account");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        setError("Supabase authentication is not configured");
        return;
      }
      const { createBrowserClient } = await import("@supabase/ssr");
      const supabase = createBrowserClient(supabaseUrl, supabaseKey);
      const origin = window.location.origin;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback`,
        },
      });
      if (oauthError) {
        setError(oauthError.message);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to initiate Google sign-in");
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-canvas p-4 text-ink">
      <div className="w-full max-w-[420px] border border-hairline bg-surface p-8">
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
          <h1 className="mt-4 text-lg font-semibold text-ink">Create workspace</h1>
          <p className="mt-1 text-xs text-ink-2">
            Deploy a dedicated multi-tenant event pipeline in seconds
          </p>
        </div>

        {error && (
          <div className="mb-4 border border-accent-border bg-accent-subtle p-3 text-xs text-accent">
            {error}
          </div>
        )}

        {/* Continue with Google */}
        <Button
          type="button"
          variant="secondary"
          onClick={handleGoogleSignUp}
          className="w-full justify-center h-[34px] flex items-center gap-2 mb-4 border-hairline hover:border-hairline-strong text-ink"
        >
          <svg className="w-3.5 h-3.5 text-ink shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
          </svg>
          <span>Continue with Google</span>
        </Button>

        <div className="mb-4 flex items-center gap-3">
          <div className="h-[1px] flex-1 bg-hairline-subtle" />
          <span className="font-mono text-[10px] text-ink-3 uppercase tracking-wider">
            OR CONTINUE WITH EMAIL
          </span>
          <div className="h-[1px] flex-1 bg-hairline-subtle" />
        </div>

        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-ink-2">Full Name</label>
            <Input
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Chen"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-2">Work Email</label>
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-2">Password</label>
            <div className="relative mt-1">
              <Input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink text-xs transition-colors"
              >
                {showPassword ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            {passwordStrength !== null && (
              <div className="mt-2 flex items-center gap-1">
                {[1, 2, 3, 4].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-sm ${
                      passwordStrength >= level
                        ? passwordStrength <= 2
                          ? "bg-amber"
                          : "bg-emerald"
                        : "bg-hairline-subtle"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-ink-2">Organization Name</label>
            <Input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Analytics"
              className="mt-1"
            />
            {orgSlug && (
              <div className="mt-1 text-[11px] font-mono text-ink-2">
                Slug: <span className="text-ink">{orgSlug}</span>
              </div>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={loading}
            className="w-full justify-center mt-2"
          >
            {loading ? "Provisioning Workspace..." : "Create Free Workspace"}
          </Button>

          <p className="text-[11px] text-ink-3 text-center leading-relaxed">
            By creating a workspace, you agree to our{" "}
            <Link href="/terms" className="text-ink-2 underline hover:text-ink">Terms</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-ink-2 underline hover:text-ink">Privacy Policy</Link>.
          </p>
        </form>

        <div className="mt-6 text-center text-xs text-ink-2 border-t border-hairline-subtle pt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
