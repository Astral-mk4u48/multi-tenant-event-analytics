"use client";

import React, { useState } from "react";
import { Copy, Check, X, Code2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface HmacSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  secret?: string;
}

export function HmacSnippetModal({
  isOpen,
  onClose,
  secret = "whsec_sample_secret_key",
}: HmacSnippetModalProps) {
  const [activeTab, setActiveTab] = useState<"node" | "python" | "go">("node");
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const nodeSnippet = `// Node.js Webhook Signature Verification
const crypto = require("crypto");

function verifyWebhookSignature(payload, signatureHeader, secret) {
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.split("=")[1];
  const signature = parts.find((p) => p.startsWith("v1="))?.split("=")[1];

  if (!timestamp || !signature) return false;

  const hmac = crypto
    .createHmac("sha256", secret)
    .update(\`\${timestamp}.\${payload}\`)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}`;

  const pythonSnippet = `# Python (FastAPI / Flask) Webhook Signature Verification
import hmac
import hashlib

def verify_webhook_signature(payload: str, signature_header: str, secret: str) -> bool:
    parts = dict(part.split("=") for part in signature_header.split(","))
    timestamp = parts.get("t")
    signature = parts.get("v1")

    if not timestamp or not signature:
        return False

    signed_payload = f"{timestamp}.{payload}".encode("utf-8")
    expected_hmac = hmac.new(
        secret.encode("utf-8"), signed_payload, hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(expected_hmac, signature)`;

  const goSnippet = `// Go Webhook Signature Verification
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

func VerifyWebhook(payload, signatureHeader, secret string) bool {
	parts := strings.Split(signatureHeader, ",")
	var timestamp, signature string
	for _, p := range parts {
		if strings.HasPrefix(p, "t=") {
			timestamp = strings.TrimPrefix(p, "t=")
		} else if strings.HasPrefix(p, "v1=") {
			signature = strings.TrimPrefix(p, "v1=")
		}
	}
	if timestamp == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%s.%s", timestamp, payload)))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}`;

  const currentSnippet =
    activeTab === "node" ? nodeSnippet : activeTab === "python" ? pythonSnippet : goSnippet;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-black/60">
      <div className="bg-surface border border-hairline max-w-2xl w-full p-6 space-y-4 rounded-md">
        <div className="flex items-center justify-between border-b border-hairline-subtle pb-3">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-accent" />
            <h3 className="type-section text-ink font-semibold">
              Webhook Signature Verification
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink transition-colors p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="type-body text-ink-2">
          Every outbound delivery includes a timestamp and HMAC-SHA256 signature in the{" "}
          <code className="text-ink bg-inset px-1 py-0.5 rounded-sm mono-data text-xs border border-hairline-subtle">
            X-Webhook-Signature
          </code>{" "}
          header (e.g. <code className="text-accent mono-data text-xs">t=1732400000,v1=a3b9...</code>).
        </p>

        {/* Tab Buttons */}
        <div className="flex items-center gap-2 border-b border-hairline-subtle pb-2 text-xs">
          {(["node", "python", "go"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 font-mono uppercase text-[11px] rounded-sm transition-colors duration-150 cursor-pointer ${
                activeTab === tab
                  ? "bg-accent text-white font-semibold"
                  : "text-ink-2 hover:text-ink hover:bg-elevated"
              }`}
            >
              {tab === "node" ? "Node.js" : tab === "python" ? "Python" : "Go"}
            </button>
          ))}

          <button
            onClick={handleCopy}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs text-ink-2 hover:text-ink bg-elevated border border-hairline rounded-sm transition-colors duration-150 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-status-success" />
                <span className="text-status-success mono-data">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-ink-3" />
                <span className="mono-data">Copy Code</span>
              </>
            )}
          </button>
        </div>

        {/* Code Snippet Box */}
        <div className="bg-inset border border-hairline p-4 rounded-sm overflow-x-auto">
          <pre className="font-mono text-[11px] text-ink leading-relaxed">
            {currentSnippet}
          </pre>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
