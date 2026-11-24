import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { SESSION_COOKIE_NAME, verifySession } from "@/server/auth/session";
import { HeroTerminal } from "@/components/landing/HeroTerminal";
import { CurlSnippet } from "@/components/landing/CurlSnippet";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionToken && verifySession(sessionToken)) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col justify-between selection:bg-accent/20 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-hairline-subtle px-6 h-14 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link href="/" className="flex items-center gap-2.5">
          <Image
            src="/logo.svg"
            alt="EventPulse Logo"
            width={16}
            height={16}
            className="w-4 h-4 rounded-sm"
          />
          <span className="font-mono text-xs font-semibold tracking-wider text-ink uppercase">
            EVENTPULSE
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/docs"
            className="text-xs text-ink-2 hover:text-ink transition-colors duration-150 font-medium"
          >
            Documentation
          </Link>
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
      <main className="max-w-7xl mx-auto px-6 py-12 lg:py-20 flex-1 flex flex-col justify-center w-full space-y-16 lg:space-y-24">
        {/* 2-Column Hero */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="inline-flex items-center gap-2 border border-hairline-subtle bg-surface px-3 py-1 font-mono text-[11px] text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success animate-pulse" />
              MULTI-TENANT INGESTION &amp; OUTBOUND WEBHOOK DELIVERY
            </div>

            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight text-ink leading-[1.12]">
              High-velocity event telemetry and guaranteed webhook execution.
            </h1>

            <p className="text-sm text-ink-2 leading-relaxed max-w-xl">
              Engineered for enterprise multi-tenancy with PostgreSQL Row Level Security (RLS),
              sliding-window token bucket rate limiting, HMAC-SHA256 signatures, automated SSRF
              filtering, and BullMQ dead-letter retry queues.
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

            <div className="pt-4 flex items-center gap-6 text-[11px] font-mono text-ink-3">
              <span>POSTGRESQL RLS</span>
              <span>•</span>
              <span>LUA TOKEN BUCKET</span>
              <span>•</span>
              <span>mTLS SUPPORT</span>
            </div>
          </div>

          <div className="lg:col-span-6 w-full">
            <HeroTerminal />
          </div>
        </section>

        {/* 3-Step Architecture Pipeline */}
        <section className="space-y-6 border-t border-hairline-subtle pt-12">
          <div className="max-w-2xl">
            <span className="font-mono text-xs text-accent font-semibold tracking-wider">
              PIPELINE ARCHITECTURE
            </span>
            <h2 className="text-2xl font-semibold text-ink mt-1">
              End-to-end event lifecycle under 20 milliseconds.
            </h2>
            <p className="text-xs text-ink-2 mt-1.5 leading-relaxed">
              Every request is partitioned with Row Level Security, validated against SSRF shields,
              and signed with cryptographically isolated keys.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-hairline-subtle bg-surface p-5 space-y-2">
              <div className="font-mono text-xs text-accent font-semibold tracking-wider">
                01 / INGEST
              </div>
              <h3 className="text-sm font-semibold text-ink">Atomic Lua Sliding Window</h3>
              <p className="text-xs text-ink-2 leading-relaxed">
                Redis Lua atomic token bucket evaluates tenant quotas in sub-millisecond windows,
                returning standard <code className="text-ink font-mono text-[11px]">X-RateLimit-*</code> headers and queuing accepted payloads to BullMQ micro-batches.
              </p>
            </div>

            <div className="border border-hairline-subtle bg-surface p-5 space-y-2">
              <div className="font-mono text-xs text-accent font-semibold tracking-wider">
                02 / ROUTE
              </div>
              <h3 className="text-sm font-semibold text-ink">Topic Matching &amp; Idempotency</h3>
              <p className="text-xs text-ink-2 leading-relaxed">
                High-throughput topic glob evaluation (<code className="text-ink font-mono text-[11px]">order.*</code>) fans out incoming events to registered endpoints with strict deduplication on unique event IDs.
              </p>
            </div>

            <div className="border border-hairline-subtle bg-surface p-5 space-y-2">
              <div className="font-mono text-xs text-accent font-semibold tracking-wider">
                03 / DELIVER
              </div>
              <h3 className="text-sm font-semibold text-ink">HMAC-SHA256 &amp; SSRF Shield</h3>
              <p className="text-xs text-ink-2 leading-relaxed">
                Outbound payloads are signed using AES-256-GCM encrypted secrets, validated against
                private/link-local DNS rebinding attacks, and dispatched with 5-step exponential backoff.
              </p>
            </div>
          </div>
        </section>

        {/* Live Ingestion Interactive Curl Snippet */}
        <section className="space-y-4 border-t border-hairline-subtle pt-12">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-mono text-xs text-accent font-semibold tracking-wider">
                INTEGRATION
              </span>
              <h2 className="text-2xl font-semibold text-ink mt-1">Send your first event.</h2>
            </div>
            <Link
              href="/docs"
              className="text-xs font-mono text-accent hover:underline flex items-center gap-1"
            >
              View API Documentation →
            </Link>
          </div>
          <CurlSnippet />
        </section>

        {/* Enterprise Security Section */}
        <section className="border-t border-hairline-subtle pt-12 space-y-6">
          <div className="max-w-2xl">
            <span className="font-mono text-xs text-accent font-semibold tracking-wider">
              ENTERPRISE SECURITY &amp; ISOLATION
            </span>
            <h2 className="text-2xl font-semibold text-ink mt-1">
              Zero-trust tenancy enforced at the database tier.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-hairline-subtle bg-surface p-5 space-y-2">
              <h4 className="text-sm font-semibold text-ink">PostgreSQL Row Level Security (RLS)</h4>
              <p className="text-xs text-ink-2 leading-relaxed">
                Tenant isolation is not an application-layer afterthought. All tables enforce <code className="font-mono text-ink text-[11px]">FORCE ROW LEVEL SECURITY</code>, with scoped session context <code className="font-mono text-ink text-[11px]">SET LOCAL app.current_org_id</code> bound directly inside each transaction.
              </p>
            </div>

            <div className="border border-hairline-subtle bg-surface p-5 space-y-2">
              <h4 className="text-sm font-semibold text-ink">SSRF Shield &amp; Anti-DNS Rebinding</h4>
              <p className="text-xs text-ink-2 leading-relaxed">
                Every webhook endpoint destination is validated against loopback, RFC 1918 private subnets, and AWS/GCP cloud metadata IP ranges (169.254.169.254) with custom socket-level lookup handlers defeating DNS rebinding attacks.
              </p>
            </div>

            <div className="border border-hairline-subtle bg-surface p-5 space-y-2">
              <h4 className="text-sm font-semibold text-ink">Cryptographic Signatures &amp; Secrets at Rest</h4>
              <p className="text-xs text-ink-2 leading-relaxed">
                Outbound payloads carry canonical <code className="font-mono text-ink text-[11px]">X-Webhook-Signature</code> headers computed with HMAC-SHA256 and unix timestamps. Signing secrets are encrypted at rest using AES-256-GCM.
              </p>
            </div>

            <div className="border border-hairline-subtle bg-surface p-5 space-y-2">
              <h4 className="text-sm font-semibold text-ink">mTLS Mutual Authentication &amp; Dead-Letter Triage</h4>
              <p className="text-xs text-ink-2 leading-relaxed">
                Enterprise endpoints can supply custom client certificates and keys for bidirectional TLS authentication. Exhausted delivery attempts land in the Dead Letter Queue for manual inspection and bulk replay.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Operational Footer with Dynamic Health Check */}
      <LandingFooter />
    </div>
  );
}
