import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Measures contrast from the implemented token file (app/globals.css), not
 * from the candidate values in the SPEC. These are measured contrast ratios
 * against thresholds, not a WCAG conformance claim for any page.
 */

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

type ThemeName = "light" | "dark";

const CSS = readFileSync(fileURLToPath(new URL("../../../app/globals.css", import.meta.url)), "utf8");

function readBlock(selector: string) {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Missing block ${selector}`);
  return CSS.slice(start, CSS.indexOf("}", start));
}

function readTokens(theme: ThemeName) {
  const block =
    theme === "light" ? readBlock(':root,\n[data-theme="light"]') : readBlock('[data-theme="dark"]');
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

function channelToLinear(value: number) {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrastRatio(foreground: string, background: string) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

type Pair = { foreground: string; background: string; kind: "text" | "non-text" };

// Every text and UI pair from the SPEC token contract and surfaces it can sit on.
const CONTRAST_PAIRS: Pair[] = [
  { foreground: "text-primary", background: "canvas", kind: "text" },
  { foreground: "text-primary", background: "surface", kind: "text" },
  { foreground: "text-primary", background: "surface-subtle", kind: "text" },
  { foreground: "text-primary", background: "surface-elevated", kind: "text" },
  { foreground: "text-primary", background: "primary-subtle", kind: "text" },
  { foreground: "text-secondary", background: "canvas", kind: "text" },
  { foreground: "text-secondary", background: "surface", kind: "text" },
  { foreground: "text-secondary", background: "surface-subtle", kind: "text" },
  { foreground: "text-muted", background: "canvas", kind: "text" },
  { foreground: "text-muted", background: "surface", kind: "text" },
  { foreground: "text-muted", background: "surface-subtle", kind: "text" },
  { foreground: "text-muted", background: "surface-elevated", kind: "text" },
  { foreground: "primary-text", background: "primary", kind: "text" },
  { foreground: "primary-text", background: "primary-hover", kind: "text" },
  { foreground: "primary", background: "canvas", kind: "text" },
  { foreground: "primary", background: "surface", kind: "text" },
  { foreground: "primary", background: "primary-subtle", kind: "text" },
  { foreground: "success-text", background: "surface", kind: "text" },
  { foreground: "success-text", background: "success-subtle", kind: "text" },
  { foreground: "warning-text", background: "surface", kind: "text" },
  { foreground: "warning-text", background: "warning-subtle", kind: "text" },
  { foreground: "danger-text", background: "surface", kind: "text" },
  { foreground: "danger-text", background: "danger-subtle", kind: "text" },
  { foreground: "info-text", background: "surface", kind: "text" },
  { foreground: "info-text", background: "info-subtle", kind: "text" },
  { foreground: "focus-ring", background: "surface", kind: "non-text" },
  { foreground: "focus-ring", background: "canvas", kind: "non-text" },
  { foreground: "border-strong", background: "surface", kind: "non-text" },
  { foreground: "border-strong", background: "canvas", kind: "non-text" },
  { foreground: "chart-1", background: "surface", kind: "non-text" },
  { foreground: "chart-2", background: "surface", kind: "non-text" },
  { foreground: "chart-3", background: "surface", kind: "non-text" },
  { foreground: "chart-4", background: "surface", kind: "non-text" },
  { foreground: "chart-5", background: "surface", kind: "non-text" },
  { foreground: "chart-6", background: "surface", kind: "non-text" },
];

const THEMES: ThemeName[] = ["light", "dark"];

describe("token contrast from the implemented file", () => {
  for (const theme of THEMES) {
    const tokens = readTokens(theme);

    it.each(CONTRAST_PAIRS.map((pair) => [pair.foreground, pair.background, pair.kind] as const))(
      `${theme}: %s on %s meets the ${TEXT_MIN}:1 text or ${NON_TEXT_MIN}:1 non-text threshold (%s)`,
      (foreground, background, kind) => {
        const ratio = contrastRatio(tokens[foreground], tokens[background]);
        const minimum = kind === "text" ? TEXT_MIN : NON_TEXT_MIN;
        expect(ratio, `${foreground} ${tokens[foreground]} on ${background} ${tokens[background]}`).toBeGreaterThanOrEqual(minimum);
      },
    );
  }
});

describe("contrast arithmetic", () => {
  it("gives 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  it("gives 1:1 for identical colours", () => {
    expect(contrastRatio("#7f7f7f", "#7f7f7f")).toBeCloseTo(1, 5);
  });
});
