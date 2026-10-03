// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoadmapItemView } from "../server/list-roadmap-items";

const fetchRoadmapItemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();
const createRoadmapItemMock = vi.fn();
const updateRoadmapItemMock = vi.fn();
vi.mock("../client/roadmap-gateway", () => ({
  fetchRoadmapItems: fetchRoadmapItemsMock,
  fetchAssignableMembers: fetchAssignableMembersMock,
  createRoadmapItem: createRoadmapItemMock,
  updateRoadmapItem: updateRoadmapItemMock,
}));

const { RoadmapPlanningScope } = await import("./RoadmapPlanning");
const { TeamSkillSection } = await import("../../skill-trees/components/TeamSkillSection");

afterEach(() => {
  cleanup();
  fetchRoadmapItemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
  createRoadmapItemMock.mockReset();
  updateRoadmapItemMock.mockReset();
});

const NODES = [
  { nodeId: "node-1", label: "Grunnleggende", order: 1 },
  { nodeId: "node-2", label: "Production rollout", order: 2 },
];

function plan(overrides: Partial<RoadmapItemView> = {}): RoadmapItemView {
  return {
    treeId: "tree-1",
    areaName: "Containers",
    targetNodeId: "node-2",
    targetLabel: "Production rollout",
    targetAvailable: true,
    tracking: { state: "tracked", currentNodeId: "node-1" },
    priority: "high",
    status: "active",
    startDate: "2026-09-01",
    targetDate: "2026-12-31",
    owner: null,
    overdue: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function untracked(overrides: Partial<RoadmapItemView> = {}): RoadmapItemView {
  return plan({
    treeId: "tree-old",
    areaName: "Gammelt område",
    tracking: { state: "not_tracked" },
    ...overrides,
  });
}

const ok = (items: RoadmapItemView[], canEdit = true) => ({ status: "ok", items, canEdit, truncated: false });
const MEMBERS = {
  status: "ok",
  members: [
    { memberRef: "ref-alex-1", displayName: "Alex", ordinal: 1, isSelf: false },
    { memberRef: "ref-bo", displayName: "Bo", ordinal: null, isSelf: true },
  ],
  unavailableCount: 0,
  truncated: false,
};

function Harness() {
  return (
    <RoadmapPlanningScope token="tok" teamId="team-1">
      {(planning) => (
        <div>
          {planning.controls}
          <div data-testid="rows">
            {planning.renderAreaPlan({ treeId: "tree-1", name: "Containers", currentNodeId: "node-1", nodes: NODES })}
          </div>
          <div data-testid="untracked">{planning.untracked}</div>
        </div>
      )}
    </RoadmapPlanningScope>
  );
}

const section = () => screen.findByRole("region", { name: "Plan for område teamet ikke lenger følger" });

async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  const region = await section();
  await user.click(within(region).getByRole("button", { name: /Rediger plan/ }));
  return within(region).findByRole("form", { name: /Rediger plan/ });
}

describe("untracked section", () => {
  it("shows only not_tracked plans, never duplicated in the tracked row, with no create affordance", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan(), untracked()]));
    render(<Harness />);
    const region = await section();
    expect(within(region).getByText("Gammelt område")).toBeTruthy();
    expect(within(region).getByText(/Teamet følger ikke lenger dette kompetanseområdet/)).toBeTruthy();
    expect(within(region).queryByRole("button", { name: /Planlegg/ })).toBeNull();
    const rows = screen.getByTestId("rows");
    expect(within(rows).queryByText("Gammelt område")).toBeNull();
    expect(within(rows).getByText("Production rollout")).toBeTruthy();
    expect(screen.getAllByText("Production rollout")).toHaveLength(2); // exactly one per plan
  });

  it("is absent when every plan is tracked (a missing row alone never makes a plan untracked)", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ treeId: "tree-other", areaName: null })]));
    render(<Harness />);
    await screen.findByText("Ingen plan ennå");
    expect(screen.queryByRole("region", { name: /ikke lenger følger/ })).toBeNull();
  });

  it("null areaName uses the neutral fallback and never exposes the treeId or node id", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked({ areaName: null, treeId: "tree-secret-id" })]));
    render(<Harness />);
    const region = await section();
    expect(within(region).getByText("Kompetanseområde uten tilgjengelig navn")).toBeTruthy();
    expect(document.body.textContent).not.toContain("tree-secret-id");
    expect(document.body.textContent).not.toContain("node-2");
  });

  it("unavailable target shows neutral text without a label", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked({ targetAvailable: false, targetLabel: null })]));
    render(<Harness />);
    const region = await section();
    expect(within(region).getByText("Målstadiet er ikke tilgjengelig")).toBeTruthy();
  });

  it("shows overdue but never a target-reached indicator", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked({ overdue: true })]));
    render(<Harness />);
    const region = await section();
    expect(within(region).getByText("Måldato passert")).toBeTruthy();
    expect(within(region).queryByText("Målet er nådd")).toBeNull();
  });

  it("canEdit false: read-only, no controls, no owner fetch", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked()], false));
    render(<Harness />);
    const region = await section();
    expect(within(region).queryByRole("button")).toBeNull();
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("archived plans are hidden by default and appear with 'Vis arkiverte' with restore only", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked({ archived: true })]));
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Ingen plan ennå");
    expect(screen.queryByRole("region", { name: /ikke lenger følger/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Vis arkiverte" }));
    const region = await section();
    expect(within(region).getByRole("button", { name: /Gjenopprett plan/ })).toBeTruthy();
    expect(within(region).queryByRole("button", { name: /Rediger plan/ })).toBeNull();
  });

  it("completed plans sit behind the 'Fullførte' toggle", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked({ status: "completed" })]));
    const user = userEvent.setup();
    render(<Harness />);
    const region = await section();
    expect(within(region).queryByText("Høy")).toBeNull();
    expect(within(region).queryByRole("button", { name: /Rediger plan/ })).toBeNull();
    await user.click(within(region).getByRole("button", { name: "Fullførte" }));
    expect(within(region).getByText("Høy")).toBeTruthy();
  });
});

