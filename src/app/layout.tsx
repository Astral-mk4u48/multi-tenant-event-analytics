import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://multi-tenant-event-analytics.vercel.app"),
  title: {
    default: "EventPulse — Event Analytics & Webhook Delivery",
    template: "%s | EventPulse",
  },
  description: "High-velocity event ingestion, telemetry analytics, and cryptographically signed outbound webhook delivery for engineering teams.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/logo.svg",
  },
  openGraph: {
    title: "EventPulse — Event Analytics & Webhook Delivery",
    description: "High-velocity event ingestion, telemetry analytics, and cryptographically signed outbound webhook delivery.",
    url: "https://multi-tenant-event-analytics.vercel.app",
    siteName: "EventPulse",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EventPulse — Event Analytics & Webhook Delivery",
    description: "High-velocity event ingestion, telemetry analytics, and cryptographically signed outbound webhook delivery.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
