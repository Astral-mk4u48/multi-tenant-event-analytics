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
    <div className="min-h-screen bg-canvas text-ink flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-hairline-subtle px-8 h-14 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <span className="h-3.5 w-3.5 bg-accent" />
          <span className="font-mono text-sm font-semibold tracking-wider text-ink">
            EVENTPULSE
          </span>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-xs text-ink-2 hover:text-ink transition-colors duration-150 font-medium"
          >
            Sign In
          </Link>
          <Link
            href="/signup"
            className="text-xs font-medium text-white bg-accent px-3.5 py-1.5 rounded-sm hover:bg-accent-hover transition-colors duration-150"
          >
            Create Workspace
          </Link>
        </div>
      </header>

      {/* Main Architectural Hero */}
      <main className="max-w-7xl mx-auto px-8 py-16 flex-1 flex flex-col justify-center w-full">
        <div className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 border border-hairline-subtle bg-surface px-3 py-1 font-mono text-xs text-ink-2">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            MULTI-TENANT INGESTION &amp; OUTBOUND WEBHOOK DELIVERY
          </div>

          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-ink leading-tight">
            High-velocity event telemetry and guaranteed webhook execution.
          </h1>

          <p className="text-sm text-ink-2 leading-relaxed max-w-2xl">
            Built for enterprise multi-tenancy with PostgreSQL Row Level Security (RLS),
            sliding-window rate limiting, HMAC-SHA256 delivery signing, automated SSRF filtering,
            and BullMQ dead-letter retry queues.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup"
              className="text-xs font-semibold text-white bg-accent px-5 py-2.5 rounded-sm hover:bg-accent-hover transition-colors duration-150"
            >
              Create Workspace
            </Link>
            <Link
              href="/login"
              className="text-xs font-medium text-ink border border-hairline bg-surface px-5 py-2.5 rounded-sm hover:bg-elevated transition-colors duration-150"
            >
              Explore Demo Workspace
            </Link>
          </div>
        </div>

        {/* Architectural Features */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-hairline-subtle pt-8">
          <div className="border border-hairline-subtle bg-surface p-5">
            <div className="font-mono text-xs text-accent font-semibold tracking-wider">01 / INGESTION</div>
            <h3 className="mt-2 text-sm font-semibold text-ink">Sliding-Window Pipeline</h3>
            <p className="mt-1.5 text-xs text-ink-2 leading-relaxed">
              Redis Lua atomic rate limiting with BullMQ micro-batch buffering delivering sub-15ms p99 ingestion latency.
            </p>
          </div>

          <div className="border border-hairline-subtle bg-surface p-5">
            <div className="font-mono text-xs text-accent font-semibold tracking-wider">02 / OUTBOUND ENGINE</div>
            <h3 className="mt-2 text-sm font-semibold text-ink">HMAC-SHA256 &amp; SSRF Shield</h3>
            <p className="mt-1.5 text-xs text-ink-2 leading-relaxed">
              Cryptographic delivery signatures, RFC 1918 loopback / link-local IP filtering, and 5-step exponential backoff.
            </p>
          </div>

          <div className="border border-hairline-subtle bg-surface p-5">
            <div className="font-mono text-xs text-accent font-semibold tracking-wider">03 / ISOLATION</div>
            <h3 className="mt-2 text-sm font-semibold text-ink">PostgreSQL Row Level Security</h3>
            <p className="mt-1.5 text-xs text-ink-2 leading-relaxed">
              Strict multi-tenant cryptographic partition isolation enforced directly at the database engine tier.
            </p>
          </div>
        </div>
      </main>

      {/* Operational Footer */}
      <footer className="border-t border-hairline-subtle px-8 h-12 flex items-center justify-between max-w-7xl mx-auto w-full text-[11px] font-mono text-ink-3">
        <div className="text-ink-2">EventPulse</div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
          <span>All systems operational</span>
        </div>
      </footer>
    </div>
  );
}
