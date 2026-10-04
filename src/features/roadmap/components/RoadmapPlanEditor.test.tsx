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

const ok = (items: RoadmapItemView[], canEdit = true) => ({ status: "ok", items, canEdit, truncated: false });
const MEMBERS = {
  status: "ok",
  members: [
    { memberRef: "ref-alex-1", displayName: "Alex", ordinal: 1, isSelf: false },
    { memberRef: "ref-alex-2", displayName: "Alex", ordinal: 2, isSelf: true },
    { memberRef: "ref-none", displayName: null, ordinal: null, isSelf: false },
  ],
  unavailableCount: 0,
  truncated: false,
};

function Harness({ currentNodeId = "node-1" as string | null }) {
  return (
    <RoadmapPlanningScope token="tok" teamId="team-1">
      {(planning) => (
        <div>
          {planning.controls}
          {planning.renderAreaPlan({ treeId: "tree-1", name: "Containers", currentNodeId, nodes: NODES })}
        </div>
      )}
    </RoadmapPlanningScope>
  );
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Planlegg/ }));
  return screen.findByRole("form", { name: /Ny plan/ });
}
async function openEdit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Rediger plan/ }));
  return screen.findByRole("form", { name: /Rediger plan/ });
}

describe("canEdit and existence", () => {
  it("canEdit false: summary only, no controls, no owner fetch", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan()], false));
    render(<Harness />);
    await screen.findByText("Høy");
    expect(screen.queryByRole("button", { name: /Rediger|Planlegg|Gjenopprett|Arkiver/ })).toBeNull();
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("canEdit false and no plan: no create control", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([], false));
    render(<Harness />);
    await screen.findByText("Ingen plan ennå");
    expect(screen.queryByRole("button", { name: /Planlegg/ })).toBeNull();
  });

  it("a completed plan hidden by 'Fullførte' does not offer create", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ status: "completed" })]));
    render(<Harness />);
    await screen.findByRole("button", { name: "Fullførte" });
    expect(screen.queryByText("Ingen plan ennå")).toBeNull();
    expect(screen.queryByRole("button", { name: /Planlegg/ })).toBeNull();
  });

  it("an archived plan in the loaded archived-inclusive state offers only restore", async () => {
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([plan({ archived: true })]));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Vis arkiverte" }));
    expect(await screen.findByRole("button", { name: /Gjenopprett plan/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rediger plan|Planlegg/ })).toBeNull();
    expect(screen.queryByText("Ingen plan ennå")).toBeNull();
  });
});

