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

  it("denies all client-SDK access to forumThreads unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/forumThreads\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("denies all client-SDK access to forumReplies unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/forumReplies\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
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

  it("denies all client-SDK access to roadmapItems unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/roadmapItems\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("declares no composite index for roadmapItems — every access is a direct document operation or a single-field equality filter", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string }>;
    };

    expect(indexes.indexes.filter((index) => index.collectionGroup === "roadmapItems")).toHaveLength(0);
  });

  it("denies all client-SDK access to userProfiles unconditionally", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).toMatch(
      /match\s+\/userProfiles\/\{document=\*\*\}\s*\{\s*allow read, write: if false;/,
    );
  });

  it("declares no composite index for userProfiles — every access is a direct document operation by uid", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string }>;
    };

    expect(indexes.indexes.filter((index) => index.collectionGroup === "userProfiles")).toHaveLength(0);
  });

  it("denies all client-SDK access to skillProfiles unconditionally, with an explicit block before the catch-all", () => {
    const rules = readRepoFile("firestore.rules");

    const explicit = rules.match(
      /match\s+\/skillProfiles\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/,
    );
    expect(explicit).not.toBeNull();

    const catchAllIndex = rules.search(/match\s+\/\{document=\*\*\}\s*\{/);
    expect(catchAllIndex).toBeGreaterThan(-1);
    expect(explicit?.index).toBeLessThan(catchAllIndex);

    // Rules are OR-ed: no other allow may mention skillProfiles or grant owner access.
    const blockBody = explicit?.[0] ?? "";
    expect(blockBody.match(/allow\s/g)).toHaveLength(1);
    expect(blockBody).not.toMatch(/request\.auth|resource\.|uid|if\s+true/);
  });

  it("declares no composite index for skillProfiles — every access is a direct document operation by uid", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string }>;
    };

    expect(indexes.indexes.filter((index) => index.collectionGroup === "skillProfiles")).toHaveLength(0);
  });

  it("denies all client-SDK access to teamSkillNeeds unconditionally, with an explicit block before the catch-all", () => {
    const rules = readRepoFile("firestore.rules");

    const explicit = rules.match(
      /match\s+\/teamSkillNeeds\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/,
    );
    expect(explicit).not.toBeNull();

    const catchAllIndex = rules.search(/match\s+\/\{document=\*\*\}\s*\{/);
    expect(catchAllIndex).toBeGreaterThan(-1);
    expect(explicit?.index).toBeLessThan(catchAllIndex);

    // Rules are OR-ed: this is the only match path for teamSkillNeeds, and it grants nothing.
    expect(rules.match(/match\s+\/teamSkillNeeds\//g)).toHaveLength(1);
    const blockBody = explicit?.[0] ?? "";
    expect(blockBody.match(/allow\s/g)).toHaveLength(1);
    expect(blockBody).not.toMatch(/request\.auth|resource\.|uid|if\s+true/);
  });

  it("declares no composite index for teamSkillNeeds — the needs query is a single-field teamId equality filter", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string }>;
    };

    expect(indexes.indexes.filter((index) => index.collectionGroup === "teamSkillNeeds")).toHaveLength(0);
  });

  it("has no unconditional allow anywhere in the rules file (denies by default)", () => {
    const rules = readRepoFile("firestore.rules");

    expect(rules).not.toMatch(/allow\s+(?:read|write|read\s*,\s*write)\s*:\s*if\s+true/);
  });

  it("declares exactly the forumThreads composite index listTeamThreads's query shape requires (teamId ascending, createdAt descending)", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }>;
    };

    const forumThreadsIndexes = indexes.indexes.filter((index) => index.collectionGroup === "forumThreads");
    expect(forumThreadsIndexes).toHaveLength(1);
    expect(forumThreadsIndexes[0].fields).toEqual([
      { fieldPath: "teamId", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ]);
  });

  it("declares exactly the forumReplies composite index getThreadWithReplies's query shape requires (threadId ascending, createdAt ascending)", () => {
    const indexes = JSON.parse(readRepoFile("firestore.indexes.json")) as {
      indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }>;
    };

    const forumRepliesIndexes = indexes.indexes.filter((index) => index.collectionGroup === "forumReplies");
    expect(forumRepliesIndexes).toHaveLength(1);
    expect(forumRepliesIndexes[0].fields).toEqual([
      { fieldPath: "threadId", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "ASCENDING" },
    ]);
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
