import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static checks for the non-colour token set and the global focus and motion
 * rules (docs/features/product-experience/SPEC.md — Typography, Spacing,
 * radii, borders, elevation, Focus, Motion strategy).
 */

const CSS = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

function block(selector: string) {
  const start = CSS.indexOf(selector);
  expect(start, `${selector} exists`).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("\n}", start) + 2);
}

describe("spacing, radii, elevation and motion tokens", () => {
  const themeBlock = block("@theme {");

  it.each([
    ["radius for inputs and badges", "--radius-field: 6px;"],
    ["radius for buttons, cards and panels", "--radius-control: 10px;"],
    ["radius for drawer, dialog and survey card", "--radius-surface: 14px;"],
    ["level-2 elevation shadow", "--shadow-elevated:"],
    ["micro-interaction duration 120 ms", "--duration-micro: 120ms;"],
    ["panel and drawer duration 200 ms", "--duration-panel: 200ms;"],
    ["progress duration 300 ms", "--duration-progress: 300ms;"],
    ["standard easing", "--ease-standard: cubic-bezier(0.2, 0, 0, 1);"],
  ])("defines the %s", (_label, declaration) => {
    expect(themeBlock).toContain(declaration);
  });

  it.each([
    ["eyebrow", "--text-eyebrow: 13px;", "--text-eyebrow--line-height: 18px;"],
    ["page title", "--text-page-title: 28px;", "--text-page-title--line-height: 34px;"],
    ["page description", "--text-page-description: 15px;", "--text-page-description--line-height: 24px;"],
    ["section title", "--text-section-title: 18px;", "--text-section-title--line-height: 26px;"],
    ["panel title", "--text-panel-title: 15px;", "--text-panel-title--line-height: 22px;"],
    ["metric", "--text-metric: 32px;", "--text-metric--line-height: 36px;"],
    ["body", "--text-body: 15px;", "--text-body--line-height: 24px;"],
    ["secondary body", "--text-body-secondary: 14px;", "--text-body-secondary--line-height: 22px;"],
    ["label", "--text-label: 14px;", "--text-label--line-height: 20px;"],
    ["help text", "--text-help: 13px;", "--text-help--line-height: 20px;"],
    ["survey question", "--text-survey-question: 20px;", "--text-survey-question--line-height: 28px;"],
    ["survey body", "--text-survey-body: 17px;", "--text-survey-body--line-height: 26px;"],
  ])("defines the %s typography role", (_label, size, lineHeight) => {
    expect(themeBlock).toContain(size);
    expect(themeBlock).toContain(lineHeight);
  });
});

describe("focus rule", () => {
  it("draws a 2 px focus ring with 2 px offset on :focus-visible", () => {
    const rule = block(":focus-visible {");
    expect(rule).toContain("outline: 2px solid var(--focus-ring);");
    expect(rule).toContain("outline-offset: 2px;");
  });
});

describe("reduced-motion rule", () => {
  it("disables transitions and animations under prefers-reduced-motion: reduce", () => {
    const rule = block("@media (prefers-reduced-motion: reduce) {");
    expect(rule).toContain("transition: none !important;");
    expect(rule).toContain("animation: none !important;");
    expect(rule).toContain("scroll-behavior: auto !important;");
  });
});
