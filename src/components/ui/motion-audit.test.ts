import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Motion audit (docs/archive/features/product-experience/SPEC.md — Motion strategy). Only the SPEC
 * durations are used, every transition names one, nothing loops, and the one animation is the
 * drawer slide-in. The reduced-motion override lives in app/globals.css (design-tokens test).
 */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ALLOWED_DURATIONS = ["duration-micro", "duration-panel", "duration-progress"];
const ALLOWED_ANIMATIONS = ["animate-drawer-in"];

function listSource(dir: string, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== ".next") listSource(path, found);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

describe("motion audit", () => {
  const files = [...listSource(join(ROOT, "src")), ...listSource(join(ROOT, "app"))];
  const sources = files.map((file) => ({ file: relative(ROOT, file).split(sep).join("/"), text: readFileSync(file, "utf8") }));

  it("uses only the SPEC durations", () => {
    const found = new Set<string>();
    for (const { text } of sources) for (const match of text.matchAll(/\bduration-[a-z0-9]+\b/g)) found.add(match[0]);
    expect([...found].filter((name) => !ALLOWED_DURATIONS.includes(name))).toEqual([]);
  });

  it("pairs every colour transition with a named duration", () => {
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      text.split("\n").forEach((line) => {
        if (/\btransition-colors\b/.test(line) && !/\bduration-/.test(line)) offenders.push(`${file}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("uses no looping or constant animation", () => {
    const found = new Set<string>();
    for (const { text } of sources) {
      for (const match of text.matchAll(/\banimate-[a-z-]+\b/g)) found.add(match[0]);
      if (/\binfinite\b/.test(text)) found.add("infinite");
    }
    expect([...found].filter((name) => !ALLOWED_ANIMATIONS.includes(name))).toEqual([]);
  });
});
