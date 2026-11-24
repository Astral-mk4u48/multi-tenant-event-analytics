import React from "react";
import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation",
  description: "Developer documentation, authentication schemas, event ingestion endpoints, and webhook signature verification for EventPulse.",
};

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col justify-between selection:bg-accent/20 selection:text-white">
      {/* Header */}
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
            EVENTPULSE DOCS
          </span>
        </Link>
        <div className="flex items-center gap-4 text-xs font-mono">
          <Link href="/dashboard" className="text-ink-2 hover:text-ink transition-colors">
            Dashboard
          </Link>
          <Link
            href="/login"
            className="text-white bg-accent px-3 py-1.5 rounded-sm hover:bg-accent-hover transition-colors font-medium"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Docs Body */}
      <main className="max-w-4xl mx-auto px-6 py-12 flex-1 w-full space-y-12">
        <div>
          <span className="font-mono text-xs text-accent font-semibold tracking-wider">
            DEVELOPER API REFERENCE
          </span>
          <h1 className="text-3xl font-semibold text-ink mt-2">
            EventPulse Ingestion &amp; Webhook API
          </h1>
          <p className="text-sm text-ink-2 mt-2 leading-relaxed">
            EventPulse provides sub-20ms HTTP endpoints for high-velocity event ingestion, telemetry
            analytics, and cryptographically signed outbound webhook delivery.
          </p>
        </div>

        {/* Authentication */}
        <section className="space-y-4 border-t border-hairline pt-8">
          <h2 className="text-xl font-semibold text-ink">1. Authentication</h2>
          <p className="text-xs text-ink-2 leading-relaxed">
            API requests require an API key passed in the <code className="font-mono text-ink">Authorization</code> header as a Bearer token. Generate keys in the <Link href="/dashboard/settings/keys" className="text-accent underline">API Keys</Link> dashboard.
          </p>
          <div className="border border-hairline bg-surface p-4 font-mono text-xs">
            <span className="text-ink-3"># Pass your live ingestion key in the Authorization header</span>
            <div className="text-ink mt-1">Authorization: Bearer pk_live_YOUR_KEY_HERE</div>
          </div>
          <div className="text-xs text-ink-2">
            Keys are scoped (<code className="font-mono text-ink">INGEST</code> or <code className="font-mono text-ink">ADMIN</code>). <code className="font-mono text-ink">INGEST</code> keys can dispatch events. <code className="font-mono text-ink">ADMIN</code> keys can manage webhooks, team members, and replay dead-letter messages.
          </div>
        </section>

        {/* POST /api/v1/events */}
        <section className="space-y-4 border-t border-hairline pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-emerald-subtle text-emerald border border-emerald/30">
              POST
            </span>
            <span className="font-mono text-sm text-ink font-semibold">/api/v1/events</span>
          </div>
          <p className="text-xs text-ink-2 leading-relaxed">
            Ingests a single event payload into the high-velocity pipeline. Rate limits are evaluated
            atomically in Redis, and accepted events return HTTP 202 Accepted.
          </p>

          <div className="border border-hairline bg-surface p-4 font-mono text-xs space-y-2">
            <span className="text-ink-3"># Ingest single event</span>
            <pre className="text-ink overflow-x-auto leading-relaxed">
{`curl -X POST https://multi-tenant-event-analytics.vercel.app/api/v1/events \\
  -H "Authorization: Bearer pk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "event": "payment.succeeded",
    "payload": {
      "customer_id": "cus_92f8a1",
      "amount": 14900,
      "currency": "usd"
    }
  }'`}
            </pre>
          </div>

          <div className="border border-hairline bg-surface p-4 font-mono text-xs space-y-2">
            <span className="text-ink-3"># Response: 202 Accepted</span>
            <pre className="text-emerald overflow-x-auto leading-relaxed">
{`{
  "status": "queued",
  "event_id": "evt_01j9xk3m0007",
  "matched_endpoints": 1
}`}
            </pre>
          </div>
        </section>

        {/* POST /api/v1/events/batch */}
        <section className="space-y-4 border-t border-hairline pt-8">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-emerald-subtle text-emerald border border-emerald/30">
              POST
            </span>
            <span className="font-mono text-sm text-ink font-semibold">/api/v1/events/batch</span>
          </div>
          <p className="text-xs text-ink-2 leading-relaxed">
            Ingests up to 100 events in a single batch. All items are queued atomically in the micro-batch buffer.
          </p>

          <div className="border border-hairline bg-surface p-4 font-mono text-xs space-y-2">
            <span className="text-ink-3"># Batch request</span>
            <pre className="text-ink overflow-x-auto leading-relaxed">
{`curl -X POST https://multi-tenant-event-analytics.vercel.app/api/v1/events/batch \\
  -H "Authorization: Bearer pk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "events": [
      { "event": "order.placed", "payload": { "id": "ord_101" } },
      { "event": "payment.succeeded", "payload": { "id": "ord_101", "cents": 4900 } }
    ]
  }'`}
            </pre>
          </div>
        </section>

        {/* Rate Limiting & 429 Behaviour */}
        <section className="space-y-4 border-t border-hairline pt-8">
          <h2 className="text-xl font-semibold text-ink">2. Rate Limiting &amp; Quotas</h2>
          <p className="text-xs text-ink-2 leading-relaxed">
            EventPulse enforces sliding-window rate limiting per organization (default 250 requests per second). Every response includes standard rate limit headers:
          </p>
          <div className="border border-hairline bg-surface p-4 font-mono text-xs space-y-1">
            <div><span className="text-ink-2">X-RateLimit-Limit:</span> <span className="text-ink">250</span></div>
            <div><span className="text-ink-2">X-RateLimit-Remaining:</span> <span className="text-ink">244</span></div>
            <div><span className="text-ink-2">X-RateLimit-Reset:</span> <span className="text-ink">1732414450</span></div>
          </div>
          <p className="text-xs text-ink-2 leading-relaxed">
            When your organization exceeds its burst quota, the API returns <code className="font-mono text-ink">HTTP 429 Too Many Requests</code> with a <code className="font-mono text-ink">Retry-After</code> header in seconds.
          </p>
        </section>

        {/* Webhook Signature Verification */}
        <section className="space-y-4 border-t border-hairline pt-8">
          <h2 className="text-xl font-semibold text-ink">3. Verifying Webhook Signatures</h2>
          <p className="text-xs text-ink-2 leading-relaxed">
            Every webhook delivery request carries an <code className="font-mono text-ink">X-Webhook-Signature</code> header.
            The header format is <code className="font-mono text-ink">t=TIMESTAMP,v1=SIGNATURE</code> where <code className="font-mono text-ink">SIGNATURE</code> is the HMAC-SHA256 hex digest of <code className="font-mono text-ink">TIMESTAMP.RAW_BODY</code> using your endpoint&apos;s signing secret (<code className="font-mono text-ink">whsec_...</code>).
          </p>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Node.js (TypeScript / JavaScript)</h3>
            <div className="border border-hairline bg-surface p-4 font-mono text-xs overflow-x-auto leading-relaxed">
              <pre className="text-ink">
{`import crypto from "crypto";

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300
): boolean {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const timestamp = parseInt(parts.t, 10);
  const signature = parts.v1;

  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) {
    return false; // Timestamp out of tolerance (replay attack)
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex")
  );
}`}
              </pre>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-ink">Python 3</h3>
            <div className="border border-hairline bg-surface p-4 font-mono text-xs overflow-x-auto leading-relaxed">
              <pre className="text-ink">
{`import hmac
import hashlib
import time

def verify_webhook_signature(raw_body: bytes, signature_header: str, secret: str, tolerance: int = 300) -> bool:
    pairs = dict(item.split("=") for item in signature_header.split(","))
    timestamp = int(pairs["t"])
    signature = pairs["v1"]

    if abs(time.time() - timestamp) > tolerance:
        return False  # Replay attack protection

    signed_payload = f"{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()

    return hmac.compare_digest(signature, expected)`}
              </pre>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-hairline px-6 py-6 max-w-7xl mx-auto w-full text-xs font-mono text-ink-3 flex items-center justify-between">
        <div>EventPulse Engineering</div>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-ink text-ink-2">Privacy</Link>
          <Link href="/terms" className="hover:text-ink text-ink-2">Terms</Link>
          <Link href="/" className="hover:text-ink text-ink-2">Home</Link>
        </div>
      </footer>
    </div>
  );
}
