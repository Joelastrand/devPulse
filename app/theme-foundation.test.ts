import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SPEC_TOKENS = [
  "canvas",
  "surface",
  "surface-subtle",
  "surface-elevated",
  "text-primary",
  "text-secondary",
  "text-muted",
  "border-subtle",
  "border-strong",
  "primary",
  "primary-text",
  "primary-hover",
  "primary-subtle",
  "success-text",
  "success-subtle",
  "warning-text",
  "warning-subtle",
  "danger-text",
  "danger-subtle",
  "info-text",
  "info-subtle",
  "focus-ring",
];

function readRepoFile(path: string) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

function blockFor(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block exists`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("theme token file", () => {
  const css = readRepoFile("app/globals.css");

  it.each(["light", "dark"])("defines every SPEC token in the %s theme", (theme) => {
    const block =
      theme === "light" ? blockFor(css, ":root,\n[data-theme=\"light\"]") : blockFor(css, '[data-theme="dark"]');
    for (const token of SPEC_TOKENS) {
      expect(block, `${theme} defines --${token}`).toMatch(new RegExp(`--${token}:\\s*#[0-9a-f]{6};`));
    }
  });

  it("exposes every token to Tailwind through @theme inline", () => {
    for (const token of SPEC_TOKENS) {
      expect(css).toContain(`--color-${token}: var(--${token});`);
    }
  });

  it("binds the dark variant to the explicit data-theme attribute, not the OS query", () => {
    expect(css).toContain('@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));');
    expect(css).not.toContain("prefers-color-scheme");
  });
});

describe("root layout first paint", () => {
  const layout = readRepoFile("app/layout.tsx");

  it("renders the initial HTML with data-theme light", () => {
    expect(layout).toMatch(/<html[\s\S]*data-theme="light"/);
  });

  it("runs the theme script before the body is parsed", () => {
    expect(layout.indexOf("THEME_INIT_SCRIPT")).toBeLessThan(layout.indexOf("<body"));
  });
});
