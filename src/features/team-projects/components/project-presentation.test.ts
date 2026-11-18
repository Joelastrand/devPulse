import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROJECT_TONE_CLASSES, projectToneIndex } from "./project-presentation";

const CSS = readFileSync(fileURLToPath(new URL("../../../../app/globals.css", import.meta.url)), "utf8");

function timelineTokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  const end = CSS.indexOf("}", start);
  const block = CSS.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--timeline-(\d):\s*(#[0-9a-fA-F]{6});/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

/** Hue in degrees (0–360) of a #rrggbb colour. Brown and muddy gold sit roughly between 20° and 65°. */
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

describe("Timeline colour mapping (Prosjektplan and prosjektdeltakelse)", () => {
  it("maps every project tone to a timeline token, never to the chart tokens", () => {
    for (const tone of PROJECT_TONE_CLASSES) {
      expect(tone.bar).toMatch(/^bg-timeline-[1-6]$/);
      expect(tone.dot).toMatch(/^bg-timeline-[1-6]$/);
    }
  });

  it("derives a project's tone from its id, so sorting never recolours a project", () => {
    const index = projectToneIndex("project-a");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(PROJECT_TONE_CLASSES.length);
    expect(projectToneIndex("project-a")).toBe(index);
  });

  it.each(["light", "dark"] as const)("has no brown or muddy gold hue in the %s theme", (theme) => {
    const selector = theme === "light" ? '[data-theme="light"]' : '[data-theme="dark"]';
    const tokens = timelineTokens(selector);
    expect(Object.keys(tokens)).toHaveLength(6);
    for (const hex of Object.values(tokens)) {
      const hue = hueOf(hex);
      expect(hue < 20 || hue > 65, `${hex} has hue ${hue.toFixed(0)}°`).toBe(true);
    }
  });
});
