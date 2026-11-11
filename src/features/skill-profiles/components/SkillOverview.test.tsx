// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const observeIdTokenMock = vi.fn();
const fetchOwnSkillsMock = vi.fn();
const fetchRoleComparisonMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/skill-profile-gateway", () => ({
  fetchOwnSkills: fetchOwnSkillsMock,
}));

vi.mock("../../role-profiles/client/role-target-gateway", () => ({
  fetchRoleComparison: fetchRoleComparisonMock,
}));

// Recharts needs measured DOM; the radar's data and text alternative are tested through PersonalRadar.test.tsx.
vi.mock("./PersonalRadar", () => ({
  PersonalRadar: ({ points, roleName }: { points: readonly { label: string }[]; roleName: string | null }) => (
    <div data-testid="personal-radar" data-axes={points.map((point) => point.label).join("|")} data-role={roleName ?? ""} />
  ),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { SkillOverview } = await import("./SkillOverview");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Synthetic fixtures only. */
const SKILLS = [
  { treeId: "api", name: "API-design", level: 4 },
  { treeId: "test", name: "Testing", level: 2 },
  { treeId: "team", name: "Teamarbeid", level: 3 },
  { treeId: "ops", name: "Driftsmiljø", level: null },
];

function signedIn(skills = SKILLS, comparison: unknown = { status: "ok", view: { state: "no_target" } }) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchOwnSkillsMock.mockResolvedValue({ status: "ok", dto: { skills, truncated: false, profile: "ok" } });
  fetchRoleComparisonMock.mockResolvedValue(comparison);
}

function sectionByHeading(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const section = heading.closest("section");
  if (!(section instanceof HTMLElement)) throw new Error(`no section for ${name}`);
  return section;
}

describe("Oversikt summary row (C1 BR-26: counts, no mean, no percentage)", () => {
  it("shows the number of assessed skills at level 3 or higher, the assessed count and the development count", async () => {
    signedIn();
    render(<SkillOverview />);
    await screen.findByRole("heading", { name: "Din utvikling" });

    expect(within(sectionByHeading("Din utvikling")).getByText("2")).toBeTruthy();
    expect(within(sectionByHeading("Vurderte ferdigheter")).getByText("3 av 4")).toBeTruthy();
    expect(within(sectionByHeading("Utviklingsområder")).getByText("1")).toBeTruthy();
  });

  it("never renders a percentage, average or score", async () => {
    signedIn();
    const { container } = render(<SkillOverview />);
    await screen.findByRole("heading", { name: "Din utvikling" });
    expect(container.textContent).not.toMatch(/%|gjennomsnitt|snitt|score|poeng/i);
  });
});

describe("Oversikt is a dashboard, not the editing form (ref 07)", () => {
  it("renders no level select, filter or reset control", async () => {
    signedIn();
    render(<SkillOverview />);
    await screen.findByRole("heading", { name: "Kompetanseprofil" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nullstill alle ferdigheter" })).toBeNull();
  });

  it("lists the competence areas with their level names and links to the full editing view", async () => {
    signedIn();
    render(<SkillOverview />);
    const areas = await screen.findByRole("heading", { name: "Kompetanseprofil" });
    const section = areas.closest("section")!;
    expect(within(section).getByText("API-design")).toBeTruthy();
    expect(within(section).getByText("Ikke vurdert")).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Se alle ferdigheter" }).getAttribute("href")).toBe("/me/skills?vy=rediger");
  });

  it("gives the radar only the person's own assessed skills", async () => {
    signedIn();
    render(<SkillOverview />);
    await userEvent.click(await screen.findByRole("button", { name: "Vis som radardiagram" }));
    const radar = await screen.findByTestId("personal-radar");
    expect(radar.getAttribute("data-axes")).toBe("API-design|Testing|Teamarbeid");
    expect(radar.getAttribute("data-role")).toBe("");
  });
});

describe("Oversikt role development (owner-only comparison)", () => {
  const comparison = {
    status: "ok",
    view: {
      state: "available",
      target: { roleId: "r1", name: "Seniorutvikler" },
      rows: [
        { treeId: "api", treeName: "API-design", expectedLevel: 3, status: "meets", ownLevel: 4 },
        { treeId: "test", treeName: "Testing", expectedLevel: 3, status: "development_opportunity", ownLevel: 2 },
        { treeId: "team", treeName: "Teamarbeid", expectedLevel: 3, status: "meets", ownLevel: 3 },
        { treeId: "ops", treeName: "Driftsmiljø", expectedLevel: 2, status: "not_assessed", ownLevel: null },
      ],
    },
  };

  it("summarises the selected role as a count of met expectations and suggests the development gaps", async () => {
    signedIn(SKILLS, comparison);
    render(<SkillOverview />);
    const role = await screen.findByRole("heading", { name: "Rolleutvikling" }).then((heading) => heading.closest("section")!);

    expect(within(role).getByText("Målrolle: Seniorutvikler")).toBeTruthy();
    expect(within(role).getByText("Oppfyller forventningen i 2 av 4 områder.")).toBeTruthy();
    const suggestions = sectionByHeading("Forslag til utvikling");
    expect(within(suggestions).getByText("Testing")).toBeTruthy();
    expect(within(suggestions).queryByText("API-design")).toBeNull();
    expect(within(suggestions).getByRole("link", { name: /Testing/ }).getAttribute("href")).toBe("/me/skills?vy=rolle");
    await userEvent.click(screen.getByRole("button", { name: "Vis som radardiagram" }));
    expect(screen.getByTestId("personal-radar").getAttribute("data-role")).toBe("Seniorutvikler");
  });

  it("links to the role comparison view to select or change the role", async () => {
    signedIn();
    render(<SkillOverview />);
    const link = await screen.findByRole("link", { name: "Velg eller endre målrolle" });
    expect(link.getAttribute("href")).toBe("/me/skills?vy=rolle");
  });

  it("shows an error for the comparison but keeps the own skills visible", async () => {
    signedIn(SKILLS, { status: "read_failed" });
    render(<SkillOverview />);
    expect(await screen.findByText("Målrollen kunne ikke lastes akkurat nå.")).toBeTruthy();
    expect(screen.getByText("API-design")).toBeTruthy();
  });
});

describe("Oversikt privacy and error states", () => {
  it("asks the person to sign in and shows no skill names when signed out", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback(null);
      return () => {};
    });
    render(<SkillOverview />);
    expect(await screen.findByRole("link", { name: "Logg inn" })).toBeTruthy();
    expect(screen.queryByText("API-design")).toBeNull();
    expect(fetchOwnSkillsMock).not.toHaveBeenCalled();
  });

  it("hides stored levels of an unreadable profile instead of interpreting them", async () => {
    signedIn(SKILLS);
    fetchOwnSkillsMock.mockResolvedValue({ status: "ok", dto: { skills: SKILLS, truncated: false, profile: "unreadable" } });
    render(<SkillOverview />);
    expect(await screen.findByText("Lagrede vurderinger kan ikke leses akkurat nå.")).toBeTruthy();
    const areas = sectionByHeading("Kompetanseprofil");
    expect(within(areas).queryByText("Avansert")).toBeNull();
    expect(within(areas).getAllByText("Ikke vurdert").length).toBe(SKILLS.length);
  });

  it("shows a retryable error when the own skills cannot be loaded", async () => {
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      callback("a-token");
      return () => {};
    });
    fetchOwnSkillsMock.mockResolvedValue({ status: "read_failed" });
    fetchRoleComparisonMock.mockResolvedValue({ status: "ok", view: { state: "no_target" } });
    render(<SkillOverview />);
    expect(await screen.findByText("Noe gikk galt under lasting av ferdighetene dine.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prøv igjen" })).toBeTruthy();
  });
});

describe("Oversikt suggestions and profile (presentation of existing values)", () => {
  it("shows the current and the expected level of each development suggestion, in the same words as the profile", async () => {
    signedIn(SKILLS, {
      status: "ok",
      view: {
        state: "available",
        target: { roleId: "r1", name: "Seniorutvikler" },
        rows: [{ treeId: "test", treeName: "Testing", expectedLevel: 3, status: "development_opportunity", ownLevel: 2 }],
      },
    });
    render(<SkillOverview />);
    const suggestions = await screen.findByRole("heading", { name: "Forslag til utvikling" });
    expect(within(suggestions.closest("section")!).getByText("Nivå 2 nå · forventet nivå 3")).toBeTruthy();
  });

  it("names every skill in the profile with its own level as text, and marks unassessed skills as such", async () => {
    signedIn();
    render(<SkillOverview />);
    const profile = (await screen.findByRole("heading", { name: "Kompetanseprofil" })).closest("section")!;
    expect(within(profile).getByText("API-design")).toBeTruthy();
    expect(within(profile).getByText("Nivå 4 · Avansert")).toBeTruthy();
    expect(within(profile).getByText("Ikke vurdert")).toBeTruthy();
  });
});
