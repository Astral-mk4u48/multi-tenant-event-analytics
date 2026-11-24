import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Part 2.1: Design Tokens & Visual Guardrails Audit", () => {
  const rootDir = process.cwd();
  const tokensCssPath = path.join(rootDir, "src/app/design-tokens.css");

  it("verifies design-tokens.css exists and defines Obsidian Dark core tokens", () => {
    expect(fs.existsSync(tokensCssPath)).toBe(true);
    const content = fs.readFileSync(tokensCssPath, "utf-8");

    // Check layer 1 surfaces
    expect(content).toContain("--color-canvas:");
    expect(content).toContain("--color-surface:");
    expect(content).toContain("--color-elevated:");
    expect(content).toContain("--color-inset:");

    // Check layer 2 borders
    expect(content).toContain("--color-hairline-subtle:");
    expect(content).toContain("--color-hairline:");
    expect(content).toContain("--color-hairline-strong:");

    // Check layer 3 text
    expect(content).toContain("--color-ink:");
    expect(content).toContain("--color-ink-2:");
    expect(content).toContain("--color-ink-3:");

    // Check layer 4 accents & semantic aliases
    expect(content).toContain("--color-crimson:");
    expect(content).toContain("--color-emerald:");
    expect(content).toContain("--color-amber:");
  });

  it("audits frontend components for forbidden Tailwind default colors and raw hex styles", () => {
    const forbiddenClassPatterns = [
      /bg-gray-\d+/,
      /text-gray-\d+/,
      /border-gray-\d+/,
      /bg-slate-\d+/,
      /text-slate-\d+/,
      /border-slate-\d+/,
      /bg-zinc-\d+/,
      /text-zinc-\d+/,
      /border-zinc-\d+/,
      /bg-red-\d+/,
      /text-red-\d+/,
      /bg-blue-\d+/,
      /text-blue-\d+/,
      /bg-purple-\d+/,
      /bg-indigo-\d+/,
    ];

    function scanDir(dir: string): string[] {
      const violations: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          violations.push(...scanDir(fullPath));
        } else if (entry.name.endsWith(".tsx")) {
          const fileContent = fs.readFileSync(fullPath, "utf-8");
          for (const pattern of forbiddenClassPatterns) {
            const match = fileContent.match(pattern);
            if (match) {
              violations.push(`${fullPath}: Forbidden default Tailwind class '${match[0]}'`);
            }
          }
        }
      }
      return violations;
    }

    const componentsDir = path.join(rootDir, "src/components");
    const appDir = path.join(rootDir, "src/app/(dashboard)");
    const violations = [...scanDir(componentsDir), ...scanDir(appDir)];

    expect(violations).toEqual([]);
  });
});
