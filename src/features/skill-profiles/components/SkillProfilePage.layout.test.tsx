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

function gridOf(element: HTMLElement): HTMLElement {
  const grid = element.closest("div.grid");
  if (!(grid instanceof HTMLElement)) throw new Error("expected the panel to sit in the three-panel grid");
  return grid;
}

describe("SkillProfilePage three-panel layout (TASK-012)", () => {
  it("lays the legend, competency list and side panel in one lg three-column grid, in that order", async () => {
    signedInWithOneSkill();
    render(<SkillProfilePage sidePanel={<section aria-label="Sidepanel-test">Rolleforventninger-test</section>} />);
    await screen.findByText("API-design");

    const legend = screen.getByRole("heading", { name: skillProfileCopy.legendHeading });
    const list = screen.getByRole("heading", { name: skillProfileCopy.skillsHeading });
    const side = screen.getByLabelText("Sidepanel-test");
    const grid = gridOf(legend);

    expect(gridOf(list)).toBe(grid);
    expect(gridOf(side)).toBe(grid);
    expect(grid.className).toContain("xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]");
    expect(grid.children.length).toBe(3);
    const following = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(following(legend, list)).toBe(true);
    expect(following(list, side)).toBe(true);
  });

  it("keeps the same grid with two panels when no side panel is passed, so no empty column is rendered as content", async () => {
    signedInWithOneSkill();
    render(<SkillProfilePage />);
    await screen.findByText("API-design");

    const grid = gridOf(screen.getByRole("heading", { name: skillProfileCopy.legendHeading }));

    expect(grid.children.length).toBe(2);
    expect(grid.className).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]");
    expect(grid.className).not.toContain("minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)");
    expect(screen.queryByLabelText("Sidepanel-test")).toBeNull();
  });
});
