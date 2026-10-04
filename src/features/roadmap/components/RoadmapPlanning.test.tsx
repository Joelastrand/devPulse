// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RoadmapItemView } from "../server/list-roadmap-items";

const fetchRoadmapItemsMock = vi.fn();
vi.mock("../client/roadmap-gateway", () => ({ fetchRoadmapItems: fetchRoadmapItemsMock }));

const { RoadmapPlanningScope } = await import("./RoadmapPlanning");
const { RoadmapPlanSummary } = await import("./RoadmapPlanSummary");

afterEach(() => {
  cleanup();
  fetchRoadmapItemsMock.mockReset();
});

const NODES = [
  { nodeId: "node-1", label: "Grunnleggende", order: 1 },
  { nodeId: "node-2", label: "Production rollout", order: 2 },
  { nodeId: "node-3", label: "Ekspert", order: 3 },
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
    completedAt: null,
    ...overrides,
  };
}

function ok(items: RoadmapItemView[]) {
  return { status: "ok", items, canEdit: true, truncated: false };
}

function Harness() {
  return (
    <RoadmapPlanningScope token="tok" teamId="team-1">
      {(planning) => (
        <div>
          {planning.controls}
          <ul>
            {planning
              .orderAreas([
                { treeId: "tree-1", name: "Containers" },
                { treeId: "tree-2", name: "Alpha" },
                { treeId: "tree-3", name: "Beta" },
              ])
              .map((area) => (
                <li key={area.treeId} aria-label={area.name}>
                  {area.name}
                  {planning.renderAreaPlan({ ...area, currentNodeId: "node-1", nodes: NODES })}
                </li>
              ))}
          </ul>
        </div>
      )}
    </RoadmapPlanningScope>
  );
}

