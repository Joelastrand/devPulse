import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import allowList from "./raw-palette-allowlist.json";

/**
 * Raw colour guard (docs/features/product-experience/SPEC.md — Token
 * contract). Colour values belong in app/globals.css. Existing raw uses are
 * listed in raw-palette-allowlist.json and must shrink as surfaces migrate;
 * the list is compared exactly, so a stale count fails as well as a new one.
 * Test files are excluded because they hold fixtures.
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const PALETTE_CLASS =
  /\b(?:zinc|red|blue|green|emerald|amber|yellow|orange|rose|pink|purple|violet|indigo|sky|cyan|teal|lime|slate|gray|neutral|stone|fuchsia)-(?:50|100|200|300|400|500|600|700|800|900|950)\b|\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|placeholder|accent|shadow|decoration)-(?:white|black)\b/g;

function listSourceFiles(dir: string, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== ".next") listSourceFiles(path, found);
    } else {
      found.push(path);
    }
  }
  return found;
}

function countRawValues() {
  const files = [
    ...listSourceFiles(join(REPO_ROOT, "app")),
    ...listSourceFiles(join(REPO_ROOT, "src")),
  ].filter(
    (file) =>
      /\.(ts|tsx|css)$/.test(file) &&
      !/\.test\.(ts|tsx)$/.test(file) &&
      file !== join(REPO_ROOT, "app", "globals.css"),
  );
  const counts: Record<string, number> = {};
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const total = (text.match(HEX) ?? []).length + (text.match(PALETTE_CLASS) ?? []).length;
    if (total > 0) counts[relative(REPO_ROOT, file).split(sep).join("/")] = total;
  }
  return counts;
}

describe("raw colour allow-list", () => {
  const counts = countRawValues();
  const allowed: Record<string, number> = allowList;

  it("lists every file that still has raw colour values, with its exact count", () => {
    const actualFiles = Object.keys(counts).sort();
    const allowedFiles = Object.keys(allowed).sort();
    expect(actualFiles).toEqual(allowedFiles);
    for (const file of actualFiles) {
      expect(counts[file], file).toBe(allowed[file]);
    }
  });
});
