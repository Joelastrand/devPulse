// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { skillProfileCopy } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchOwnSkillsMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../client/skill-profile-gateway", () => ({
  fetchOwnSkills: fetchOwnSkillsMock,
  setOwnSkillLevel: vi.fn(),
  clearOwnSkillLevel: vi.fn(),
  deleteOwnSkillProfile: vi.fn(),
}));

const { SkillProfilePage } = await import("./SkillProfilePage");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SKILLS = [
  { treeId: "t1", name: "API-design", level: 3 as const },
  { treeId: "t2", name: "Testing", level: null },
  { treeId: "t3", name: "Arkitektur", level: 1 as const },
];

async function renderSkills() {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchOwnSkillsMock.mockResolvedValue({
    status: "ok",
    dto: { skills: SKILLS, truncated: false, profile: "ok" },
  });
  const user = userEvent.setup();
  render(<SkillProfilePage />);
  await screen.findByText("API-design");
  return user;
}

/** The skill list is the one inside the personal section, so team or other lists never leak into these assertions. */
function personalRows() {
  const panel = document.getElementById("personal-skills-panel")!;
  return within(panel)
    .queryAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent ?? "");
}

describe("SkillProfilePage: search over personal skills", () => {
  it("matches skill names case-insensitively, ignoring surrounding whitespace", async () => {
    const user = await renderSkills();

    await user.type(screen.getByRole("searchbox", { name: skillProfileCopy.searchLabel }), "  ARK  ");

    expect(personalRows()).toEqual(["Arkitektur"]);
  });

  it("updates the result count to the shown and total numbers of the dataset", async () => {
    const user = await renderSkills();

    expect(screen.getByText(skillProfileCopy.resultCount(3, 3)).textContent).toBe(skillProfileCopy.resultCount(3, 3));
    await user.type(screen.getByRole("searchbox", { name: skillProfileCopy.searchLabel }), "a");

    expect(screen.getByText(skillProfileCopy.resultCount(2, 3)).textContent).toBe(skillProfileCopy.resultCount(2, 3));
  });

  it("shows the search no-results message, not the filter message, when nothing matches the query", async () => {
    const user = await renderSkills();

    await user.type(screen.getByRole("searchbox", { name: skillProfileCopy.searchLabel }), "zzz");

    expect(screen.getByText(skillProfileCopy.noSearchMatches)).toBeTruthy();
    expect(screen.queryByText(skillProfileCopy.noFilterMatches)).toBeNull();
  });

  it("composes with the assessment-status filter: only unassessed skills matching the query are shown", async () => {
    const user = await renderSkills();

    await user.click(screen.getByRole("radio", { name: skillProfileCopy.filterUnassessed }));
    await user.type(screen.getByRole("searchbox", { name: skillProfileCopy.searchLabel }), "a");

    // "Testing" is the only unassessed skill and has no "a", so nothing is left.
    expect(personalRows()).toEqual([]);
    expect(screen.getByText(skillProfileCopy.noSearchMatches)).toBeTruthy();
  });

  it("clears the query with the clear button and restores the full list", async () => {
    const user = await renderSkills();
    const search = screen.getByRole("searchbox", { name: skillProfileCopy.searchLabel });

    await user.type(search, "Test");
    expect(personalRows()).toEqual(["Testing"]);

    await user.click(screen.getByRole("button", { name: skillProfileCopy.searchClear }));

    expect(search).toHaveProperty("value", "");
    expect(personalRows()).toEqual(["API-design", "Testing", "Arkitektur"]);
  });
});
