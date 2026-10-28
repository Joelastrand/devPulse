// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { skillProfileCopy } from "../copy";

const observeIdTokenMock = vi.fn();
const fetchOwnSkillsMock = vi.fn();
const setOwnSkillLevelMock = vi.fn();
const clearOwnSkillLevelMock = vi.fn();
const deleteOwnSkillProfileMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/skill-profile-gateway", () => ({
  fetchOwnSkills: fetchOwnSkillsMock,
  setOwnSkillLevel: setOwnSkillLevelMock,
  clearOwnSkillLevel: clearOwnSkillLevelMock,
  deleteOwnSkillProfile: deleteOwnSkillProfileMock,
}));

const { SkillProfilePage } = await import("./SkillProfilePage");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

function ok(skills: { treeId: string; name: string; level: 1 | 2 | 3 | 4 | null }[], extra = {}) {
  return { status: "ok", dto: { skills, truncated: false, profile: "ok", ...extra } };
}

async function renderWith(result: unknown) {
  observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
  fetchOwnSkillsMock.mockResolvedValue(result);
  render(<SkillProfilePage />);
  await screen.findByText(/egenvurderingen din er din egen/i);
}

describe("SkillProfilePage", () => {
  it("signed out: shows the sign-in prompt and makes no request", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<SkillProfilePage />);

    expect((await screen.findByRole("link", { name: "Logg inn" })).getAttribute("href")).toBe("/sign-in");
    expect(fetchOwnSkillsMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a loading status and no skill data while the read is pending", () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnSkillsMock.mockReturnValue(new Promise(() => {}));

    render(<SkillProfilePage />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
    expect(screen.queryByRole("list")).toBeNull();
    expect(fetchOwnSkillsMock).toHaveBeenCalledWith("a-token");
  });

  it("renders the notice, an always-visible four-level legend and the list in server order", async () => {
    await renderWith(
      ok([
        { treeId: "t-b", name: "Testing", level: 3 },
        { treeId: "t-a", name: "Arkitektur", level: null },
      ]),
    );

    expect(screen.getByText("Egenvurderingen din er din egen. Teamkolleger, teamledere og administratorer kan ikke se nivåene du setter. Du kan velge, team for team, at den skal telle med i en personvernbeskyttet teamoversikt der teamet bare ser en grov status per kompetansebehov.")).toBeTruthy();
    const terms = Array.from(document.querySelectorAll("dt")).map((el) => el.textContent);
    expect(terms).toEqual(["Grunnleggende kjennskap", "Kan med støtte", "Kan selvstendig", "Avansert"]);
    expect(document.querySelectorAll("dd")).toHaveLength(4);

    const list = screen.getByRole("heading", { name: "Ferdigheter" }).parentElement!.querySelector("ul")!;
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Testing");
    expect(rows[1].textContent).toContain("Arkitektur");
  });

  it("shows the approved role-comparison notice directly after the C1 notice (role-profiles TASK-022)", async () => {
    await renderWith(ok([{ treeId: "t-a", name: "Arkitektur", level: null }]));

    const c1 = screen.getByText(skillProfileCopy.privacyNotice);
    const approved = screen.getByText(skillProfileCopy.roleComparisonNotice);
    expect(c1.compareDocumentPosition(approved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("assessed row: indicator text equals the level name, segments are aria-hidden; level 4 is 'Avansert'", async () => {
    await renderWith(ok([{ treeId: "t-1", name: "Sikkerhet", level: 4 }]));

    const row = screen.getByText("Sikkerhet").closest("li")!;
    expect(row.textContent).toContain("Avansert");
    const hidden = row.querySelector('[aria-hidden="true"]')!;
    expect(hidden.children).toHaveLength(4);
    expect(hidden.textContent).toBe("");
  });

  it("unassessed row says 'Ikke vurdert', never a number or zero", async () => {
    await renderWith(ok([{ treeId: "t-1", name: "Sikkerhet", level: null }]));

    const row = screen.getByText("Sikkerhet").closest("li")!;
    expect(row.textContent).toContain("Ikke vurdert");
    expect(row.textContent).not.toMatch(/\d/);
  });

  it("partial assessments: overview counts visible skills only, with per-level text for levels above zero", async () => {
    await renderWith(
      ok([
        { treeId: "1", name: "A", level: 1 },
        { treeId: "2", name: "B", level: 1 },
        { treeId: "3", name: "C", level: 4 },
        { treeId: "4", name: "D", level: null },
      ]),
    );

    expect(screen.getByText("Du har vurdert 3 av 4 ferdigheter.")).toBeTruthy();
    expect(screen.getByText("Grunnleggende kjennskap: 2")).toBeTruthy();
    expect(screen.getByText("Avansert: 1")).toBeTruthy();
    expect(screen.queryByText(/Kan med støtte: /)).toBeNull();
    expect(screen.queryByText(/Kan selvstendig: /)).toBeNull();
  });

  it("truncated: uses the 'viste ferdighetene' overview variant and shows the truncation notice", async () => {
    await renderWith(
      ok(
        [
          { treeId: "1", name: "A", level: 2 },
          { treeId: "2", name: "B", level: null },
        ],
        { truncated: true },
      ),
    );

    expect(screen.getByText("Du har vurdert 1 av de viste ferdighetene.")).toBeTruthy();
    expect(screen.getByText("Listen kan være ufullstendig.")).toBeTruthy();
  });

  it("no assessments: lists all rows as 'Ikke vurdert' with one neutral sentence and no overview counts", async () => {
    await renderWith(
      ok([
        { treeId: "1", name: "A", level: null },
        { treeId: "2", name: "B", level: null },
      ]),
    );

    expect(screen.getByText(/du har ikke vurdert noen ferdigheter ennå/i)).toBeTruthy();
    expect(screen.getAllByRole("combobox").map((el) => (el as HTMLSelectElement).value)).toEqual(["", ""]);
    expect(screen.getAllByText("Ikke vurdert", { selector: "span span" })).toHaveLength(2);
    expect(screen.queryByText(/du har vurdert/i)).toBeNull();
  });

  it("many skills: renders every row", async () => {
    const skills = Array.from({ length: 60 }, (_, i) => ({ treeId: `t-${i}`, name: `Område ${i}`, level: null }));
    await renderWith(ok(skills));

    expect(screen.getByRole("heading", { name: "Ferdigheter" }).parentElement!.querySelectorAll("li")).toHaveLength(60);
  });

  it("no skill areas defined: shows the empty state and no list", async () => {
    await renderWith(ok([]));

    expect(screen.getByText("Ingen ferdigheter er definert ennå.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Ferdigheter" })).toBeNull();
  });

  it("unreadable profile: shows only a notice and names, never 'Ikke vurdert' or counts, and only the reset-all recovery control", async () => {
    await renderWith(ok([{ treeId: "1", name: "Sikkerhet", level: null }], { profile: "unreadable" }));

    expect(screen.getByRole("alert").textContent).toMatch(/kan ikke leses/i);
    expect(screen.getByText("Sikkerhet")).toBeTruthy();
    expect(screen.queryByText("Ikke vurdert")).toBeNull();
    expect(screen.queryByText(/du har vurdert/i)).toBeNull();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Nullstill alle ferdigheter"]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("read failure: shows a single alert without raw error text, and retry reloads", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnSkillsMock.mockResolvedValueOnce({ status: "read_failed" });
    render(<SkillProfilePage />);

    expect((await screen.findByRole("alert")).textContent).toBe("Noe gikk galt under lasting av ferdighetene dine.");
    expect(screen.queryByRole("list")).toBeNull();

    fetchOwnSkillsMock.mockResolvedValueOnce(ok([{ treeId: "1", name: "Sikkerhet", level: 2 }]));
    await userEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));

    expect(await screen.findByText("Sikkerhet")).toBeTruthy();
    expect(fetchOwnSkillsMock).toHaveBeenCalledTimes(2);
  });

  it("an unauthenticated read result returns to the sign-in prompt with no data", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnSkillsMock.mockResolvedValue({ status: "unauthenticated" });

    render(<SkillProfilePage />);

    expect(await screen.findByRole("link", { name: "Logg inn" })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("identity change clears the previous user's data and ignores a stale response", async () => {
    let emit: (token: string | null) => void = () => {};
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      emit = callback;
      return () => {};
    });
    let resolveA: (value: unknown) => void = () => {};
    fetchOwnSkillsMock.mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)));
    render(<SkillProfilePage />);

    emit("token-a");
    await waitFor(() => expect(fetchOwnSkillsMock).toHaveBeenCalledWith("token-a"));

    fetchOwnSkillsMock.mockResolvedValueOnce(ok([{ treeId: "b", name: "Bs område", level: 1 }]));
    emit("token-b");
    expect(await screen.findByText("Bs område")).toBeTruthy();

    resolveA(ok([{ treeId: "a", name: "As område", level: 4 }]));
    await Promise.resolve();
    expect(screen.queryByText("As område")).toBeNull();

    emit(null);
    expect(await screen.findByRole("link", { name: "Logg inn" })).toBeTruthy();
    expect(screen.queryByText("Bs område")).toBeNull();
  });

  it("privacy and scope: no ids, e-mail, team text, score wording, chart or text inputs", async () => {
    await renderWith(
      ok([
        { treeId: "secret-tree-id", name: "Sikkerhet", level: 3 },
        { treeId: "other-id", name: "Testing", level: null },
      ]),
    );

    // The amended notice (C2 BR-29) is the one place that names "team"; it is pinned in skill-profiles-cross-cutting.test.ts.
    // Everything else on the page must still carry no team information.
    const text = (document.body.textContent ?? "").replace(skillProfileCopy.privacyNotice, "");
    expect(text).not.toContain("secret-tree-id");
    expect(text).not.toContain("other-id");
    expect(text).not.toMatch(/@|\buid\b|team(?!ledere)/i);
    expect(text).not.toMatch(/poeng|score|rangering|gjennomsnitt|prosent|%|snitt/i);
    expect(document.querySelector("svg, canvas, img, [role='img'], [role='meter'], progress, meter")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("heading order: sections use h2 (the page h1 comes from the route)", async () => {
    await renderWith(ok([{ treeId: "1", name: "A", level: 1 }]));

    const levels = screen.getAllByRole("heading").map((heading) => heading.tagName);
    expect(levels.every((tag) => tag === "H2")).toBe(true);
  });
});
