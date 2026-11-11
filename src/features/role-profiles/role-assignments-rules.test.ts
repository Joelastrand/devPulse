import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static check of `firestore.rules` for `roleAssignments/{uid}` (role-profiles SPEC, "Formal role assignment"). The
 * collection is server-only through the Admin SDK, so the rule must be an explicit deny and must not be widened.
 */
const RULES = readFileSync(join(process.cwd(), "firestore.rules"), "utf8");

describe("firestore.rules: roleAssignments is server-only", () => {
  const header = "match /roleAssignments/{document=**} {";

  it("declares the collection exactly once", () => {
    expect(RULES.split(header)).toHaveLength(2);
  });

  it("denies every client read and write, with no condition", () => {
    const start = RULES.indexOf(header) + header.length;
    const block = RULES.slice(start, RULES.indexOf("}", start));
    expect(block.replace(/\s+/g, " ").trim()).toBe("allow read, write: if false;");
  });

  it("keeps the default-deny catch-all after the assignment rule", () => {
    expect(RULES.indexOf("match /{document=**} {")).toBeGreaterThan(RULES.indexOf(header));
    const catchAll = RULES.slice(RULES.indexOf("match /{document=**} {"));
    expect(catchAll).toMatch(/allow read, write: if false;/);
  });

  it("grants no allow rule that mentions role assignments", () => {
    const allows = RULES.split("\n").filter((line) => /allow/.test(line) && !/if false/.test(line));
    expect(allows.filter((line) => /roleAssignments|role-assignment/i.test(line))).toEqual([]);
  });
});