describe("editing an untracked plan", () => {
  it("has no target select and omits targetNodeId from the PATCH", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked()]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    expect(within(form).queryByLabelText("Målstadium")).toBeNull();
    expect(within(form).getByText(/Målstadiet kan ikke endres/)).toBeTruthy();

    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.selectOptions(within(form).getByLabelText("Status"), "completed");
    await user.clear(within(form).getByLabelText("Startdato"));
    await user.selectOptions(within(form).getByLabelText("Ansvarlig"), "ref-alex-1");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    await waitFor(() => expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", "tree-old", {
      priority: "low",
      status: "completed",
      startDate: null,
      ownerRef: "ref-alex-1",
    });
    await waitFor(() => expect(fetchRoadmapItemsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("preserves an unavailable owner when untouched and clears an owner explicitly", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked({ owner: { state: "unavailable" } })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    let form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "medium");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1));
    expect(updateRoadmapItemMock.mock.calls[0][3]).toEqual({ priority: "medium" });
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1);

    form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Ansvarlig"), "");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(updateRoadmapItemMock).toHaveBeenCalledTimes(2));
    expect(updateRoadmapItemMock.mock.calls[1][3]).toEqual({ ownerRef: null });
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1);
  });

  it("archive sends exactly { archived: true }", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked()]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    await user.click(within(form).getByRole("button", { name: "Arkiver" }));
    await waitFor(() => expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1));
    expect(updateRoadmapItemMock.mock.calls[0][3]).toEqual({ archived: true });
  });

  it("restore sends exactly { archived: false } and refreshes", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked({ archived: true })]));
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText("Ingen plan ennå");
    await user.click(screen.getByRole("button", { name: "Vis arkiverte" }));
    const region = await section();
    const before = fetchRoadmapItemsMock.mock.calls.length;
    await user.click(within(region).getByRole("button", { name: /Gjenopprett plan/ }));
    await waitFor(() => expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1));
    expect(updateRoadmapItemMock.mock.calls[0][3]).toEqual({ archived: false });
    await waitFor(() => expect(fetchRoadmapItemsMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("invalid_owner keeps the form with a mapped error and reloads owners; no automatic retry", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked()]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "invalid_owner" });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Ansvarlig"), "ref-bo");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await within(form).findByText(/kan ikke velges lenger/)).toBeTruthy();
    expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(2));
  });

  it("successful write with a failed refresh is reported separately", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([untracked()])).mockResolvedValue({ status: "error" });
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await screen.findByText(/Endringen er lagret, men siste planstatus/)).toBeTruthy();
    expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1);
  });

  it("request_failed shows the ambiguity message without retrying the write", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([untracked()]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "request_failed" });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await within(form).findByText(/Endringen kan være lagret/)).toBeTruthy();
    expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1);
  });

  it("renders hostile names as inert text and never the memberRef", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      ok([
        untracked({
          areaName: "<img src=x onerror=alert(1)>",
          owner: { state: "current", memberRef: "ref-secret", displayName: "<b>x</b>", ordinal: null, isSelf: false },
        }),
      ]),
    );
    render(<Harness />);
    const region = await section();
    expect(region.querySelector("img")).toBeNull();
    expect(region.querySelector("b")).toBeNull();
    expect(document.body.textContent).not.toContain("ref-secret");
  });
});

