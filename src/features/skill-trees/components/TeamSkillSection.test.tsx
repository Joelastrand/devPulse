// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamSkillSection, type TeamSkillSectionState } from "./TeamSkillSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONTAINERS_SKILL = {
  treeId: "tree-1",
  name: "Containers",
  nodes: [
    { nodeId: "node-0", label: "Fundamentals", order: 0 },
    { nodeId: "node-1", label: "Evaluate alternatives", order: 1 },
    { nodeId: "node-2", label: "Production rollout", order: 2 },
  ],
  currentNodeId: "node-1",
};

const OBSERVABILITY_SKILL = {
  treeId: "tree-2",
  name: "Observability",
  nodes: [
    { nodeId: "node-0", label: "Basic logging", order: 0 },
    { nodeId: "node-1", label: "Full tracing", order: 1 },
  ],
  currentNodeId: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function stageSelect(name: string | RegExp) {
  return screen.getByRole("combobox", { name });
}

function saveButton(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

/** The SkillProgressPath list for one tree, named by the tree's name. */
function pathList(treeName: string) {
  return screen.getByRole("list", { name: treeName });
}

/** Scopes a stage-label lookup to the tree's path list, since the same label text also appears in the stage-select `<option>`. */
function pathStage(treeName: string, label: string | RegExp) {
  return within(pathList(treeName)).getByText(label).closest("li") as HTMLElement;
}

describe("TeamSkillSection", () => {
  it("shows a Norwegian loading state", () => {
    const state: TeamSkillSectionState = { status: "loading" };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows a Norwegian error state", () => {
    const state: TeamSkillSectionState = { status: "error" };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(screen.getByRole("alert").textContent).toMatch(/noe gikk galt/i);
  });

  it("shows a Norwegian empty state when the team tracks nothing", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(screen.getByRole("status").textContent).toMatch(/ingen|sporer/i);
  });

  it("renders a single tracked tree's full ordered stage list", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(screen.getByText("Containers")).toBeTruthy();
    expect(pathStage("Containers", "Fundamentals")).toBeTruthy();
    expect(pathStage("Containers", "Evaluate alternatives")).toBeTruthy();
    expect(pathStage("Containers", "Production rollout")).toBeTruthy();
  });

  it("renders multiple tracked trees, each with its own stage list", () => {
    const state: TeamSkillSectionState = {
      status: "loaded",
      skills: [CONTAINERS_SKILL, OBSERVABILITY_SKILL],
      canReportProgress: true,
    };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(screen.getByText("Containers")).toBeTruthy();
    expect(screen.getByText("Observability")).toBeTruthy();
    expect(pathStage("Observability", "Basic logging")).toBeTruthy();
    expect(pathStage("Observability", "Full tracing")).toBeTruthy();
  });

  it("marks the current stage with both aria-current='step' and visible text — never color alone", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    const currentItem = pathStage("Containers", "Evaluate alternatives");
    expect(currentItem.getAttribute("aria-current")).toBe("step");
    expect(currentItem.textContent).toMatch(/nåværende steg/i);

    const earlierItem = pathStage("Containers", "Fundamentals");
    expect(earlierItem.getAttribute("aria-current")).toBeNull();
    expect(earlierItem.textContent).toMatch(/tidligere steg/i);
    expect(pathStage("Containers", "Production rollout").textContent).toMatch(/kommende steg/i);
    const marked = within(pathList("Containers"))
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("aria-current"));
    expect(marked.length).toBe(1);
  });

  it("renders a distinct 'not started' state for a currentNodeId of null, with no current-stage marker", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [OBSERVABILITY_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(screen.getByText(/teamets nåværende steg/i).textContent).toMatch(/ikke startet/i);
    expect(screen.getAllByText(/ikke startet/i).length).toBe(1);
    for (const item of within(pathList("Observability")).getAllByRole("listitem")) {
      expect(item.getAttribute("aria-current")).toBeNull();
      expect(item.textContent).toMatch(/kommende steg/i);
    }
  });

  it("renders each tree through SkillProgressPath — one summary and one ordered list, and no legacy decimal list or suffix", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };
    const { container } = render(
      <TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />,
    );

    expect(container.querySelectorAll("ol").length).toBe(1);
    expect(container.querySelector("ol.list-decimal")).toBeNull();
    expect(container.textContent).not.toMatch(/\(Nåværende steg\)/);
    expect(screen.getAllByText(/teamets nåværende steg/i).length).toBe(1);
    expect(screen.getByText(/steg 2 av 3/i)).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders the path in the stored order, not array order", () => {
    const [n0, n1, n2] = CONTAINERS_SKILL.nodes;
    const shuffled = { ...CONTAINERS_SKILL, nodes: [n2, n0, n1] };
    const state: TeamSkillSectionState = { status: "loaded", skills: [shuffled], canReportProgress: false };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    const items = within(pathList("Containers")).getAllByRole("listitem");
    expect(items[0].textContent).toMatch(/Fundamentals/);
    expect(items[1].textContent).toMatch(/Evaluate alternatives/);
    expect(items[2].textContent).toMatch(/Production rollout/);
  });

  it("passes an unknown currentNodeId through unchanged: all upcoming, no current marker, no summary", () => {
    const state: TeamSkillSectionState = {
      status: "loaded",
      skills: [{ ...CONTAINERS_SKILL, currentNodeId: "node-gone" }],
      canReportProgress: false,
    };
    const { container } = render(
      <TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />,
    );

    expect(container.querySelector("[aria-current]")).toBeNull();
    expect(screen.queryByText(/teamets nåværende steg/i)).toBeNull();
    expect(screen.queryByText(/ikke startet/i)).toBeNull();
  });

  it("keeps the path non-interactive: stages are not buttons, links or other controls", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    const path = within(pathList("Containers"));
    expect(path.queryAllByRole("button")).toEqual([]);
    expect(path.queryAllByRole("link")).toEqual([]);
    expect(path.queryAllByRole("combobox")).toEqual([]);
    expect(pathList("Containers").querySelector("[tabindex], button, a, select, input")).toBeNull();
  });

  it("read-only view (canReportProgress=false): path visible, no stage select and no Lagre button", () => {
    const state: TeamSkillSectionState = {
      status: "loaded",
      skills: [CONTAINERS_SKILL, OBSERVABILITY_SKILL],
      canReportProgress: false,
    };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(pathList("Containers")).toBeTruthy();
    expect(pathList("Observability")).toBeTruthy();
    expect(pathStage("Containers", "Evaluate alternatives").getAttribute("aria-current")).toBe("step");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /lagre/i })).toBeNull();
  });

  it("reportable view (canReportProgress=true): path visible alongside the select and Lagre button", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(pathList("Containers")).toBeTruthy();
    expect(stageSelect(/sett stadium/i)).toBeTruthy();
    expect(saveButton(/lagre/i)).toBeTruthy();
  });

  it("a refetch with a new currentNodeId, including a backward move, recomputes the path", () => {
    const at = (currentNodeId: string): TeamSkillSectionState => ({
      status: "loaded",
      skills: [{ ...CONTAINERS_SKILL, currentNodeId }],
      canReportProgress: true,
    });
    const { rerender } = render(
      <TeamSkillSection idToken="token" teamId="team-1" state={at("node-2")} onReported={() => {}} />,
    );
    expect(pathStage("Containers", "Production rollout").getAttribute("aria-current")).toBe("step");

    rerender(<TeamSkillSection idToken="token" teamId="team-1" state={at("node-0")} onReported={() => {}} />);
    expect(pathStage("Containers", "Fundamentals").getAttribute("aria-current")).toBe("step");
    expect(pathStage("Containers", "Production rollout").textContent).toMatch(/kommende steg/i);
  });

  it("never renders an identity-shaped value (uid/email/createdBy/updatedBy) anywhere in its output", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL, OBSERVABILITY_SKILL], canReportProgress: true };
    const { container } = render(
      <TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />,
    );

    expect(container.textContent).not.toMatch(/uid|email|createdBy|updatedBy|@/i);
  });

  it("renders untrusted-looking name/label content as ordinary text, never HTML injection (XSS)", () => {
    const maliciousSkill = {
      treeId: "tree-3",
      name: "<img src=x onerror=alert(1)>Malicious Tree",
      nodes: [
        { nodeId: "node-0", label: "<script>alert('xss')</script>Stage One", order: 0 },
      ],
      currentNodeId: "node-0",
    };
    const state: TeamSkillSectionState = { status: "loaded", skills: [maliciousSkill], canReportProgress: true };
    const { container } = render(
      <TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />,
    );

    // Rendered as literal text content, never parsed as markup.
    expect(screen.getByText(maliciousSkill.name)).toBeTruthy();
    expect(within(pathList(maliciousSkill.name)).getByText(/Stage One/)).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("TeamSkillSection self-report control (docs/features/skill-progress-self-report/SPEC.md — TASK-002)", () => {
  it("renders a stage-select control and a save button for each already-tracked tree, for any authorized viewer (BR-10)", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL, OBSERVABILITY_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect(stageSelect(/sett stadium.*containers/i)).toBeTruthy();
    expect(stageSelect(/sett stadium.*observability/i)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /lagre/i }).length).toBe(2);
  });

  it("defaults the select to the current stage for a tracked tree", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    expect((stageSelect(/sett stadium/i) as HTMLSelectElement).value).toBe("node-1");
  });

  it("defaults the select to a valid node for a not-started tree, so the control remains usable", () => {
    const state: TeamSkillSectionState = { status: "loaded", skills: [OBSERVABILITY_SKILL], canReportProgress: true };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={state} onReported={() => {}} />);

    const select = stageSelect(/sett stadium/i) as HTMLSelectElement;
    expect(select.value).toBe("node-0");
    expect(select.disabled).toBe(false);
  });

  it("submits a forward move via PATCH /api/teams/[teamId]/skills/[treeId] and calls onReported on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-9" state={state} onReported={onReported} />);
    await user.selectOptions(stageSelect(/sett stadium/i), "node-2");
    await user.click(saveButton(/lagre/i));

    await waitFor(() => expect(onReported).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/team-9/skills/tree-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ nodeId: "node-2" });
    expect(init.headers).toMatchObject({ Authorization: "Bearer a-token" });
  });

  it("submits a backward move the same way as any other", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={onReported} />);
    await user.selectOptions(stageSelect(/sett stadium/i), "node-0");
    await user.click(saveButton(/lagre/i));

    await waitFor(() => expect(onReported).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ nodeId: "node-0" });
  });

  it("submits a same-node re-report — clicking save without changing the selection still sends a request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={onReported} />);
    // No selection change — the select already shows the current stage (node-1).
    await user.click(saveButton(/lagre/i));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ nodeId: "node-1" });
    expect(onReported).toHaveBeenCalledTimes(1);
  });

  it("shows a pending state while the request is in flight", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={() => {}} />);
    await user.click(saveButton(/lagre/i));

    const pendingButton = screen.getByRole("button", { name: /lagrer/i });
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    resolveFetch(jsonResponse(200, { ok: true }));
  });

  it("shows one generic authorization-failure message for a forbidden response, and never calls onReported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" })));
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={onReported} />);
    await user.click(saveButton(/lagre/i));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ikke tilgang/i);
    expect(alert.textContent?.toLowerCase()).not.toMatch(/medlem/);
    expect(onReported).not.toHaveBeenCalled();
    // The previously-displayed current stage remains marked — no false success.
    expect(pathStage("Containers", "Evaluate alternatives").getAttribute("aria-current")).toBe("step");
  });

  it("shows the same generic message for a disabled-team (team_disabled) response — no distinct team-status wording", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "team_disabled" })));
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={onReported} />);
    await user.click(saveButton(/lagre/i));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ikke tilgang/i);
    expect(alert.textContent?.toLowerCase()).not.toMatch(/deaktivert/);
    expect(onReported).not.toHaveBeenCalled();
  });

  it("shows a validation-error message for an invalid_input response, and never calls onReported", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_input" })));
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={onReported} />);
    await user.click(saveButton(/lagre/i));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/ugyldig/i);
    expect(onReported).not.toHaveBeenCalled();
  });

  it("shows one generic infrastructure-failure message for a persistence_failed response, without exposing the distinction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { error: "persistence_failed" })));
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={onReported} />);
    await user.click(saveButton(/lagre/i));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(alert.textContent?.toLowerCase()).not.toMatch(/persistence/);
    expect(onReported).not.toHaveBeenCalled();
  });

  it("shows the same generic infrastructure-failure message for a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const onReported = vi.fn();
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={onReported} />);
    await user.click(saveButton(/lagre/i));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(onReported).not.toHaveBeenCalled();
  });

  it("keyboard-operates the select and the save button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));
    const user = userEvent.setup();
    const state: TeamSkillSectionState = { status: "loaded", skills: [CONTAINERS_SKILL], canReportProgress: true };

    render(<TeamSkillSection idToken="a-token" teamId="team-1" state={state} onReported={() => {}} />);
    const select = stageSelect(/sett stadium/i);
    select.focus();
    expect(document.activeElement).toBe(select);

    await user.tab();
    expect(document.activeElement).toBe(saveButton(/lagre/i));
  });

  it("fresh-load reconstruction: a freshly mounted section reflects a newly persisted stage from state alone, not retained instance state", () => {
    // Simulates two independent page loads: the first shows the
    // pre-report persisted stage; a second, wholly separate mount (as a
    // fresh getTeamSkillProgress/fetchTeamSkills read would produce) shows
    // the post-report persisted stage — proving reconstruction comes from
    // the `state` prop alone (docs/features/skill-progress-self-report/
    // SPEC.md — TASK-002, "State/reload integration").
    const beforeReport: TeamSkillSectionState = {
      status: "loaded",
      skills: [{ ...CONTAINERS_SKILL, currentNodeId: null }],
      canReportProgress: true,
    };
    const { unmount } = render(
      <TeamSkillSection idToken="token" teamId="team-1" state={beforeReport} onReported={() => {}} />,
    );
    expect(screen.getByText(/teamets nåværende steg/i).textContent).toMatch(/ikke startet/i);
    unmount();

    const afterReport: TeamSkillSectionState = {
      status: "loaded",
      skills: [{ ...CONTAINERS_SKILL, currentNodeId: "node-2" }],
      canReportProgress: true,
    };
    render(<TeamSkillSection idToken="token" teamId="team-1" state={afterReport} onReported={() => {}} />);

    expect(screen.queryByText(/ikke startet/i)).toBeNull();
    expect(pathStage("Containers", "Production rollout").getAttribute("aria-current")).toBe("step");
  });
});