describe("create", () => {
  it("opens, shows only forward targets with labels, cancels, and fetches owners once", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    const user = userEvent.setup();
    render(<Harness />);

    const form = await openCreate(user);
    const target = within(form).getByLabelText("Målstadium") as HTMLSelectElement;
    expect([...target.options].map((o) => o.textContent)).toEqual(["Velg målstadium", "Production rollout", "Ekspert"]);
    expect((within(form).getByLabelText("Prioritet") as HTMLSelectElement).value).toBe("medium");
    expect(within(form).queryByLabelText("Status")).toBeNull();
    expect(within(form).getByText(/planleggingsmarkering/)).toBeTruthy();

    await user.click(within(form).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("form")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Planlegg/ }));
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1);
  });

  it("every stage is offered when tracked below the first node (currentNodeId null)", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    const user = userEvent.setup();
    render(<Harness currentNodeId={null} />);
    const form = await openCreate(user);
    const target = within(form).getByLabelText("Målstadium") as HTMLSelectElement;
    expect(target.options).toHaveLength(4);
  });

  it("posts the approved body with memberRef as the owner value, then refetches the canonical GET", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([plan({ priority: "low" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);

    await waitFor(() => expect((within(form).getByLabelText("Ansvarlig") as HTMLSelectElement).disabled).toBe(false));
    const owner = within(form).getByLabelText("Ansvarlig") as HTMLSelectElement;
    expect([...owner.options].map((o) => o.textContent)).toEqual([
      "Ikke tildelt",
      "Alex (1)",
      "Alex (2) · Deg",
      "Medlem uten navn",
    ]);
    expect(form.textContent).not.toContain("ref-alex");

    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-3");
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.type(within(form).getByLabelText("Startdato"), "2026-10-01");
    await user.selectOptions(owner, "ref-alex-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(createRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", {
      treeId: "tree-1",
      targetNodeId: "node-3",
      priority: "low",
      startDate: "2026-10-01",
      ownerRef: "ref-alex-2",
    });
    expect(await screen.findByText("Lav")).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("requires a target and blocks start after target locally", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);

    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await within(form).findByText("Velg et målstadium.")).toBeTruthy();

    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.type(within(form).getByLabelText("Startdato"), "2026-12-01");
    await user.type(within(form).getByLabelText("Måldato"), "2026-11-01");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await within(form).findByText("Startdato kan ikke være etter måldato.")).toBeTruthy();
    expect(createRoadmapItemMock).not.toHaveBeenCalled();
  });

  it("write succeeded but refresh failed: not reported as a write failure, no repeat-create invitation", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([])).mockResolvedValueOnce({ status: "read_failed" });
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText(/Endringen er lagret, men siste planstatus kunne ikke lastes/)).toBeTruthy();
    expect(screen.queryByText(/ble ikke lagret/)).toBeNull();
    expect(createRoadmapItemMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Last planer på nytt" })).toBeTruthy();
  });

  it("prevents duplicate submits while pending", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    let resolve!: (v: unknown) => void;
    createRoadmapItemMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    const saving = within(form).getByRole("button", { name: "Lagrer…" }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    await user.click(saving);
    expect(createRoadmapItemMock).toHaveBeenCalledTimes(1);
    resolve({ ok: false, error: "persistence_failed" });
    expect(await within(form).findByText("Planen ble ikke lagret. Prøv igjen.")).toBeTruthy();
  });

  it("already_planned reconciles by refetching and shows the existing plan", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([plan({ priority: "low" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "already_planned" });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText("Området har allerede en plan. Den vises nå.")).toBeTruthy();
    expect(screen.getByText("Lav")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("already_planned + failed refresh: GET-only reload, no second POST, then the canonical plan shows", async () => {
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce({ status: "read_failed" })
      .mockResolvedValueOnce({ status: "read_failed" })
      .mockResolvedValueOnce(ok([plan({ priority: "low" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "already_planned" });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText(/Området har allerede en plan, men den kunne ikke lastes/)).toBeTruthy();
    const reload = screen.getByRole("button", { name: "Last planer på nytt" });

    // A reload that fails keeps the notice and the action.
    await user.click(reload);
    await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(3));
    expect(screen.getByText(/Området har allerede en plan, men den kunne ikke lastes/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Last planer på nytt" }));

    expect(await screen.findByText("Lav")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Last planer på nytt" })).toBeNull();
    expect(screen.queryByText(/kunne ikke lastes/)).toBeNull();
    expect(createRoadmapItemMock).toHaveBeenCalledTimes(1);
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();
  });

  it("stale error + failed refresh: says the view may be stale and reloads with GET only", async () => {
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([plan()]))
      .mockResolvedValueOnce({ status: "read_failed" })
      .mockResolvedValueOnce(ok([plan({ priority: "low", archived: false })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "forbidden" });
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "medium");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText(/Du har ikke tilgang til å endre planer\. Planvisningen kan være utdatert/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/forbidden/);
    await user.click(screen.getByRole("button", { name: "Last planer på nytt" }));
    expect(await screen.findByText("Lav")).toBeTruthy();
    expect(screen.queryByText(/utdatert/)).toBeNull();
    expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1);
  });

  it("request_failed + failed refresh: ambiguity-safe wording, GET-only reload, no automatic retry", async () => {
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce({ status: "read_failed" })
      .mockResolvedValueOnce(ok([plan({ priority: "low" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "request_failed" });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await within(form).findByText(/Endringen kan være lagret/)).toBeTruthy();
    expect(screen.queryByText(/ble ikke lagret/)).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Last planer på nytt" }));

    expect(await screen.findByRole("form", { name: /Rediger plan/ })).toBeTruthy();
    expect(createRoadmapItemMock).toHaveBeenCalledTimes(1);
  });

  it("plan_archived offers 'Gjenopprett plan'; restore sends {archived:false} only on click, then refetches", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([plan({ priority: "low" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "plan_archived" });
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await within(form).findByText(/arkivert plan/)).toBeTruthy();
    expect(within(form).queryByText(/Kunne ikke opprette/)).toBeNull();
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();

    await user.click(within(form).getByRole("button", { name: "Gjenopprett plan" }));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", "tree-1", { archived: false });
    expect(createRoadmapItemMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Lav")).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("invalid_owner reloads the selector without leaking the ref or retrying", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "invalid_owner" });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await waitFor(() => expect((within(form).getByLabelText("Ansvarlig") as HTMLSelectElement).disabled).toBe(false));
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.selectOptions(within(form).getByLabelText("Ansvarlig"), "ref-alex-1");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await within(form).findByText(/kan ikke velges lenger/)).toBeTruthy();
    await waitFor(() => expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(2));
    expect(createRoadmapItemMock).toHaveBeenCalledTimes(1);
    expect(form.textContent).not.toContain("ref-alex-1");
  });

  it.each([
    ["not_tracked", /følger ikke lenger/],
    ["team_disabled", /Teamet er ikke aktivt/],
    ["forbidden", /ikke tilgang/],
  ])("%s closes the form with neutral copy and refetches", async (code, text) => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: code });
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText(text)).toBeTruthy();
    expect(container.textContent).not.toContain(code);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("target_not_ahead is a field error", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "target_not_ahead" });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    await user.selectOptions(within(form).getByLabelText("Målstadium"), "node-2");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await within(form).findByText(/må ligge foran/)).toBeTruthy();
    expect(within(form).getByLabelText("Målstadium").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("owner selector availability", () => {
  it("shows neutral hints for unavailable/truncated members and a retry on load failure; planning stays usable", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock
      .mockResolvedValueOnce({ status: "read_failed" })
      .mockResolvedValueOnce({ ...MEMBERS, unavailableCount: 2, truncated: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openCreate(user);
    expect(await within(form).findByText(/Medlemslisten kunne ikke lastes/)).toBeTruthy();
    expect((within(form).getByRole("button", { name: "Lagre" }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(within(form).getByRole("button", { name: "Last medlemmer på nytt" }));
    expect(await within(form).findByText(/Noen medlemmer kan ikke velges/)).toBeTruthy();
    expect(within(form).getByText("Bare deler av medlemslisten vises.")).toBeTruthy();
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(2);
  });
});

describe("edit", () => {
  it("initializes existing values, disables Lagre without changes and sends nothing", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan()]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);

    expect((within(form).getByLabelText("Målstadium") as HTMLSelectElement).value).toBe("node-2");
    expect((within(form).getByLabelText("Prioritet") as HTMLSelectElement).value).toBe("high");
    expect((within(form).getByLabelText("Status") as HTMLSelectElement).value).toBe("active");
    expect((within(form).getByLabelText("Startdato") as HTMLInputElement).value).toBe("2026-09-01");
    expect((within(form).getByLabelText("Måldato") as HTMLInputElement).value).toBe("2026-12-31");
    expect((within(form).getByRole("button", { name: "Lagre" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(form).getByText("Ingen endringer å lagre.")).toBeTruthy();
    expect(updateRoadmapItemMock).not.toHaveBeenCalled();
  });

  it("sends a minimal PATCH (priority/status/cleared date) and refetches", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([plan()])).mockResolvedValueOnce(ok([plan({ status: "completed" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);

    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.selectOptions(within(form).getByLabelText("Status"), "completed");
    await user.clear(within(form).getByLabelText("Måldato"));
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(updateRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", "tree-1", {
      priority: "low",
      status: "completed",
      targetDate: null,
    });
    expect(await screen.findByRole("button", { name: "Fullførte" })).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("retargets only on an actual change; target options include the existing target", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ targetNodeId: "node-1" })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness currentNodeId="node-2" />);
    const form = await openEdit(user);
    const target = within(form).getByLabelText("Målstadium") as HTMLSelectElement;
    expect([...target.options].map((o) => o.value)).toEqual(["node-1", "node-3"]);

    await user.selectOptions(target, "node-3");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", "tree-1", { targetNodeId: "node-3" });
  });

  it("unavailable target: no crash, no raw id, other fields editable without sending a target", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(
      ok([plan({ targetAvailable: false, targetLabel: null, targetNodeId: "node-raw-id" })]),
    );
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const form = await openEdit(user);
    expect((within(form).getByLabelText("Målstadium") as HTMLSelectElement).value).toBe("");
    expect(container.innerHTML).not.toContain("node-raw-id");

    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", "tree-1", { priority: "low" });
  });

  it("owner: untouched current owner is omitted; replace and clear are sent", async () => {
    const owned = plan({
      owner: { state: "current", memberRef: "ref-alex-1", displayName: "Alex", ordinal: 1, isSelf: false },
    });
    fetchRoadmapItemsMock.mockResolvedValue(ok([owned]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    await waitFor(() => expect((within(form).getByLabelText("Ansvarlig") as HTMLSelectElement).disabled).toBe(false));
    expect((within(form).getByLabelText("Ansvarlig") as HTMLSelectElement).value).toBe("ref-alex-1");

    await user.selectOptions(within(form).getByLabelText("Ansvarlig"), "ref-none");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(updateRoadmapItemMock).toHaveBeenLastCalledWith("tok", "team-1", "tree-1", { ownerRef: "ref-none" });

    const form2 = await openEdit(user);
    await user.selectOptions(within(form2).getByLabelText("Ansvarlig"), "");
    await user.click(within(form2).getByRole("button", { name: "Lagre" }));
    expect(updateRoadmapItemMock).toHaveBeenLastCalledWith("tok", "team-1", "tree-1", { ownerRef: null });
  });

  it("unavailable owner is preserved by omission and only cleared explicitly", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ owner: { state: "unavailable" } })]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    const owner = within(form).getByLabelText("Ansvarlig") as HTMLSelectElement;
    expect(owner.selectedOptions[0].textContent).toMatch(/beholdes/);

    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(updateRoadmapItemMock).toHaveBeenLastCalledWith("tok", "team-1", "tree-1", { priority: "low" });

    const form2 = await openEdit(user);
    await user.selectOptions(within(form2).getByLabelText("Ansvarlig"), "");
    await user.click(within(form2).getByRole("button", { name: "Lagre" }));
    expect(updateRoadmapItemMock).toHaveBeenLastCalledWith("tok", "team-1", "tree-1", { ownerRef: null });
  });

  it("PATCH success followed by refresh failure is not a mutation failure", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([plan()])).mockResolvedValueOnce({ status: "read_failed" });
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByText(/Endringen er lagret, men siste planstatus/)).toBeTruthy();
    expect(updateRoadmapItemMock).toHaveBeenCalledTimes(1);
    // Previous canonical state stays visible.
    expect(screen.getByText("Høy")).toBeTruthy();
  });

  it("archived (stale) error closes the form and refetches without raw codes", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan()]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "archived" });
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const form = await openEdit(user);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    expect(await screen.findByText(/Planen er arkivert/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\barchived\b/);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });
});

