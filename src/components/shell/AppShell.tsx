"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { DrawerProvider } from "../drawer/DrawerContext";
import { PayloadDrawer } from "../drawer/PayloadDrawer";
import { CommandPalette } from "../modals/CommandPalette";
import { SendTestEventModal } from "../modals/SendTestEventModal";
import { ShortcutsHelpModal } from "../modals/ShortcutsHelpModal";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isTestEventOpen, setIsTestEventOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

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

      if (e.key === "?" && !isInput) {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
        return;
      }

      if (e.key === "/" && !isInput) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>("input[type='search'], input[placeholder*='search'], input[placeholder*='filter']");
        if (searchInput) searchInput.focus();
        return;
      }

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
      <div className="flex min-h-screen w-full bg-canvas text-ink overflow-x-hidden">
        {/* Fixed 232px Sidebar */}
        <Sidebar />

        {/* Main Application Area (contained with min-w-0 to prevent horizontal blowout) */}
        <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden ml-sidebar min-h-screen">
          <Suspense fallback={<div className="fixed top-0 left-sidebar right-0 h-topbar bg-canvas border-b border-hairline-subtle z-shell" />}>
            <Topbar
              onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
              onOpenTestEvent={() => setIsTestEventOpen(true)}
            />
          </Suspense>

          <main className="mt-topbar min-w-0 flex-1 p-6 max-w-[1440px] w-full overflow-x-auto">
            {children}
          </main>
        </div>

        <PayloadDrawer />

        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onOpenTestEvent={() => setIsTestEventOpen(true)}
        />

        <SendTestEventModal
          isOpen={isTestEventOpen}
          onClose={() => setIsTestEventOpen(false)}
        />

        <ShortcutsHelpModal
          isOpen={isShortcutsOpen}
          onClose={() => setIsShortcutsOpen(false)}
        />
      </div>
    </DrawerProvider>
  );
}
