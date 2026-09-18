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

  it("denies all client-SDK access to surveys unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/surveys\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("denies all client-SDK access to teamSurveyState unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/teamSurveyState\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("denies all client-SDK access to surveyResponses unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/surveyResponses\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("denies all client-SDK access to surveyParticipations unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/surveyParticipations\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("denies all client-SDK access to challenges unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/challenges\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("denies all client-SDK access to skillTrees unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/skillTrees\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("denies all client-SDK access to skillProgress unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/skillProgress\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("has no unconditional allow anywhere in the rules file (denies by default)", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).not.toMatch(/allow\s+(?:read|write|read\s*,\s*write)\s*:\s*if\s+true/);
  });

  it("declares no composite index for skillTrees — listSkillTrees's single-field orderBy+limit is auto-indexed", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }>;
    };

    const skillTreesIndexes = indexes.indexes.filter((index) => index.collectionGroup === "skillTrees");
    expect(skillTreesIndexes).toHaveLength(0);
  });

  it("declares no composite index for skillProgress — every start/update/stop/read operation is a direct document or single-field-filter operation", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }>;
    };

    const skillProgressIndexes = indexes.indexes.filter((index) => index.collectionGroup === "skillProgress");
    expect(skillProgressIndexes).toHaveLength(0);
  });
});
