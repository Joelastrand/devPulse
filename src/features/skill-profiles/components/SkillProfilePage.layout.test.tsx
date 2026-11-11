// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { skillProfileCopy } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchOwnSkillsMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

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

function signedInWithOneSkill() {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchOwnSkillsMock.mockResolvedValue({
    status: "ok",
    dto: { skills: [{ treeId: "api", name: "API-design", level: 2 }], truncated: false, profile: "ok" },
  });
}

describe("SkillProfilePage assessment status and filter chips (TASK-009, ref 22)", () => {
  it("shows the assessed count in the summary card, with no separate status pill", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("a-token");
      return () => {};
    });
    fetchOwnSkillsMock.mockResolvedValue({
      status: "ok",
      dto: {
        skills: [
          { treeId: "api", name: "API-design", level: 2 },
          { treeId: "test", name: "Testing", level: null },
        ],
        truncated: false,
        profile: "ok",
      },
    });
    render(<SkillProfilePage />);

    const card = await screen.findByRole("region", { name: "Vurderte ferdigheter" });
    expect(card.textContent).toContain("1 av 2");
    expect(card.textContent).not.toMatch(/%/);
  });

  it("marks the selected filter option as a chip without relying on colour alone (checked radio)", async () => {
    signedInWithOneSkill();
    render(<SkillProfilePage />);
    await screen.findByText("API-design");

    const all = screen.getByRole("radio", { name: skillProfileCopy.filterAll });
    const unassessed = screen.getByRole("radio", { name: skillProfileCopy.filterUnassessed });
    expect((all as HTMLInputElement).checked).toBe(true);
    expect(all.closest("label")?.className).toContain("font-medium");
    expect(unassessed.closest("label")?.className).not.toContain("font-medium");
  });
});

describe("SkillProfilePage editing view layout (ref 07 redesign: editing is its own view)", () => {
  it("renders the single skill list in one column, with no side panel and no dashboard grid", async () => {
    signedInWithOneSkill();
    render(<SkillProfilePage />);
    await screen.findByText("API-design");

    const list = screen.getByRole("heading", { name: skillProfileCopy.skillsHeading });
    const section = list.closest("section");
    expect(section?.id).toBe("rediger");
    expect(section?.parentElement?.className).not.toContain("grid-cols");
    expect(document.querySelector("#rolle")).toBeNull();
  });
});
