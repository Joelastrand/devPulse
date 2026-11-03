import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Exactly three illustrations, each in its allowed state only (SPEC: Illustration strategy):
 * goals empty, conversations empty and survey completion. Scans the application source.
 */
const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const NAMES = ["GoalsIllustration", "ConversationsIllustration", "CompletionIllustration"];

function listSource(dir: string, found: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== ".next") listSource(path, found);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      found.push(path);
    }
  }
  return found;
}

describe("illustration usage", () => {
  it("uses each illustration only in its allowed state", () => {
    const files = [...listSource(join(ROOT, "src")), ...listSource(join(ROOT, "app"))];
    const uses: Record<string, string[]> = {};
    for (const name of NAMES) uses[name] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const name of NAMES) {
        if (new RegExp(`<${name}\\b`).test(text)) uses[name].push(relative(ROOT, file).split(sep).join("/"));
      }
    }
    expect(uses.GoalsIllustration).toEqual(["src/features/personal-goals/components/GoalsPage.tsx"]);
    expect(uses.ConversationsIllustration).toEqual(["src/features/development-conversations/components/ConversationsPage.tsx"]);
    expect(uses.CompletionIllustration).toEqual(["src/features/surveys/components/SurveyResponseForm.tsx"]);
  });
});
