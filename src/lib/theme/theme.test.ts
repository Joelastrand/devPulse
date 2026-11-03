import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_CHOICE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  readThemeChoice,
  resolveTheme,
  writeThemeChoice,
} from "./theme";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

/**
 * Runs the inline first-paint script against a fake document, so the script
 * and resolveTheme are tested against the same matrix of inputs.
 */
function runInitScript(options: {
  storedValue?: string | null;
  storageThrows?: boolean;
  prefersDark?: boolean;
  matchMediaThrows?: boolean;
}) {
  const accessedKeys: string[] = [];
  const writes: string[] = [];
  const attributes = new Map<string, string>([["data-theme", "light"]]);
  const storage = {
    getItem: (key: string) => {
      accessedKeys.push(key);
      if (options.storageThrows) throw new Error("SecurityError");
      return options.storedValue ?? null;
    },
    setItem: (key: string) => {
      writes.push(key);
      throw new Error("write must not be called by the init script");
    },
  };
  const fakeWindow = {
    localStorage: storage,
    matchMedia: (query: string) => {
      if (options.matchMediaThrows) throw new Error("no matchMedia");
      expect(query).toBe("(prefers-color-scheme: dark)");
      return { matches: options.prefersDark ?? false };
    },
  };
  const fakeDocument = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
    },
  };
  new Function("window", "document", THEME_INIT_SCRIPT)(fakeWindow, fakeDocument);
  return {
    theme: attributes.get("data-theme"),
    accessedKeys,
    writes,
  };
}

describe("theme choice", () => {
  it("defaults to lys when nothing is stored", () => {
    expect(readThemeChoice(memoryStorage())).toBe("lys");
    expect(DEFAULT_THEME_CHOICE).toBe("lys");
  });

  it("reads one of the three stored choices", () => {
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: "mork" }))).toBe("mork");
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: "folg" }))).toBe("folg");
  });

  it("ignores unknown stored values and falls back to lys", () => {
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("lys");
    expect(readThemeChoice(memoryStorage({ [THEME_STORAGE_KEY]: "" }))).toBe("lys");
  });

  it("falls back to lys when storage read throws", () => {
    expect(readThemeChoice(throwingStorage)).toBe("lys");
  });

  it("falls back to lys when no storage exists", () => {
    expect(readThemeChoice(null)).toBe("lys");
    expect(readThemeChoice(undefined)).toBe("lys");
  });

  it("writes the choice under the single theme key", () => {
    const storage = memoryStorage();
    expect(writeThemeChoice(storage, "folg")).toBe(true);
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe("folg");
    expect(storage.values.size).toBe(1);
  });

  it("reports a failed write without throwing", () => {
    expect(writeThemeChoice(throwingStorage, "mork")).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("keeps light for lys whatever the operating-system preference is", () => {
    expect(resolveTheme("lys", false)).toBe("light");
    expect(resolveTheme("lys", true)).toBe("light");
  });

  it("gives dark for an explicit mork choice whatever the operating system prefers", () => {
    expect(resolveTheme("mork", false)).toBe("dark");
    expect(resolveTheme("mork", true)).toBe("dark");
  });

  it("follows an OS dark preference only when folg is explicitly chosen", () => {
    expect(resolveTheme("folg", true)).toBe("dark");
    expect(resolveTheme("folg", false)).toBe("light");
  });
});

describe("inline first-paint script", () => {
  it("keeps light with no stored choice even when the OS prefers dark", () => {
    expect(runInitScript({ prefersDark: true }).theme).toBe("light");
  });

  it("applies dark for a stored mork choice", () => {
    expect(runInitScript({ storedValue: "mork", prefersDark: false }).theme).toBe("dark");
  });

  it("applies dark for folg with an OS dark preference", () => {
    expect(runInitScript({ storedValue: "folg", prefersDark: true }).theme).toBe("dark");
  });

  it("applies light for folg with an OS light preference", () => {
    expect(runInitScript({ storedValue: "folg", prefersDark: false }).theme).toBe("light");
  });

  it("falls back to light when storage access throws", () => {
    expect(runInitScript({ storageThrows: true, prefersDark: true }).theme).toBe("light");
  });

  it("falls back to light when matchMedia throws for folg", () => {
    expect(runInitScript({ storedValue: "folg", matchMediaThrows: true }).theme).toBe("light");
  });

  it("ignores unknown stored values", () => {
    expect(runInitScript({ storedValue: "dark", prefersDark: true }).theme).toBe("light");
  });

  it("reads and writes only the theme key", () => {
    const result = runInitScript({ storedValue: "mork" });
    expect(result.accessedKeys).toEqual([THEME_STORAGE_KEY]);
    expect(result.writes).toEqual([]);
  });

  it("makes no network call", () => {
    expect(THEME_INIT_SCRIPT).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|navigator\.|import\(/);
  });
});

describe("theme module privacy", () => {
  it("contains no telemetry or network code", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./theme.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/\bfetch\(|sendBeacon|XMLHttpRequest|analytics\.|track\(/);
  });
});
