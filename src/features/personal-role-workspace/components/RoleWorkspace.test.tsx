// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
vi.mock("../../auth/client/auth-client", () => ({ observeIdToken: observeIdTokenMock }));
vi.mock("../../role-profiles/components/RoleTargetSection", () => ({
  RoleTargetSection: () => <div data-testid="role-target-section" />,
}));

const { RoleWorkspace } = await import("./RoleWorkspace");
const { ResponsibilitiesSection } = await import("./ResponsibilitiesSection");
const { AchievementsSection } = await import("./AchievementsSection");

/** A small in-memory stand-in for the owner's `/api/me/*` routes. The real gateway runs against it. */
interface FakeBackend {
  goals: ReturnType<typeof goal>[];
  responsibilities: Record<string, unknown>[];
  achievements: Record<string, unknown>[];
  recovery: string[];
  calls: { method: string; path: string; body?: unknown }[];
  responsibilityGetStatus: number;
  nextId: number;
}

let backend: FakeBackend;

const NOW = "2026-11-10T10:00:00.000Z";

function goal(id: string, title: string) {
  return { id, title, status: "active", treeId: null, areaName: null, areaAvailable: true, targetDate: null, createdAt: NOW, updatedAt: NOW, completedAt: null };
}

function responsibility(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    title: "Driftsansvar",
    description: null,
    status: "active",
    relationToRole: "within",
    startDate: null,
    endDate: null,
    goalIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function achievement(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    title: "Lanserte ny rapport",
    description: "Syntetisk beskrivelse",
    outcome: null,
    relationToRole: "unspecified",
    periodStart: null,
    periodEnd: null,
    goalIds: [],
    responsibilityIds: [],
    missingLinks: { goalIds: [], responsibilityIds: [] },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return { status, json: async () => body };
}

function installFakeFetch() {
  const fake = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    backend.calls.push({ method, path: url, body });
    if (url === "/api/me/goals") {
      return json(200, { goals: backend.goals, recoveryItems: [], truncated: false, skillOptions: [], skillOptionsTruncated: false });
    }
    if (url === "/api/me/responsibilities" && method === "GET") {
      if (backend.responsibilityGetStatus !== 200) return json(backend.responsibilityGetStatus, { error: "persistence_failed" });
      return json(200, {
        records: backend.responsibilities,
        recoveryItems: backend.recovery.map((id) => ({ id })),
        unavailableCount: 0,
        truncated: false,
      });
    }
    if (url === "/api/me/responsibilities" && method === "POST") {
      const created = { id: `r${backend.nextId++}`, ...body, createdAt: NOW, updatedAt: NOW };
      backend.responsibilities.push(created);
      return json(201, created);
    }
    if (url.startsWith("/api/me/responsibilities/") && method === "PATCH") {
      const id = url.split("/").pop() ?? "";
      const current = backend.responsibilities.find((item) => item.id === id);
      if (!current) return json(404, { error: "not_found" });
      Object.assign(current, body);
      return json(200, current);
    }
    if (url.startsWith("/api/me/responsibilities/") && method === "DELETE") {
      const id = url.split("/").pop() ?? "";
      backend.responsibilities = backend.responsibilities.filter((item) => item.id !== id);
      backend.recovery = backend.recovery.filter((item) => item !== id);
      return json(200, { deleted: true });
    }
    if (url === "/api/me/achievements" && method === "GET") {
      // Mirrors the server (BR-22): a link that no longer resolves is marked on read.
      const records = backend.achievements.map((item) => ({
        ...item,
        missingLinks: {
          goalIds: (item.goalIds as string[]).filter((id) => !backend.goals.some((goal) => goal.id === id)),
          responsibilityIds: (item.responsibilityIds as string[]).filter((id) => !backend.responsibilities.some((r) => r.id === id)),
        },
      }));
      return json(200, { records, recoveryItems: [], unavailableCount: 0, truncated: false });
    }
    if (url.startsWith("/api/me/achievements/") && method === "DELETE") {
      const id = url.split("/").pop() ?? "";
      backend.achievements = backend.achievements.filter((item) => item.id !== id);
      return json(200, { deleted: true });
    }
    if (url === "/api/me/achievements" && method === "POST") {
      const created = { id: `a${backend.nextId++}`, ...body, missingLinks: undefined, createdAt: NOW, updatedAt: NOW };
      backend.achievements.push(created);
      return json(201, created);
    }
    return json(404, { error: "not_found" });
  });
  vi.stubGlobal("fetch", fake);
  return fake;
}

