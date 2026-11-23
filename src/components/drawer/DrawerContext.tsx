"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

interface DrawerContextValue {
  selectedDeliveryId: string | null;
  openDrawer: (deliveryId: string) => void;
  closeDrawer: () => void;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);

  const openDrawer = useCallback((deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedDeliveryId(null);
  }, []);

  return (
    <DrawerContext.Provider value={{ selectedDeliveryId, openDrawer, closeDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
}

export function useDrawer() {
  const ctx = useContext(DrawerContext);
  if (!ctx) {
    throw new Error("useDrawer must be used within a DrawerProvider");
  }
  return ctx;
}
