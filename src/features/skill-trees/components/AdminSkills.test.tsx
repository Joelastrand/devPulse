// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const observeIdTokenMock = vi.fn();
const fetchAdminSkillTreesMock = vi.fn();
const createAdminSkillTreeMock = vi.fn();
const correctAdminSkillTreeMock = vi.fn();
const fetchOrgSkillProgressOverviewMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/skill-trees-gateway", () => ({
  fetchAdminSkillTrees: fetchAdminSkillTreesMock,
  createAdminSkillTree: createAdminSkillTreeMock,
  correctAdminSkillTree: correctAdminSkillTreeMock,
  fetchOrgSkillProgressOverview: fetchOrgSkillProgressOverviewMock,
}));

const { AdminSkills } = await import("./AdminSkills");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

describe("AdminSkills", () => {
  beforeEach(() => {
    // Harmless default for tests that don't care about the overview section
    // — individual tests override this where the overview result matters.
    fetchOrgSkillProgressOverviewMock.mockResolvedValue({ status: "ok", trees: [] });
  });

  afterEach(() => {
    cleanup();
    observeIdTokenMock.mockReset();
    fetchAdminSkillTreesMock.mockReset();
    createAdminSkillTreeMock.mockReset();
    correctAdminSkillTreeMock.mockReset();
    fetchOrgSkillProgressOverviewMock.mockReset();
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
    // Exact text: the overview's own empty-state copy ("...spores av noe
    // team ennå.") shares the "Ingen kompetanseområder" prefix, so a loose
    // match would now be ambiguous with the new sibling section present.
    await screen.findByText("Ingen kompetanseområder ennå.");

    expect(fetchAdminSkillTreesMock).toHaveBeenCalledTimes(1);
  });

  it("wires the cross-team overview through fetchOrgSkillProgressOverview, alongside the existing catalog", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminSkillTreesMock.mockResolvedValue({
      status: "ok",
      trees: [{ treeId: "tree-1", name: "Containere", nodes: [] }],
    });
    fetchOrgSkillProgressOverviewMock.mockResolvedValue({
      status: "ok",
      trees: [
        {
          treeId: "tree-1",
          name: "Containere",
          nodes: [{ nodeId: "node-0", label: "Fundamentals", order: 0 }],
          teams: [{ teamId: "team-1", teamName: "Alpha", teamStatus: "active", currentNodeId: "node-0" }],
        },
      ],
    });

    render(<AdminSkills />);

    await screen.findByText(/sporing på tvers av team/i);
    expect(screen.getByText("Alpha", { exact: false })).toBeTruthy();
    expect(fetchOrgSkillProgressOverviewMock).toHaveBeenCalledWith("a-token");
    // The existing catalog/creation form remain present alongside it.
    expect(screen.getByLabelText(/navn på kompetanseområdet/i)).toBeTruthy();
  });

  it("isolates an overview read failure from the existing catalog/creation form", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminSkillTreesMock.mockResolvedValue({
      status: "ok",
      trees: [{ treeId: "tree-1", name: "Containere", nodes: [] }],
    });
    fetchOrgSkillProgressOverviewMock.mockResolvedValue({ status: "read_failed" });

    render(<AdminSkills />);

    await screen.findByText("Containere");
    expect(screen.getByLabelText(/navn på kompetanseområdet/i)).toBeTruthy();
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((alert) => /noe gikk galt/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("does not re-fetch the overview when the catalog is refreshed after a creation", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchAdminSkillTreesMock.mockResolvedValue({ status: "ok", trees: [] });
    fetchOrgSkillProgressOverviewMock.mockResolvedValue({ status: "ok", trees: [] });

    render(<AdminSkills />);
    await screen.findByText("Ingen kompetanseområder ennå.");

    expect(fetchOrgSkillProgressOverviewMock).toHaveBeenCalledTimes(1);
  });
});
