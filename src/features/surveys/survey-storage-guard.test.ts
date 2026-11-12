import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Answers are held in memory only (docs/archive/features/product-experience/SPEC.md —
 * Interruption and recovery). No storage API of any kind may appear in the
 * survey feature or the survey route group.
 */
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const STORAGE_API = /localStorage|sessionStorage|indexedDB|document\.cookie|cookieStore/;

function listSources(dir: string, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      listSources(path, found);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

describe("survey storage guard", () => {
  it("contains no storage API in the survey feature or the survey route group", () => {
    const files = [
      ...listSources(join(ROOT, "src", "features", "surveys")),
      ...listSources(join(ROOT, "app", "(survey)")),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((file) => STORAGE_API.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
