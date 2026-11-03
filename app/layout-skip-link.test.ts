import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("skip link on every layout", () => {
  it("is the first child of body in the root layout", () => {
    const layout = read("./layout.tsx");
    const body = layout.slice(layout.indexOf("<body"));
    expect(body.indexOf("<SkipLink")).toBeLessThan(body.indexOf("{children}"));
  });

  it.each([
    ["./(public)/layout.tsx"],
    ["../src/components/nav/AppShell.tsx"],
    ["./(survey)/layout.tsx"],
  ])("gives the main content region the target id in %s", (path) => {
    expect(read(path)).toContain("SKIP_LINK_TARGET_ID");
  });
});

describe("admin scope marker", () => {
  it.each([
    ["./(app)/admin/roles/page.tsx"],
    ["./(app)/admin/skills/page.tsx"],
    ["./(app)/admin/teams/page.tsx"],
  ])("%s renders the Administrasjon eyebrow through PageHeader", (path) => {
    expect(read(path)).toContain("eyebrow={ADMIN_SCOPE_EYEBROW}");
  });

  it("the admin team detail header carries the same eyebrow", () => {
    expect(read("../src/features/teams/components/AdminTeamDetail.tsx")).toContain("eyebrow={ADMIN_SCOPE_EYEBROW}");
  });
});
