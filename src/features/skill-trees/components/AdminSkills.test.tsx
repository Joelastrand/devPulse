// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const observeIdTokenMock = vi.fn();
const fetchAdminSkillTreesMock = vi.fn();
const createAdminSkillTreeMock = vi.fn();
const correctAdminSkillTreeMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/skill-trees-gateway", () => ({
  fetchAdminSkillTrees: fetchAdminSkillTreesMock,
  createAdminSkillTree: createAdminSkillTreeMock,
  correctAdminSkillTree: correctAdminSkillTreeMock,
}));

const { AdminSkills } = await import("./AdminSkills");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

describe("AdminSkills", () => {
  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminSkillTreesMock.mockReset();
    createAdminSkillTreeMock.mockReset();
    correctAdminSkillTreeMock.mockReset();
  });

  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<AdminSkills />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("prompts sign-in when the visitor is signed out, and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<AdminSkills />);

    await screen.findByRole("link", { name: /logg inn/i });
    expect(fetchAdminSkillTreesMock).not.toHaveBeenCalled();
  });

  it("shows a generic forbidden message for an authenticated non-admin", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "forbidden" });

    render(<AdminSkills />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ikke tilgang/i);
  });

  it("renders the creation form and catalog once loaded for an admin", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminSkillTreesMock.mockResolvedValue({
      status: "ok",
      trees: [{ treeId: "tree-1", name: "Containere", nodes: [] }],
    });

    render(<AdminSkills />);

    await screen.findByText("Containere");
    expect(screen.getByLabelText(/navn på kompetanseområdet/i)).toBeTruthy();
  });

  it("refreshes the catalog after a successful creation", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminSkillTreesMock
      .mockResolvedValueOnce({ status: "ok", trees: [] })
      .mockResolvedValueOnce({
        status: "ok",
        trees: [{ treeId: "tree-1", name: "Containere", nodes: [] }],
      });

    render(<AdminSkills />);
    await screen.findByText(/ingen kompetanseområder/i);

    expect(fetchAdminSkillTreesMock).toHaveBeenCalledTimes(1);
  });
});