beforeEach(() => {
  backend = {
    goals: [goal("goal-1", "Lær Rust")],
    responsibilities: [],
    achievements: [],
    recovery: [],
    calls: [],
    responsibilityGetStatus: 200,
    nextId: 1,
  };
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("test-token");
    return () => undefined;
  });
  installFakeFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const callsTo = (method: string, path: string) => backend.calls.filter((call) => call.method === method && call.path === path);

describe("role workspace: formal role and target role are kept apart (SPEC BR-1, BR-2, PR-SI-4)", () => {
  it("states that no formal role is assigned and never presents the target role as an assigned role", async () => {
    render(<RoleWorkspace />);
    expect(screen.getByRole("heading", { name: "Formell rolle i selskapet" })).toBeTruthy();
    expect(screen.getByText(/Ingen formell rolle er tildelt deg/)).toBeTruthy();
    expect(screen.getByText(/Den er ikke tildelt av arbeidsgiver/)).toBeTruthy();
    expect(screen.getByTestId("role-target-section")).toBeTruthy();
    expect(screen.getByText(/privat for deg/)).toBeTruthy();
  });
});

describe("responsibilities: owner-only create, edit, complete, reopen and delete (BR-10 to BR-16)", () => {
  it("shows the loading state, then the empty state when the owner has no responsibilities", async () => {
    render(<ResponsibilitiesSection />);
    expect(await screen.findByText("Du har ingen ansvarsområder ennå.")).toBeTruthy();
  });

  it("creates a responsibility with the chosen relation label and goal link, then shows it from a fresh list", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    await user.click(await screen.findByRole("button", { name: "Legg til ansvarsområde" }));
    await user.type(screen.getByLabelText(/Tittel/), "API-drift");
    await user.selectOptions(screen.getByLabelText("Relasjon til rollen"), "beyond");
    await user.click(screen.getByLabelText("Lær Rust"));
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect(await screen.findByRole("heading", { name: "API-drift" })).toBeTruthy();
    const [post] = callsTo("POST", "/api/me/responsibilities");
    expect(post.body).toMatchObject({ title: "API-drift", status: "active", relationToRole: "beyond", goalIds: ["goal-1"], description: null });
    expect(screen.getByText("Utover rollen")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Ansvarsområdet er lagret.");
  });

  it("marks a responsibility as completed and reopens it, each as a single owner PATCH", async () => {
    backend.responsibilities = [responsibility({ id: "r1", title: "Onboarding" })];
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    await user.click(await screen.findByRole("button", { name: "Marker som fullført" }));
    expect(await screen.findByText("Fullført")).toBeTruthy();
    expect(callsTo("PATCH", "/api/me/responsibilities/r1")[0].body).toEqual({ status: "completed" });

    await user.click(screen.getByRole("button", { name: "Gjenåpne" }));
    expect(await screen.findByText("Aktiv")).toBeTruthy();
    expect(callsTo("PATCH", "/api/me/responsibilities/r1")[1].body).toEqual({ status: "active" });
  });

  it("edits a responsibility and keeps its status unchanged", async () => {
    backend.responsibilities = [responsibility({ id: "r1", title: "Onboarding", status: "completed" })];
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    await user.click(await screen.findByRole("button", { name: "Rediger" }));
    const title = screen.getByLabelText(/Tittel/);
    await user.clear(title);
    await user.type(title, "Onboarding av nye");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect(await screen.findByRole("heading", { name: "Onboarding av nye" })).toBeTruthy();
    expect(callsTo("PATCH", "/api/me/responsibilities/r1")[0].body).toMatchObject({ title: "Onboarding av nye", status: "completed" });
  });

  it("deletes only after an explicit confirmation", async () => {
    backend.responsibilities = [responsibility({ id: "r1", title: "Onboarding" })];
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    await user.click(await screen.findByRole("button", { name: "Slett" }));
    expect(callsTo("DELETE", "/api/me/responsibilities/r1")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Ja, slett" }));
    await waitFor(() => expect(screen.getByText("Du har ingen ansvarsområder ennå.")).toBeTruthy());
    expect(callsTo("DELETE", "/api/me/responsibilities/r1")).toHaveLength(1);
  });

  it("shows the error state with a retry when the list cannot be loaded, and never shows stale data", async () => {
    backend.responsibilityGetStatus = 500;
    render(<ResponsibilitiesSection />);
    expect((await screen.findByRole("alert")).textContent).toBe("Kunne ikke laste dataene. Prøv igjen senere.");
    expect(screen.getByRole("button", { name: "Prøv igjen" })).toBeTruthy();
    expect(screen.queryByText("Du har ingen ansvarsområder ennå.")).toBeNull();
  });

  it("offers recovery deletion for a malformed record without showing any content", async () => {
    backend.recovery = ["bad-1"];
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    expect(await screen.findByText("Ugyldige poster")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Slett ugyldig post" }));
    await user.click(screen.getByRole("button", { name: "Ja, slett" }));
    await waitFor(() => expect(callsTo("DELETE", "/api/me/responsibilities/bad-1")).toHaveLength(1));
  });

  it("asks the person to sign in when no token is available", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => undefined;
    });
    render(<ResponsibilitiesSection />);
    expect(await screen.findByText("Logg inn for å se og redigere din rolle og dine bidrag.")).toBeTruthy();
    expect(callsTo("GET", "/api/me/responsibilities")).toHaveLength(0);
  });

  it("does not send a create request while the required title is empty", async () => {
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    await user.click(await screen.findByRole("button", { name: "Legg til ansvarsområde" }));
    const title = screen.getByLabelText(/Tittel/) as HTMLInputElement;
    expect(title.required).toBe(true);
    await user.click(screen.getByRole("button", { name: "Lagre" }));
    expect(callsTo("POST", "/api/me/responsibilities")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Nytt ansvarsområde" })).toBeTruthy();
  });
});

