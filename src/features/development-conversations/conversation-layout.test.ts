import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Owner conversation detail layout (Phase 1 personal-experience redesign). The detail is one readable column at every
 * width: the former 2xl split with a context aside is gone, and participants and shared goals sit in their own tab.
 * Source check, because the editor's props are too broad to render in a unit test.
 */
const editorSource = readFileSync(
  fileURLToPath(new URL("./components/OwnerConversationEditor.tsx", import.meta.url)),
  "utf8",
);
const overviewSource = readFileSync(
  fileURLToPath(new URL("./components/ConversationsPage.tsx", import.meta.url)),
  "utf8",
);

describe("owner conversation detail layout", () => {
  it("renders no split grid and no side aside at any width", () => {
    expect(editorSource).not.toContain("2xl:grid");
    expect(editorSource).not.toContain("<aside");
  });

  it("groups participant and shared-goal controls in their own tab, in the agreed section order", () => {
    const ids = [...editorSource.matchAll(/id: "([a-z-]+)",/g)].map((match) => match[1]);
    expect(ids).toEqual(["overview", "notes", "participants", "follow-up"]);
    const participantsTab = editorSource.indexOf('id: "participants"');
    expect(editorSource.slice(participantsTab)).toContain("<ParticipantPanel");
    expect(editorSource.slice(participantsTab)).toContain("<GoalSnapshotSelector");
  });

  it("does not render the participant or goal controls outside the participants tab", () => {
    const overviewTab = editorSource.indexOf('id: "overview"');
    const participantsTab = editorSource.indexOf('id: "participants"');
    const beforeParticipants = editorSource.slice(overviewTab, participantsTab);
    expect(beforeParticipants).not.toContain("<ParticipantPanel");
    expect(beforeParticipants).not.toContain("<GoalSnapshotSelector");
  });
});

describe("conversation overview layout", () => {
  it("has no split pane, no selection state and no nested scroll region", () => {
    expect(overviewSource).not.toContain("useWideConversationPane");
    expect(overviewSource).not.toContain("conversation-detail-pane");
    expect(overviewSource).not.toContain("xl:max-h");
    expect(overviewSource).not.toContain("overflow-y-auto");
  });
});
