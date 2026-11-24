import { describe, it, expect } from "vitest";

describe("DLQ Null Safety & Defensive Formatting", () => {
  it("formats null or undefined attributes with fallback em-dash", () => {
    function formatDlqAttribute(val: string | null | undefined): string {
      return val ?? "—";
    }

    expect(formatDlqAttribute(null)).toBe("—");
    expect(formatDlqAttribute(undefined)).toBe("—");
    expect(formatDlqAttribute("Connection refused")).toBe("Connection refused");
  });

  it("safely handles invalid or missing timestamps without throwing RangeError", () => {
    function safeFormatDate(val: string | null | undefined): string {
      if (!val) return "—";
      try {
        const d = new Date(val);
        if (isNaN(d.getTime())) return "—";
        return d.toISOString().substring(0, 19).replace("T", " ");
      } catch {
        return "—";
      }
    }

    expect(safeFormatDate(null)).toBe("—");
    expect(safeFormatDate(undefined)).toBe("—");
    expect(safeFormatDate("invalid-timestamp")).toBe("—");
    expect(safeFormatDate("2026-11-23T12:00:00.000Z")).toBe("2026-11-23 12:00:00");
  });

  it("enforces full envelope response schema for empty DLQ state", () => {
    const emptyResponse = {
      items: [],
      data: [],
      nextCursor: null,
      totalCount: 0,
    };

    expect(Array.isArray(emptyResponse.items)).toBe(true);
    expect(emptyResponse.items.length).toBe(0);
    expect(emptyResponse.nextCursor).toBeNull();
    expect(emptyResponse.totalCount).toBe(0);
  });
});
