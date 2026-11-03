import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const OTHER_ICON_PACKAGE =
  /(react-icons|@heroicons|@phosphor-icons|@tabler|@fortawesome|feather-icons|lucide-(?!react)|material-symbols|@mui\/icons)/;

function listFiles(dir: string, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== ".next") listFiles(path, found);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

describe("icon dependency", () => {
  const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = { ...packageJson.dependencies, ...packageJson.devDependencies };

  it("pins lucide-react to an exact version without a range", () => {
    expect(declared["lucide-react"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("declares no other icon package", () => {
    const others = Object.keys(declared).filter((name) => OTHER_ICON_PACKAGE.test(name));
    expect(others).toEqual([]);
  });

  it("imports icons only from lucide-react in application code", () => {
    const offenders = listFiles(join(REPO_ROOT, "src"))
      .concat(listFiles(join(REPO_ROOT, "app")))
      .filter((file) => OTHER_ICON_PACKAGE.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
