"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#09090B] p-4 text-[#F1F5F9]">
      <div className="w-full max-w-[420px] rounded-md border border-[#1E1E24] bg-[#0F0F12] p-8 shadow-2xl">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 bg-[#E11D48]" />
            <span className="font-mono text-sm font-semibold tracking-wider text-[#F1F5F9]">
              EVENTPULSE
            </span>
          </div>
          <h1 className="mt-4 text-lg font-semibold text-[#F1F5F9]">Create Free Workspace</h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Deploy a dedicated multi-tenant event pipeline in seconds
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded border border-[#E11D48]/30 bg-[#E11D48]/10 p-3 text-xs text-[#F43F5E]">
            {error}
          </div>
        )}

        <form onSubmit={handleSignUp} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#94A3B8]">Full Name</label>
            <Input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Pavan"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-[#94A3B8]">Work Email</label>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pavan@company.com"
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
              placeholder="Minimum 8 characters"
              className="mt-1"
            />
            {passwordStrength !== null && (
              <div className="mt-2 flex items-center gap-1">
                {[1, 2, 3, 4].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-sm ${
                      passwordStrength >= level
                        ? passwordStrength <= 2
                          ? "bg-[#F59E0B]"
                          : "bg-[#10B981]"
                        : "bg-[#1E1E24]"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-[#94A3B8]">Organization Name</label>
            <Input
              type="text"
              required
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Analytics"
              className="mt-1"
            />
            {orgSlug && (
              <div className="mt-1 text-[11px] font-mono text-[#94A3B8]">
                Slug: <span className="text-[#F1F5F9]">{orgSlug}</span>
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
        </form>

        <div className="mt-6 text-center text-xs text-[#94A3B8]">
          Already have an account?{" "}
          <Link href="/login" className="text-[#E11D48] hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
