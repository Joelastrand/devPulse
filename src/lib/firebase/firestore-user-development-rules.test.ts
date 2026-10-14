import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  const path = fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));
  return readFileSync(path, "utf8");
}

// Rules text without comments, so assertions inspect only executable rules.
function stripComments(rules: string): string {
  return rules.replace(/\/\/.*$/gm, "");
}

describe("Firestore rules — userDevelopment (D1 personal goals, BR-44, SI-9)", () => {
  const rules = stripComments(readRepoFile("firestore.rules"));
  const explicitBlock = /match\s+\/userDevelopment\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/;
  const catchAllBlock = /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/;

  it("has an explicit deny-only recursive block covering the parent path, goals and every descendant", () => {
    expect(rules.match(explicitBlock)).not.toBeNull();
  });

  it("places the explicit block before the catch-all, and keeps exactly one unchanged deny-only catch-all", () => {
    const explicitIndex = rules.search(explicitBlock);
    const catchAllIndex = rules.search(/match\s+\/\{document=\*\*\}\s*\{/);

    expect(explicitIndex).toBeGreaterThan(-1);
    expect(catchAllIndex).toBeGreaterThan(explicitIndex);
    expect(rules.match(/match\s+\/\{document=\*\*\}/g)).toHaveLength(1);
    expect(rules.match(catchAllBlock)).not.toBeNull();
  });

  it("is the only match path naming userDevelopment, so no overlapping rule can OR in an allow", () => {
    expect(rules.match(/userDevelopment/g)).toHaveLength(1);
    expect(rules.match(/match\s+\/userDevelopment\b/g)).toHaveLength(1);
  });

  it("contains a single allow in the block and no owner, admin, auth, resource or nested-match condition", () => {
    const body = rules.match(explicitBlock)?.[0] ?? "";

    expect(body.match(/allow\s/g)).toHaveLength(1);
    expect(body.match(/match\s/g)).toHaveLength(1);
    expect(body).not.toMatch(/request\.|resource\.|uid|auth|admin|true|get\(|exists\(/);
  });

  it("has no allow in the whole rules file other than `if false`", () => {
    const allows = rules.match(/allow\s[^;]*;/g) ?? [];

    expect(allows.length).toBeGreaterThan(0);
    for (const allow of allows) {
      expect(allow).toBe("allow read, write: if false;");
    }
  });

  it("has no write-scoped or request.auth condition anywhere that could shadow the deny via a wildcard", () => {
    expect(rules).not.toMatch(/request\.auth/);
    expect(rules).not.toMatch(/match\s+\/\{[a-zA-Z]+\}/);
  });

  it("pins rules_version and keeps firebase.json pointing at the rules and indexes files", () => {
    const raw = readRepoFile("firestore.rules");
    const firebaseJson = JSON.parse(readRepoFile("firebase.json")) as {
      firestore?: { rules?: string; indexes?: string };
    };

    expect(raw).toMatch(/^rules_version = '2';/);
    expect(firebaseJson.firestore?.rules).toBe("firestore.rules");
    expect(firebaseJson.firestore?.indexes).toBe("firestore.indexes.json");
  });

  it("declares no composite index mentioning userDevelopment (BR-45)", () => {
    expect(readRepoFile("firestore.indexes.json")).not.toMatch(/userDevelopment/);
  });
});