describe("achievements: owner-only create, edit, delete, links and missing-link marker (BR-20 to BR-24)", () => {
  it("re-reads achievements after a linked responsibility is deleted, so the BR-22 marker is current", async () => {
    backend.responsibilities = [responsibility({ id: "r1", title: "Onboarding" })];
    backend.achievements = [achievement({ responsibilityIds: ["r1"] })];
    const user = userEvent.setup();
    render(<RoleWorkspace />);
    await screen.findByRole("heading", { name: "Onboarding" });
    expect(screen.queryByText("Koblet element er ikke lenger tilgjengelig")).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "Slett" })[0]);
    await user.click(screen.getByRole("button", { name: "Ja, slett" }));
    expect(await screen.findByText("Koblet element er ikke lenger tilgjengelig")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Lanserte ny rapport" })).toBeTruthy();
  });

  it("creates an achievement with a responsibility link and shows the 'Ikke angitt' relation label", async () => {
    backend.responsibilities = [responsibility({ id: "r1", title: "Driftsansvar" })];
    const user = userEvent.setup();
    render(<AchievementsSection />);
    await user.click(await screen.findByRole("button", { name: "Legg til bidrag" }));
    await user.type(screen.getByLabelText(/^Tittel/), "Ny rapport");
    await user.type(screen.getByLabelText(/^Beskrivelse/), "Syntetisk beskrivelse");
    await user.click(await screen.findByLabelText("Driftsansvar"));
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect(await screen.findByRole("heading", { name: "Ny rapport" })).toBeTruthy();
    expect(callsTo("POST", "/api/me/achievements")[0].body).toMatchObject({
      title: "Ny rapport",
      relationToRole: "unspecified",
      responsibilityIds: ["r1"],
      goalIds: [],
    });
    expect(screen.getAllByText("Ikke angitt").length).toBeGreaterThan(0);
  });

  it("marks a deleted goal or responsibility link on read, without hiding the achievement (BR-22, E-2, E-3)", async () => {
    backend.achievements = [achievement({ goalIds: ["gone"], responsibilityIds: ["also-gone"] })];
    render(<AchievementsSection />);
    expect(await screen.findByRole("heading", { name: "Lanserte ny rapport" })).toBeTruthy();
    expect(screen.getByText("Koblet element er ikke lenger tilgjengelig")).toBeTruthy();
  });

  it("does not show the link marker when every linked record still exists", async () => {
    backend.achievements = [achievement()];
    render(<AchievementsSection />);
    await screen.findByRole("heading", { name: "Lanserte ny rapport" });
    expect(screen.queryByText("Koblet element er ikke lenger tilgjengelig")).toBeNull();
  });

  it("orders achievements chronologically by period start, with no ranking", async () => {
    backend.achievements = [
      achievement({ id: "late", title: "Sent", periodStart: "2026-06-01" }),
      achievement({ id: "early", title: "Tidlig", periodStart: "2026-01-01" }),
    ];
    render(<AchievementsSection />);
    const headings = (await screen.findAllByRole("heading", { level: 3 })).map((heading) => heading.textContent);
    expect(headings).toEqual(["Tidlig", "Sent"]);
  });

  it("offers a responsibility created in the same workspace when the achievement form opens", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ResponsibilitiesSection />
        <AchievementsSection />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: "Legg til ansvarsområde" }));
    await user.type(screen.getByLabelText(/Tittel/), "Nytt driftsansvar");
    await user.click(screen.getByRole("button", { name: "Lagre" }));
    await screen.findByRole("heading", { name: "Nytt driftsansvar" });

    await user.click(screen.getByRole("button", { name: "Legg til bidrag" }));
    expect(await screen.findByLabelText("Nytt driftsansvar")).toBeTruthy();
  });

  it("deletes an achievement only after confirmation", async () => {
    backend.achievements = [achievement({ id: "a1" })];
    const user = userEvent.setup();
    render(<AchievementsSection />);
    const card = (await screen.findByRole("heading", { name: "Lanserte ny rapport" })).closest("li") as HTMLElement;
    await user.click(within(card).getByRole("button", { name: "Slett" }));
    expect(callsTo("DELETE", "/api/me/achievements/a1")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Ja, slett" }));
    await waitFor(() => expect(screen.getByText("Du har ingen bidrag ennå.")).toBeTruthy());
    expect(callsTo("DELETE", "/api/me/achievements/a1")).toHaveLength(1);
  });
});

