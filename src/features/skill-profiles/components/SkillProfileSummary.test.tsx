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

async function renderWithSkills(skills: { treeId: string; name: string; level: 1 | 2 | 3 | 4 | null }[]) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchOwnSkillsMock.mockResolvedValue({ status: "ok", dto: { skills, truncated: false, profile: "ok" } });
  render(<SkillProfilePage />);
  await screen.findByText(skillProfileCopy.privacyNotice);
}

const assessedCard = () => screen.getByRole("region", { name: "Vurderte ferdigheter" });
const assessedCardText = () => assessedCard().textContent ?? "";

describe("Ferdigheter private completion summary (TASK-030)", () => {
  it("leads the page with the summary, before both privacy notices", async () => {
    await renderWithSkills([
      { treeId: "t-a", name: "Arkitektur", level: 2 },
      { treeId: "t-b", name: "Testing", level: null },
    ]);

    const summary = assessedCard();
    const privacy = screen.getByText(skillProfileCopy.privacyNotice);
    const roleNotice = screen.getByText(skillProfileCopy.roleComparisonNotice);
    expect(summary.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(privacy.compareDocumentPosition(roleNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("states a count that matches the rendered skill list", async () => {
    await renderWithSkills([
      { treeId: "t-a", name: "Arkitektur", level: 1 },
      { treeId: "t-b", name: "Testing", level: 4 },
      { treeId: "t-c", name: "Drift", level: null },
    ]);

    expect(assessedCardText()).toContain("2 av 3");
    expect(screen.getAllByRole("listitem").filter((item) => item.textContent?.includes("Drift"))).toHaveLength(1);
  });

  it("uses no percentage, score, points or ranking wording in the summary", async () => {
    await renderWithSkills([
      { treeId: "t-a", name: "Arkitektur", level: 3 },
      { treeId: "t-b", name: "Testing", level: null },
    ]);

    const summary = assessedCardText();
    expect(summary).not.toMatch(/%|poeng|score|rangering|ranking/i);
  });
});