describe("RoadmapPlanSummary", () => {
  it("maps priority/status to Norwegian copy and shows target and period", () => {
    render(<RoadmapPlanSummary plan={plan({ priority: "medium", status: "planned" })} />);
    expect(screen.getByText("Middels")).toBeTruthy();
    expect(screen.getByText("Planlagt")).toBeTruthy();
    expect(screen.getByText("Production rollout")).toBeTruthy();
    expect(screen.getByText("01.09.2026 – 31.12.2026")).toBeTruthy();
    expect(screen.queryByText("high")).toBeNull();
  });

  it("renders partial and missing periods", () => {
    const { rerender } = render(<RoadmapPlanSummary plan={plan({ targetDate: null })} />);
    expect(screen.getByText("Fra 01.09.2026")).toBeTruthy();
    rerender(<RoadmapPlanSummary plan={plan({ startDate: null })} />);
    expect(screen.getByText("Til 31.12.2026")).toBeTruthy();
    rerender(<RoadmapPlanSummary plan={plan({ startDate: null, targetDate: null })} />);
    expect(screen.getByText("Ikke satt")).toBeTruthy();
  });

  it("renders every owner state without leaking the memberRef", () => {
    const { rerender, container } = render(<RoadmapPlanSummary plan={plan()} />);
    expect(screen.getByText("Ikke tildelt")).toBeTruthy();

    rerender(
      <RoadmapPlanSummary
        plan={plan({ owner: { state: "current", memberRef: "secret-ref", displayName: "Alex", ordinal: 2, isSelf: true } })}
      />,
    );
    expect(screen.getByText("Alex (2) · Deg")).toBeTruthy();
    expect(container.innerHTML).not.toContain("secret-ref");

    rerender(
      <RoadmapPlanSummary
        plan={plan({ owner: { state: "current", memberRef: "r", displayName: null, ordinal: null, isSelf: false } })}
      />,
    );
    expect(screen.getByText("Medlem uten navn")).toBeTruthy();

    rerender(<RoadmapPlanSummary plan={plan({ owner: { state: "unavailable" } })} />);
    expect(screen.getByText("Ansvarlig er ikke lenger tilgjengelig")).toBeTruthy();
  });

  it("shows neutral unavailable-target text and never the raw node id", () => {
    const { container } = render(
      <RoadmapPlanSummary plan={plan({ targetAvailable: false, targetLabel: null, targetNodeId: "node-raw-id" })} />,
    );
    expect(screen.getByText("Målstadiet er ikke tilgjengelig")).toBeTruthy();
    expect(container.innerHTML).not.toContain("node-raw-id");
  });

  it("shows 'Målet er nådd' only for targetReached true (absent and false show nothing)", () => {
    const { rerender } = render(<RoadmapPlanSummary plan={plan({ targetReached: true })} />);
    expect(screen.getByText("Målet er nådd")).toBeTruthy();
    expect(screen.getByText(/markere planen som fullført/i)).toBeTruthy();
    rerender(<RoadmapPlanSummary plan={plan({ targetReached: false })} />);
    expect(screen.queryByText("Målet er nådd")).toBeNull();
    rerender(<RoadmapPlanSummary plan={plan()} />);
    expect(screen.queryByText("Målet er nådd")).toBeNull();
  });

  it("shows overdue as text, independently of an unavailable target and tracking", () => {
    render(
      <RoadmapPlanSummary
        plan={plan({ overdue: true, targetAvailable: false, targetLabel: null, tracking: { state: "not_tracked" } })}
      />,
    );
    expect(screen.getByText("Måldato passert")).toBeTruthy();
  });

  it("renders hostile names as inert text", () => {
    const { container } = render(
      <RoadmapPlanSummary
        plan={plan({
          targetLabel: "<img src=x onerror=alert(1)>",
          owner: { state: "current", memberRef: "r", displayName: "<b>x</b>", ordinal: null, isSelf: false },
        })}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>x</b>")).toBeTruthy();
  });

  it("has no edit controls", () => {
    render(<RoadmapPlanSummary plan={plan({ targetReached: true, overdue: true })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("RoadmapPlanningScope", () => {
  it("shows a loading state, then plans matched by treeId and 'Ingen plan ennå' for the rest", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ treeId: "tree-3", areaName: "Containers", priority: "low" })]));

    render(<Harness />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);

    expect(await screen.findByText("Lav")).toBeTruthy();
    expect(screen.getAllByText("Ingen plan ennå")).toHaveLength(2);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledWith("tok", "team-1");
    // Beta (tree-3) holds the plan and sorts first; the rest by nb name.
    const rows = screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"));
    expect(rows).toEqual(["Beta", "Alpha", "Containers"]);
  });

  it("shows an error per row on failure without throwing, and no toggle", async () => {
    fetchRoadmapItemsMock.mockResolvedValue({ status: "read_failed" });

    render(<Harness />);

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBe(3));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Ingen plan ennå")).toBeNull();
  });

  it("ignores plans of untracked areas", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ treeId: "tree-gone", tracking: { state: "not_tracked" } })]));

    render(<Harness />);

    await waitFor(() => expect(screen.getAllByText("Ingen plan ennå")).toHaveLength(3));
  });

  it("hides archived plans by default and fetches them only on 'Vis arkiverte'", async () => {
    const archived = plan({ treeId: "tree-2", archived: true, priority: "low" });
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([archived]));
    const user = userEvent.setup();

    render(<Harness />);
    await screen.findByRole("button", { name: "Vis arkiverte" });
    expect(screen.queryByText("Arkivert")).toBeNull();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Vis arkiverte" }));
    expect(await screen.findByText("Arkivert")).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("tok", "team-1", { includeArchived: true });

    await user.click(screen.getByRole("button", { name: "Skjul arkiverte" }));
    expect(screen.queryByText("Arkivert")).toBeNull();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("shows an archived-load error without losing the normal plans", async () => {
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([plan({ treeId: "tree-2", priority: "low" })]))
      .mockResolvedValueOnce({ status: "read_failed" });
    const user = userEvent.setup();

    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Vis arkiverte" }));

    expect(await screen.findByText("Arkiverte planer kunne ikke lastes.")).toBeTruthy();
    expect(screen.getByText("Lav")).toBeTruthy();
  });

  it("keeps completed plans behind a 'Fullførte' toggle", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ treeId: "tree-2", status: "completed", priority: "low" })]));
    const user = userEvent.setup();

    render(<Harness />);
    const toggle = await screen.findByRole("button", { name: "Fullførte" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Lav")).toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Lav")).toBeTruthy();
  });

  it("canEdit false: no create/edit controls beyond the view toggle", async () => {
    fetchRoadmapItemsMock.mockResolvedValue({ ...ok([plan({ treeId: "tree-2" })]), canEdit: false });
    render(<Harness />);
    await screen.findByText("Høy");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Vis arkiverte"]);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