describe("archive and restore", () => {
  it("archives with exactly {archived:true}, disabled while the form is dirty, then refetches", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([plan()])).mockResolvedValueOnce(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    const form = await openEdit(user);

    await user.selectOptions(within(form).getByLabelText("Prioritet"), "low");
    expect((within(form).getByRole("button", { name: "Arkiver" }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "high");

    await user.click(within(form).getByRole("button", { name: "Arkiver" }));
    expect(updateRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", "tree-1", { archived: true });
    expect(await screen.findByText("Ingen plan ennå")).toBeTruthy();
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("archive in archived mode refreshes both the base and archived-inclusive GET", async () => {
    fetchRoadmapItemsMock.mockImplementation(async (_t: string, _id: string, opts?: { includeArchived?: boolean }) =>
      opts?.includeArchived ? ok([plan({ archived: true })]) : ok([plan()]),
    );
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Vis arkiverte" }));
    await screen.findByText("Arkivert");
    fetchRoadmapItemsMock.mockClear();
    // Archived plan is restorable, not editable.
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button", { name: /Gjenopprett plan/ }));

    expect(updateRoadmapItemMock).toHaveBeenCalledWith("tok", "team-1", "tree-1", { archived: false });
    await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2));
    const calls = fetchRoadmapItemsMock.mock.calls.map((c) => c[2]);
    expect(calls).toContainEqual(undefined);
    expect(calls).toContainEqual({ includeArchived: true });
  });

  it("restore failure shows a message and does not claim success", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([plan({ archived: true })]));
    updateRoadmapItemMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Vis arkiverte" }));
    await user.click(await screen.findByRole("button", { name: /Gjenopprett plan/ }));
    expect(await screen.findByText("Planen ble ikke lagret. Prøv igjen.")).toBeTruthy();
  });
});

