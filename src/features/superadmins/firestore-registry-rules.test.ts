import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Static check of the executable rules only. Client denial is also verified by the emulator suite, which is not run here
// (no Java runtime; see docs/archive/features/superadmin-registry/VERIFICATION.md).
function stripComments(rules: string): string {
  return rules.replace(/\/\/.*$/gm, "");
}

const rules = stripComments(readFileSync(fileURLToPath(new URL("../../../firestore.rules", import.meta.url)), "utf8"));

describe("Firestore rules — superadmin registry (client access denied)", () => {
  it.each(["superadmins", "superadminRegistry"])("denies every client read and write to %s", (collection) => {
    const block = new RegExp(`match\\s+/${collection}/\\{document=\\*\\*\\}\\s*\\{\\s*allow read, write: if false;\\s*\\}`);
    expect(rules).toMatch(block);
  });

  it("never grants any allow that names a registry collection", () => {
    for (const collection of ["superadmins", "superadminRegistry"]) {
      const allows = rules.match(new RegExp(`match\\s+/${collection}[\\s\\S]*?\\}\\s*\\}`, "g")) ?? [];
      for (const block of allows) {
        expect(block).not.toMatch(/allow[^;]*:\s*if\s+(?!false)/);
      }
    }
  });
});
