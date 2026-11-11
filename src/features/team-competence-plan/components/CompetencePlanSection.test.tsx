// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
});
import type { CompetencePlanPageData } from "../client/use-competence-plans";

const hook = vi.hoisted(() => ({
  data: { phase: "loading" } as unknown,
  save: vi.fn(),
  saveMilestoneCompletion: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("../client/use-competence-plans", () => ({
  useCompetencePlans: () => ({
    data: hook.data,
    save: hook.save,
    saveMilestoneCompletion: hook.saveMilestoneCompletion,
    reload: hook.reload,
  }),
}));

import { CompetencePlanSection } from "./CompetencePlanSection";

const TREE_B = "tree-testing";
const TREE_C = "tree-observability";
const MS_DONE = "11111111-1111-4111-8111-111111111111";
const MS_OPEN = "22222222-2222-4222-8222-222222222222";

function loaded(overrides: Partial<Extract<CompetencePlanPageData, { phase: "loaded" }>> = {}): CompetencePlanPageData {
  return {
    phase: "loaded",
    canEdit: false,
    truncated: false,
    legacyItems: [],
    legacyFailed: false,
    areas: [
      { treeId: TREE_B, name: "Testautomatisering", status: "active" },
      { treeId: TREE_C, name: "Observerbarhet", status: "active" },
    ],
    plans: [
      {
        treeId: TREE_B,
        targetStage: 3,
        priority: "high",
        archived: false,
        progress: { completed: 1, total: 2 },
        milestones: [
          { id: MS_DONE, title: "Dekning i hovedflyt", targetDate: "2026-12-01", status: "completed" },
          { id: MS_OPEN, title: "Ende-til-ende-tester", targetDate: null, status: "in_progress" },
        ],
      },
    ],
    ...overrides,
  };
}

const okResult = { status: "ok" as const, plan: null };

describe("CompetencePlanSection", () => {
  beforeEach(() => {
    hook.save.mockReset();
    hook.saveMilestoneCompletion.mockReset();
    hook.reload.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a loading state while the plan is being read", () => {
    hook.data = { phase: "loading" };
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByRole("status").textContent).toContain("Laster kompetanseplanen");
  });

  it("shows a forbidden error without a retry action", () => {
    hook.data = { phase: "error", reason: "forbidden" };
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByRole("alert").textContent).toContain("Du har ikke tilgang");
    expect(screen.queryByRole("button", { name: "Prøv igjen" })).toBeNull();
  });

  it("offers a retry after a failed read and calls reload", async () => {
    hook.data = { phase: "error", reason: "read_failed" };
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(hook.reload).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state for a team without plans, and no editing for a member", () => {
    hook.data = loaded({ plans: [], canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByText("Ingen kompetanseplaner ennå."));
    expect(screen.queryByRole("button", { name: "Ny kompetanseplan" })).toBeNull();
  });

  it("shows plan progress as completed steps out of the total, with the target stage label", () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" />);
    const card = within(screen.getByRole("list", { name: "Detaljer og tiltak" })).getByRole("listitem");
    expect(within(card).getByRole("heading", { name: "Testautomatisering" }));
    expect(within(card).getByText("1 av 2 steg"));
    expect(within(card).getByText("Mål: Kan selvstendig"));
    expect(within(card).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });

  it("reveals milestone steps with their status text when a card is expanded", async () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Vis steg: Testautomatisering" }));
    const checklist = screen.getByRole("list", { name: "Målsjekkliste" });
    expect(within(checklist).getByText("Ende-til-ende-tester")).toBeTruthy();
    expect(within(checklist).getByText("Pågår")).toBeTruthy();
    expect(within(checklist).getByText("Fullført")).toBeTruthy();
  });

  it("shows members the step status read-only, with no completion controls", async () => {
    hook.data = loaded({ canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Vis steg: Testautomatisering" }));
    expect(screen.queryByRole("button", { name: /Merk fullført|Gjenåpne/ })).toBeNull();
    expect(screen.getByText("Bare teamleder kan krysse av steg.")).toBeTruthy();
  });

  it("gives a lead an edit action and a picker for assigned areas without a plan", async () => {
    hook.data = loaded({ canEdit: true });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByRole("button", { name: "Rediger plan: Testautomatisering" }));
    await userEvent.click(screen.getByRole("button", { name: "Ny kompetanseplan" }));
    const picker = screen.getByLabelText("Kompetanseområde");
    expect(within(picker).getByRole("option", { name: "Observerbarhet" }));
    expect(within(picker).queryByRole("option", { name: "Testautomatisering" })).toBeNull();
  });

  it("states that the plan is advisory and that only a lead can edit it, for members", () => {
    hook.data = loaded({ canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByText("Bare teamleder kan endre kompetanseplanen. Planen er veiledende."));
  });
});

describe("CompetencePlanSection removed duplicates and navigation", () => {
  it("no longer shows the roadmap competence steps or the team needs table on this page", () => {
    hook.data = loaded({ canEdit: true });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.queryByRole("region", { name: "Eksisterende kompetansesteg" })).toBeNull();
    expect(screen.queryByText("Kompetansebehov og dekning")).toBeNull();
  });

  it("links to Teamkompetanse and Roadmap rather than repeating their content", () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.getByRole("link", { name: "Gå til Teamkompetanse" }).getAttribute("href")).toBe("/teams/team-1/competence");
    expect(screen.getByRole("link", { name: "Gå til Roadmap" }).getAttribute("href")).toBe("/teams/team-1/roadmap");
  });

  it("encodes the team id in the navigation links", () => {
    hook.data = loaded();
    render(<CompetencePlanSection teamId="team/with space" />);
    expect(screen.getByRole("link", { name: "Gå til Roadmap" }).getAttribute("href")).toBe("/teams/team%2Fwith%20space/roadmap");
  });
});