describe("shared refresh", () => {
  it("drops a refresh that resolves after the team changed (no stale-team data)", async () => {
    let resolveRefresh!: (v: unknown) => void;
    fetchRoadmapItemsMock
      .mockResolvedValueOnce(ok([plan({ priority: "low" })])) // team-1 initial
      .mockReturnValueOnce(new Promise((r) => (resolveRefresh = r))) // team-1 refresh (in flight)
      .mockResolvedValueOnce(ok([])); // team-2 initial
    fetchAssignableMembersMock.mockResolvedValue(MEMBERS);
    updateRoadmapItemMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    function Switcher({ teamId }: { teamId: string }) {
      return (
        <RoadmapPlanningScope token="tok" teamId={teamId}>
          {(planning) =>
            planning.renderAreaPlan({ treeId: "tree-1", name: "Containers", currentNodeId: "node-1", nodes: NODES })
          }
        </RoadmapPlanningScope>
      );
    }
    const { rerender } = render(<Switcher teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: /Rediger plan/ }));
    const form = await screen.findByRole("form", { name: /Rediger plan/ });
    await user.selectOptions(within(form).getByLabelText("Prioritet"), "high");
    await user.click(within(form).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2));

    rerender(<Switcher teamId="team-2" />);
    await screen.findByText("Ingen plan ennå");
    resolveRefresh(ok([plan({ priority: "medium" })]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Ingen plan ennå")).toBeTruthy();
    expect(screen.queryByText("Middels")).toBeNull();
  });
});
