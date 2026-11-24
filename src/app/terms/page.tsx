import React from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service and acceptable use conditions for EventPulse.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col justify-between selection:bg-accent/20 selection:text-white">
      <header className="border-b border-hairline px-6 h-14 flex items-center justify-between max-w-7xl mx-auto w-full">
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
        <Link href="/" className="text-xs font-mono text-ink-2 hover:text-ink">
          ← Back to Home
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 flex-1 w-full space-y-8 font-sans text-xs sm:text-sm text-ink-2 leading-relaxed">
        <div>
          <span className="font-mono text-xs text-accent font-semibold tracking-wider">
            LEGAL AGREEMENT
          </span>
          <h1 className="text-3xl font-semibold text-ink mt-2">Terms of Service</h1>
          <p className="text-xs font-mono text-ink-3 mt-1">Last Updated: November 24, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">1. Acceptance of Terms</h2>
          <p>
            By accessing or using the EventPulse platform, APIs, or hosted dashboards, you agree to be bound by these Terms of Service. If you do not agree to these terms, do not access the services.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">2. Acceptable Use Policy</h2>
          <p>
            EventPulse provides high-velocity event telemetry and webhook dispatching for lawful application development. You agree not to:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Target webhook endpoints belonging to third parties without authorization (SSRF or Denial of Service attacks).</li>
            <li>Transmit unsolicited spam, illegal payloads, or malware through the ingestion API.</li>
            <li>Attempt to bypass PostgreSQL Row Level Security (RLS) or probe tenant boundary isolations.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">3. Disclaimer of Warranty</h2>
          <p className="border-l-2 border-hairline-strong pl-3 text-ink-2">
            The service is provided &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; without warranties of any kind, either express or implied, including but not limited to uptime guarantees, fitness for a particular purpose, or uninterrupted availability.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">4. Limitation of Liability</h2>
          <p>
            In no event shall EventPulse or its author (Pavan) be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of or inability to use the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">5. Open Source License</h2>
          <p>
            The underlying EventPulse software architecture is open-source under the MIT License. You may inspect, modify, and self-host the codebase per the repository terms on <a href="https://github.com/Astral-mk4u48/multi-tenant-event-analytics" target="_blank" rel="noopener noreferrer" className="text-accent underline">GitHub</a>.
          </p>
        </section>
      </main>

      <footer className="border-t border-hairline px-6 py-6 max-w-7xl mx-auto w-full text-xs font-mono text-ink-3 flex items-center justify-between">
        <div>EventPulse Engineering</div>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-ink text-ink-2">Privacy Policy</Link>
          <Link href="/docs" className="hover:text-ink text-ink-2">Documentation</Link>
        </div>
      </footer>
    </div>
  );
}