describe("CompetencePlanSection milestone completion (team admin)", () => {
  function completeButton(title: string): HTMLElement {
    return screen.getByRole("button", { name: new RegExp(`^(Merk fullført|Gjenåpne): ${title}`) });
  }

  beforeEach(async () => {
    hook.data = loaded({ canEdit: true });
  });

  it("completes an open step inside its card through the save operation", async () => {
    hook.saveMilestoneCompletion.mockResolvedValue(okResult);
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Vis steg: Testautomatisering" }));
    await userEvent.click(completeButton("Ende-til-ende-tester"));
    expect(hook.saveMilestoneCompletion).toHaveBeenCalledWith(TREE_B, MS_OPEN, true);
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("reopens a completed step", async () => {
    hook.saveMilestoneCompletion.mockResolvedValue(okResult);
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Vis steg: Testautomatisering" }));
    await userEvent.click(completeButton("Dekning i hovedflyt"));
    expect(hook.saveMilestoneCompletion).toHaveBeenCalledWith(TREE_B, MS_DONE, false);
  });

  it("shows an error and does not report success when the save is refused", async () => {
    hook.saveMilestoneCompletion.mockResolvedValue({ status: "write_failed" });
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Vis steg: Testautomatisering" }));
    await userEvent.click(completeButton("Ende-til-ende-tester"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("blocks a second submission while a save is in flight", async () => {
    let finish: (value: typeof okResult) => void = () => undefined;
    hook.saveMilestoneCompletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<CompetencePlanSection teamId="team-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Vis steg: Testautomatisering" }));
    await userEvent.click(completeButton("Ende-til-ende-tester"));
    expect((completeButton("Dekning i hovedflyt") as HTMLButtonElement).disabled).toBe(true);
    expect(hook.saveMilestoneCompletion).toHaveBeenCalledTimes(1);
    finish(okResult);
  });
});

describe("Neste steg navigation", () => {
  it("expands the plan card a next step belongs to", async () => {
    hook.data = loaded({ canEdit: false });
    render(<CompetencePlanSection teamId="team-1" />);
    expect(screen.queryByRole("list", { name: "Målsjekkliste" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Vis plan for Testautomatisering, steg: Ende-til-ende-tester" }));
    expect(screen.getByRole("list", { name: "Målsjekkliste" })).toBeTruthy();
  });
});
