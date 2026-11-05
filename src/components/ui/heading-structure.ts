import { expect } from "vitest";

/**
 * Test helper (visual-redesign TASK-019): checks the structure of a rendered route or composition.
 *
 * Headings: reads the DOM subtree a user can reach. Counts native `h1`-`h6` and elements with `role="heading"`
 * (level from `aria-level`, default 2). Skips `aria-hidden="true"` and `hidden`-attribute subtrees. It does not skip
 * the CSS `hidden` class, because jsdom does not apply Tailwind and responsive variants such as `hidden lg:flex` are
 * visible at larger widths.
 *
 * Rules: a route that owns its page title has exactly one visible level-1 heading, and it is the first heading. A
 * composed view that does not own the title (`ownsPageTitle: false`) has NO visible level-1 heading, so the route's
 * page title stays the only h1. Heading levels never jump down by more than one level (WCAG 1.3.1 and 2.4.6).
 *
 * Landmarks: `expectMainLandmark` requires exactly one `main` (or `role="main"`) landmark.
 */
export function visibleHeadingLevels(root: ParentNode): number[] {
  return Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']"))
    .filter((heading) => !heading.closest('[aria-hidden="true"], [hidden]'))
    .map((heading) => {
      const explicit = heading.getAttribute("aria-level");
      if (explicit !== null) return Number(explicit);
      if (/^H[1-6]$/.test(heading.tagName)) return Number(heading.tagName.charAt(1));
      return 2;
    });
}

export function expectHeadingStructure(root: ParentNode, options: { ownsPageTitle: boolean }): void {
  const levels = visibleHeadingLevels(root);
  if (options.ownsPageTitle) {
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
  } else {
    expect(levels.filter((level) => level === 1), "a composed view must not add a second level-1 heading").toHaveLength(0);
  }
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1] ?? 1;
    const current = levels[index] ?? 1;
    expect(current, `heading level jumps from h${previous} to h${current}`).toBeLessThanOrEqual(previous + 1);
  }
}

export function expectMainLandmark(root: ParentNode): void {
  expect(root.querySelectorAll('main, [role="main"]')).toHaveLength(1);
}

/**
 * Every visible button and link (and every `role="button"` or `role="link"`) must have an accessible name: text, an
 * `aria-label`, `aria-labelledby`, or a `title`. Icon-only controls are only valid with one of these names.
 */
export function expectNamedControls(root: ParentNode): void {
  const controls = Array.from(root.querySelectorAll("button, a[href], [role='button'], [role='link']")).filter(
    (control) => !control.closest('[aria-hidden="true"], [hidden]'),
  );
  const unnamed = controls.filter((control) => {
    const label = control.getAttribute("aria-label")?.trim() || control.getAttribute("aria-labelledby") || control.getAttribute("title");
    const text = control.textContent?.trim() ?? "";
    return !label && text.length === 0;
  });
  expect(unnamed.map((control) => control.outerHTML.slice(0, 120)), "controls without an accessible name").toEqual([]);
}
