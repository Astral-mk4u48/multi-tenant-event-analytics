import React from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy and data collection disclosure for EventPulse.",
};

export default function PrivacyPage() {
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
            LEGAL DISCLOSURE
          </span>
          <h1 className="text-3xl font-semibold text-ink mt-2">Privacy Policy</h1>
          <p className="text-xs font-mono text-ink-3 mt-1">Last Updated: November 24, 2026</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">1. Information We Collect</h2>
          <p>
            EventPulse collects only the minimum operational information necessary to provide event ingestion, analytics telemetry, and webhook dispatching:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Authentication Data:</strong> Your work email address, hashed credentials, or OAuth profile identifier provided during registration.</li>
            <li><strong>Event Telemetry:</strong> Ingested event names, timestamps, and customer-supplied JSON payloads dispatched to the ingestion API.</li>
            <li><strong>Outbound Delivery Logs:</strong> Destination webhook endpoint URLs, HTTP status response codes, delivery durations, and delivery attempt counts.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">2. Public Demo Workspace Notice</h2>
          <p className="border-l-2 border-accent pl-3 text-ink">
            <strong>Important:</strong> The &quot;Explore Demo Workspace&quot; feature allows public visitors to inspect sample telemetry and send test events. The demo workspace automatically purges and resets daily. Do not transmit sensitive proprietary data or personal identifiers (PII) into the public demo workspace.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">3. Tenant Isolation &amp; Cryptographic Security</h2>
          <p>
            All production multi-tenant accounts are cryptographically partitioned using PostgreSQL Row Level Security (RLS) directly at the database engine tier. Webhook signing secrets and mutual TLS private keys are stored encrypted at rest using AES-256-GCM.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">4. Third-Party Infrastructure</h2>
          <p>
            EventPulse utilizes trusted developer infrastructure: Supabase (PostgreSQL &amp; Auth), Vercel (Edge &amp; Serverless Hosting), and Upstash (Distributed Redis). We never sell, monetize, or share telemetry data with advertising networks.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-ink">5. Contact</h2>
          <p>
            For privacy inquiries or data deletion requests, contact Pavan at <code className="font-mono text-ink">Pavan.sankiliraj@gmail.com</code>.
          </p>
        </section>
      </main>

      <footer className="border-t border-hairline px-6 py-6 max-w-7xl mx-auto w-full text-xs font-mono text-ink-3 flex items-center justify-between">
        <div>EventPulse Engineering</div>
        <div className="flex items-center gap-4">
          <Link href="/terms" className="hover:text-ink text-ink-2">Terms of Service</Link>
          <Link href="/docs" className="hover:text-ink text-ink-2">Docs</Link>
        </div>
      </footer>
    </div>
  );
}
