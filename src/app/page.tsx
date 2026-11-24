import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SESSION_COOKIE_NAME, verifySession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken && verifySession(sessionToken)) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F1F5F9] flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-[#1E1E24] px-8 h-14 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <span className="h-3.5 w-3.5 bg-[#E11D48]" />
          <span className="font-mono text-sm font-semibold tracking-wider text-[#F1F5F9]">
            EVENTPULSE
          </span>
          <span className="text-[10px] font-mono text-[#94A3B8] px-1.5 py-0.5 border border-[#1E1E24] bg-[#0F0F12]">
            v2.2.0
          </span>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-xs text-[#94A3B8] hover:text-[#F1F5F9] transition-colors font-medium"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="text-xs font-medium text-white bg-[#E11D48] px-3.5 py-1.5 rounded-sm hover:bg-[#F43F5E] transition-colors"
          >
            Create Free Workspace
          </Link>
        </div>
      </header>

      {/* Main Architectural Hero */}
      <main className="max-w-7xl mx-auto px-8 py-16 flex-1 flex flex-col justify-center w-full">
        <div className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 border border-[#1E1E24] bg-[#0F0F12] px-3 py-1 font-mono text-xs text-[#94A3B8]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
            MULTI-TENANT INGESTION & OUTBOUND WEBHOOK DELIVERY
          </div>

          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-[#F1F5F9] leading-tight">
            High-velocity event telemetry and guaranteed webhook execution.
          </h1>

          <p className="text-sm text-[#94A3B8] leading-relaxed max-w-2xl">
            Built for enterprise multi-tenancy with PostgreSQL Row Level Security (RLS),
            sliding-window rate limiting, HMAC-SHA256 delivery signing, automated SSRF filtering,
            and BullMQ dead-letter retry queues.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup"
              className="text-xs font-semibold text-white bg-[#E11D48] px-5 py-2.5 rounded-sm hover:bg-[#F43F5E] transition-colors"
            >
              Create Free Workspace
            </Link>
            <Link
              href="/login"
              className="text-xs font-medium text-[#F1F5F9] border border-[#1E1E24] bg-[#0F0F12] px-5 py-2.5 rounded-sm hover:bg-[#18181B] transition-colors"
            >
              Launch Live Demo
            </Link>
          </div>
        </div>

        {/* Architecture Spec Grid */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-[#1E1E24] pt-8">
          <div className="border border-[#1E1E24] bg-[#0F0F12] p-5">
            <div className="font-mono text-xs text-[#E11D48] font-semibold">01 / INGESTION</div>
            <h3 className="mt-2 text-sm font-semibold text-[#F1F5F9]">Sliding-Window Pipeline</h3>
            <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
              Redis Lua atomic rate limiting with BullMQ micro-batch buffering delivering sub-15ms p99 ingestion latency.
            </p>
          </div>

          <div className="border border-[#1E1E24] bg-[#0F0F12] p-5">
            <div className="font-mono text-xs text-[#E11D48] font-semibold">02 / OUTBOUND ENGINE</div>
            <h3 className="mt-2 text-sm font-semibold text-[#F1F5F9]">HMAC-SHA256 & SSRF Shield</h3>
            <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
              Cryptographic delivery signatures, RFC 1918 loopback / link-local IP filtering, and 5-step exponential backoff.
            </p>
          </div>

          <div className="border border-[#1E1E24] bg-[#0F0F12] p-5">
            <div className="font-mono text-xs text-[#E11D48] font-semibold">03 / ISOLATION</div>
            <h3 className="mt-2 text-sm font-semibold text-[#F1F5F9]">PostgreSQL Row Level Security</h3>
            <p className="mt-1.5 text-xs text-[#94A3B8] leading-relaxed">
              Strict multi-tenant cryptographic partition isolation enforced directly at the database engine tier.
            </p>
          </div>
        </div>
      </main>

      {/* Operational Footer */}
      <footer className="border-t border-[#1E1E24] px-8 h-12 flex items-center justify-between max-w-7xl mx-auto w-full text-[11px] font-mono text-[#94A3B8]">
        <div>Pavan (@Astral-mk4u48)</div>
        <div>OPERATIONAL · ALL SYSTEMS NORMAL</div>
      </footer>
    </div>
  );
}
