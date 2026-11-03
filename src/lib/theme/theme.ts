/**
 * Viewer theme preference (docs/features/product-experience/SPEC.md — Theme
 * strategy). One local key holds one of three values. It is a viewer
 * convenience only: it is never sent to a server, never linked to identity
 * and never produces telemetry.
 */
export const THEME_STORAGE_KEY = "devpulse.theme";

export const THEME_CHOICES = ["lys", "mork", "folg"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export type ResolvedTheme = "light" | "dark";

// Light is the default for every operating-system setting.
export const DEFAULT_THEME_CHOICE: ThemeChoice = "lys";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

export function readThemeChoice(storage: ThemeStorage | null | undefined): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(value) ? value : DEFAULT_THEME_CHOICE;
  } catch {
    // Storage can throw (blocked site data, private windows). Light applies.
    return DEFAULT_THEME_CHOICE;
  }
}

export function writeThemeChoice(storage: ThemeStorage, choice: ThemeChoice): boolean {
  try {
    storage.setItem(THEME_STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "mork") return "dark";
  // The OS preference is honoured only after an explicit folg choice.
  if (choice === "folg" && prefersDark) return "dark";
  return "light";
}

/**
 * Inline script run before first paint from the root layout. It mirrors
 * readThemeChoice and resolveTheme, which is why src/lib/theme/theme.test.ts
 * evaluates this exact string. Keep the two in step. Every access is wrapped,
 * and the script reads and writes only THEME_STORAGE_KEY.
 */
export const THEME_INIT_SCRIPT = `(function () {
  var theme = "light";
  try {
    var stored = null;
    try { stored = window.localStorage.getItem("${THEME_STORAGE_KEY}"); } catch (e) {}
    var prefersDark = false;
    try { prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    if (stored === "mork" || (stored === "folg" && prefersDark)) theme = "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();`;