describe("tracking restart", () => {
  it("moves the plan from the untracked section to its area row after the canonical refetch", async () => {
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([untracked({ treeId: "tree-1" })]))
      .mockResolvedValue(ok([plan({ priority: "low" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /ikke lenger følger/ })).toBeNull());
    expect(within(screen.getByTestId("rows")).getByText("Lav")).toBeTruthy();
  });
});

describe("archived untracked plan with zero tracked areas (TeamSkillSection integration)", () => {

  function SectionHarness() {
    return (
      <RoadmapPlanningScope token="tok" teamId="team-1">
        {(planning) => (
          <TeamSkillSection
            idToken="tok"
            teamId="team-1"
            state={{ status: "loaded", skills: [], canReportProgress: true }}
            onReported={() => {}}
            planning={planning}
          />
        )}
      </RoadmapPlanningScope>
    );
  }

  function mockServer(canEdit: boolean) {
    const archivedPlan = untracked({ archived: true });
    fetchRoadmapItemsMock.mockImplementation(async (_t: string, _team: string, opts?: { includeArchived?: boolean }) =>
      ok(opts?.includeArchived ? [archivedPlan] : [], canEdit),
    );
  }

  it("makes 'Vis arkiverte' reachable, shows the archived plan once and offers restore only", async () => {
    mockServer(true);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SectionHarness />);
    const toggle = await screen.findByRole("button", { name: "Vis arkiverte" });
    expect(screen.queryByText("Gammelt område")).toBeNull();
    await user.click(toggle);
    const region = await section();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledWith("tok", "team-1", { includeArchived: true });
    expect(screen.getAllByText("Gammelt område")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Vis arkiverte|Skjul arkiverte/ })).toHaveLength(1);
    expect(within(region).queryByRole("button", { name: /Planlegg/ })).toBeNull();
    expect(within(region).queryByRole("button", { name: /Rediger plan/ })).toBeNull();

    const before = fetchRoadmapItemsMock.mock.calls.length;
    await user.click(within(region).getByRole("button", { name: /Gjenopprett plan/ }));
    await waitFor(() => expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1));
    expect(updateRoadmapItemMock.mock.calls[0][3]).toEqual({ archived: false });
    await waitFor(() => expect(fetchRoadmapItemsMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("canEdit false: archived plan is visible but has no mutation controls", async () => {
    mockServer(false);
    const user = userEvent.setup();
    render(<SectionHarness />);
    await user.click(await screen.findByRole("button", { name: "Vis arkiverte" }));
    const region = await section();
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("with no plans at all the toggle is harmless and shows nothing", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    const user = userEvent.setup();
    render(<SectionHarness />);
    await user.click(await screen.findByRole("button", { name: "Vis arkiverte" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Skjul arkiverte" })).toBeTruthy());
    expect(screen.queryByRole("region", { name: /ikke lenger følger/ })).toBeNull();
  });
});