describe("workspace filters, ordering and linked names (BR-16, BR-23, BR-24, BR-22)", () => {
  it("lists active responsibilities before completed ones and filters by status", async () => {
    backend.responsibilities = [
      responsibility({ id: "r1", title: "Avsluttet arbeid", status: "completed" }),
      responsibility({ id: "r2", title: "Pågående arbeid", status: "active" }),
    ];
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    const headings = (await screen.findAllByRole("heading", { level: 3 })).map((heading) => heading.textContent);
    expect(headings).toEqual(["Pågående arbeid", "Avsluttet arbeid"]);

    await user.selectOptions(screen.getByLabelText("Vis"), "completed");
    expect(screen.queryByRole("heading", { name: "Pågående arbeid" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Avsluttet arbeid" })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Vis"), "active");
    expect(screen.queryByRole("heading", { name: "Avsluttet arbeid" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Pågående arbeid" })).toBeTruthy();
  });

  it("shows an explicit empty message when the status filter matches nothing", async () => {
    backend.responsibilities = [responsibility({ id: "r1", title: "Pågående arbeid", status: "active" })];
    const user = userEvent.setup();
    render(<ResponsibilitiesSection />);
    await screen.findByRole("heading", { name: "Pågående arbeid" });
    await user.selectOptions(screen.getByLabelText("Vis"), "completed");
    expect(screen.getByText("Ingen ansvarsområder matcher valget.")).toBeTruthy();
  });

  it("filters achievements by relationship label and by an overlapping period, and keeps undated records only without a period filter", async () => {
    backend.achievements = [
      achievement({ id: "a1", title: "Innen tidlig", relationToRole: "within", periodStart: "2026-01-01", periodEnd: "2026-02-01" }),
      achievement({ id: "a2", title: "Utover sent", relationToRole: "beyond", periodStart: "2026-06-01", periodEnd: "2026-07-01" }),
      achievement({ id: "a3", title: "Uten dato", relationToRole: "within" }),
    ];
    const user = userEvent.setup();
    render(<AchievementsSection />);
    await screen.findByRole("heading", { name: "Uten dato" });

    await user.selectOptions(screen.getByLabelText("Relasjon", { exact: true }), "beyond");
    expect(screen.queryByRole("heading", { name: "Innen tidlig" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Utover sent" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Uten dato" })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Relasjon", { exact: true }), "all");
    await user.type(screen.getByLabelText(/^Periode fra/), "2026-03-01");
    expect(screen.queryByRole("heading", { name: "Innen tidlig" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Utover sent" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Uten dato" })).toBeNull();
  });

  it("shows the names of linked responsibilities and goals on an achievement", async () => {
    backend.responsibilities = [responsibility({ id: "r1", title: "Driftsansvar" })];
    backend.achievements = [achievement({ goalIds: ["goal-1"], responsibilityIds: ["r1"] })];
    render(<AchievementsSection />);
    expect(await screen.findByText("Ansvarsområde: Driftsansvar")).toBeTruthy();
    expect(screen.getByText("Mål: Lær Rust")).toBeTruthy();
  });

  it("states that the target role is the employee own choice and never an assigned role", async () => {
    render(<RoleWorkspace />);
    expect(screen.getByText("Ditt utviklingsmål er ditt eget valg. Det er ikke en rolle som er tildelt deg.")).toBeTruthy();
  });
});
