"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { DrawerProvider } from "../drawer/DrawerContext";
import { PayloadDrawer } from "../drawer/PayloadDrawer";
import { CommandPalette } from "../modals/CommandPalette";
import { SendTestEventModal } from "../modals/SendTestEventModal";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isTestEventOpen, setIsTestEventOpen] = useState(false);

  // Global Keyboard Shortcuts (Section 7.7)
  useEffect(() => {
    let lastKey = "";
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (e.key === "/" && !isInput) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>("input[type='search'], input[placeholder*='search'], input[placeholder*='filter']");
        if (searchInput) searchInput.focus();
        return;
      }

      // G then key chords (1-second window)
      if (!isInput) {
        const now = Date.now();
        if (e.key.toLowerCase() === "g") {
          lastKey = "g";
          lastKeyTime = now;
          return;
        }

        if (lastKey === "g" && now - lastKeyTime <= 1000) {
          const k = e.key.toLowerCase();
          lastKey = "";
          if (k === "o") router.push("/dashboard");
          else if (k === "l") router.push("/dashboard/live");
          else if (k === "e") router.push("/dashboard/events");
          else if (k === "w") router.push("/dashboard/webhooks");
          else if (k === "d") router.push("/dashboard/dlq");
          else if (k === "k") router.push("/dashboard/settings/keys");
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return (
    <DrawerProvider>
      <div className="min-h-screen bg-canvas text-ink flex">
        {/* Fixed 232px Sidebar */}
        <Sidebar />

        {/* Main Application Area (offset by 232px sidebar) */}
        <div className="flex-1 ml-sidebar flex flex-col min-h-screen">
          {/* Fixed 48px Topbar wrapped in Suspense boundary */}
          <Suspense fallback={<div className="fixed top-0 left-sidebar right-0 h-topbar bg-canvas border-b border-hairline-subtle z-shell" />}>
            <Topbar
              onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
              onOpenTestEvent={() => setIsTestEventOpen(true)}
            />
          </Suspense>

          {/* Main Viewport Content (offset by 48px topbar, p-6, max-w-[1440px]) */}
          <main className="mt-topbar flex-1 p-6 max-w-[1440px] w-full">
            {children}
          </main>
        </div>

        {/* Global Slide-Over Payload Inspector Drawer */}
        <PayloadDrawer />

        {/* ⌘K Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onOpenTestEvent={() => setIsTestEventOpen(true)}
        />

        {/* Send Test Event Modal */}
        <SendTestEventModal
          isOpen={isTestEventOpen}
          onClose={() => setIsTestEventOpen(false)}
        />
      </div>
    </DrawerProvider>
  );
}
