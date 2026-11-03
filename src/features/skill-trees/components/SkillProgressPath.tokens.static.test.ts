import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("SkillProgressPath uses design tokens (TASK-041)", () => {
  it("contains no raw Tailwind palette classes", () => {
    const source = readFileSync(fileURLToPath(new URL("./SkillProgressPath.tsx", import.meta.url)), "utf8");
    expect(source).not.toMatch(/\b(zinc|red|blue|green|amber|gray|slate)-\d{2,3}\b/);
  });
});
