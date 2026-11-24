import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "EventPulse — Event Analytics & Webhook Delivery";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#090A0C",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              backgroundColor: "#E5484D",
              borderRadius: "4px",
            }}
          />
          <span
            style={{
              color: "#EEEEEE",
              fontSize: "28px",
              fontWeight: 600,
              letterSpacing: "0.1em",
            }}
          >
            EVENTPULSE
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: "#999999",
              fontSize: "16px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#30A46C",
              }}
            />
            Multi-Tenant Ingestion &amp; Outbound Webhook Delivery
          </div>
          <div
            style={{
              color: "#EEEEEE",
              fontSize: "48px",
              fontWeight: 600,
              lineHeight: 1.15,
              maxWidth: "960px",
            }}
          >
            High-velocity event telemetry and guaranteed webhook execution.
          </div>
          <div
            style={{
              color: "#999999",
              fontSize: "20px",
              lineHeight: 1.5,
              maxWidth: "880px",
            }}
          >
            PostgreSQL Row Level Security • Sliding-Window Rate Limiting • HMAC-SHA256 Signatures • SSRF Shield
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #1F242D",
            paddingTop: "24px",
            color: "#666666",
            fontSize: "16px",
          }}
        >
          <span>https://multi-tenant-event-analytics.vercel.app</span>
          <span>Engineered by Pavan</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
