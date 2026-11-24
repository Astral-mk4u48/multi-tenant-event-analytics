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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
      <div className="bg-[#0F0F12] border border-[#1E1E24] max-w-2xl w-full p-6 space-y-4 rounded-md shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#1E1E24] pb-3">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-[#E11D48]" />
            <h3 className="text-sm font-semibold text-[#F1F5F9]">
              Webhook Signature Verification
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-[#94A3B8] hover:text-[#F1F5F9]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-[#94A3B8]">
          Every outbound delivery includes a timestamp and HMAC-SHA256 signature in the{" "}
          <code className="text-[#F1F5F9] bg-[#18181B] px-1 py-0.5 rounded">
            X-Webhook-Signature
          </code>{" "}
          header (e.g. <code className="text-[#E11D48]">t=1732400000,v1=a3b9...</code>).
        </p>

        {/* Tab Buttons */}
        <div className="flex items-center gap-2 border-b border-[#1E1E24] pb-2 text-xs">
          {(["node", "python", "go"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 font-mono uppercase text-[11px] rounded transition-colors ${
                activeTab === tab
                  ? "bg-[#E11D48] text-white font-semibold"
                  : "text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#18181B]"
              }`}
            >
              {tab === "node" ? "Node.js" : tab === "python" ? "Python" : "Go"}
            </button>
          ))}

          <button
            onClick={handleCopy}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#94A3B8] hover:text-white bg-[#18181B] border border-[#1E1E24] rounded"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#10B981]" />
                <span className="text-[#10B981]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Code</span>
              </>
            )}
          </button>
        </div>

        {/* Code Snippet Box */}
        <div className="bg-[#18181B] border border-[#1E1E24] p-4 rounded overflow-x-auto">
          <pre className="font-mono text-[11px] text-[#E2E8F0] leading-relaxed">
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
