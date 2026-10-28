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

describe("Firestore rules — roleDefinitions (role profiles, BR-1, AD-1)", () => {
  const rules = stripComments(readRepoFile("firestore.rules"));
  const explicitBlock = /match\s+\/roleDefinitions\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/;
  const catchAllBlock = /match\s+\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/;

  it("has an explicit deny-only recursive block for roleDefinitions", () => {
    expect(rules.match(explicitBlock)).not.toBeNull();
  });

  it("places the explicit block before the catch-all and keeps exactly one catch-all", () => {
    const explicitIndex = rules.search(explicitBlock);
    const catchAllIndex = rules.search(/match\s+\/\{document=\*\*\}\s*\{/);

    expect(explicitIndex).toBeGreaterThan(-1);
    expect(catchAllIndex).toBeGreaterThan(explicitIndex);
    expect(rules.match(/match\s+\/\{document=\*\*\}/g)).toHaveLength(1);
    expect(rules.match(catchAllBlock)).not.toBeNull();
  });

  it("names roleDefinitions in exactly one match path, so no overlapping rule can OR in an allow", () => {
    expect(rules.match(/roleDefinitions/g)).toHaveLength(1);
  });

  it("contains a single deny-only allow in the block", () => {
    const body = rules.match(explicitBlock)?.[0] ?? "";

    expect(body.match(/allow\s/g)).toHaveLength(1);
    expect(body).not.toMatch(/request\.|resource\.|uid|auth|admin|true|get\(|exists\(/);
  });
});
