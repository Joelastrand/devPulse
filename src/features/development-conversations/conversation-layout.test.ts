import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Split layout for the owner conversation detail (Product Experience TASK-033):
 * the context panel (participant state and shared goals) sits at `2xl` beside the
 * main conversation, and below `2xl` it stacks after the main content. Source check,
 * because the editor's props are too broad to render in a unit test.
 */
const source = readFileSync(
  fileURLToPath(new URL("./components/OwnerConversationEditor.tsx", import.meta.url)),
  "utf8",
);

describe("owner conversation split layout", () => {
  it("uses a two-column grid from 2xl and stacks below it", () => {
    expect(source).toContain("2xl:grid 2xl:grid-cols-[minmax(0,1fr)_20rem]");
  });

  it("places the context panel in an aside after the main column", () => {
    const main = source.indexOf("flex min-w-0 flex-col gap-6\">");
    const aside = source.indexOf("<aside");
    expect(main).toBeGreaterThan(-1);
    expect(aside).toBeGreaterThan(main);
    expect(source.slice(aside)).toContain("<GoalSnapshotSelector");
    expect(source.slice(aside)).toContain("<ParticipantPanel");
  });
});
