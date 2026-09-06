import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  const path = fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));
  return readFileSync(path, "utf8");
}

describe("Firestore deployment configuration", () => {
  it("wires firebase.json to both the Firestore rules and composite indexes files", () => {
    const firebaseJson = JSON.parse(readRepoFile("firebase.json")) as {
      firestore?: { rules?: string; indexes?: string };
    };

    expect(firebaseJson.firestore?.rules).toBe("firestore.rules");
    expect(firebaseJson.firestore?.indexes).toBe("firestore.indexes.json");
  });

  it("denies all client-SDK access to pulseSurveyResponses unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/pulseSurveyResponses\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("has no unconditional allow anywhere in the rules file (denies by default)", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).not.toMatch(/allow\s+(?:read|write|read\s*,\s*write)\s*:\s*if\s+true/);
  });
});
