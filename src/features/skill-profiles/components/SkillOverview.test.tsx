// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

const observeIdTokenMock = vi.fn();
const fetchOwnSkillsMock = vi.fn();

// jsdom has no layout, so the chart library is replaced by inert stand-ins. The radar's text alternative is still rendered.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RadarChart: () => null,
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  Radar: () => null,
}));

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/skill-profile-gateway", () => ({
  fetchOwnSkills: fetchOwnSkillsMock,
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

/** Synthetic fixtures only. Organizational roles and expected levels are not part of the overview. */
const SKILLS = [
  { treeId: "api", name: "API-design", level: 4 },
  { treeId: "test", name: "Testing", level: 2 },
  { treeId: "team", name: "Teamarbeid", level: 3 },
  { treeId: "ops", name: "Driftsmiljø", level: null },
];

function signedIn(skills = SKILLS) {
  observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
    callback("a-token");
    return () => {};
  });
  fetchOwnSkillsMock.mockResolvedValue({ status: "ok", dto: { skills, truncated: false, profile: "ok" } });
}

function sectionByHeading(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const section = heading.closest("section");
  if (!(section instanceof HTMLElement)) throw new Error(`no section for ${name}`);
  return section;
}

describe("Oversikt summary row (C1 BR-26: counts, no mean, no percentage)", () => {
  it("shows the count of skills at level 3 or 4, the assessed count and the development count", async () => {
    signedIn();
    render(<SkillOverview />);
    await screen.findByText("Ferdigheter på nivå 3–4");
    const text = document.body.textContent ?? "";

    expect(text).toContain("Ferdigheter på nivå 3–4");
    expect(text).toMatch(/3 av 4/);
    expect(text).toContain("Ferdigheter å utvikle");
  });

  it("never renders a percentage, average or score", async () => {
    signedIn();
    const { container } = render(<SkillOverview />);
    await screen.findByText("Ferdigheter på nivå 3–4");
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
    const section = (await screen.findByRole("heading", { name: "Kompetanseprofil" })).closest("section")!;
    expect(within(section).getByText("API-design")).toBeTruthy();
    expect(within(section).getByText("Ikke vurdert")).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Se alle ferdigheter" }).getAttribute("href")).toBe("/me/skills?vy=rediger");
  });

  it("shows the list by default and no role comparison or expected-level copy", async () => {
    signedIn();
    render(<SkillOverview />);
    await screen.findByRole("heading", { name: "Kompetanseprofil" });
    expect(screen.getByRole("button", { name: "Liste" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("img", { name: /Radardiagram/ })).toBeNull();
    expect(screen.queryByText("Rolleutvikling")).toBeNull();
    expect(screen.queryByText(/Målrolle|forventet nivå/i)).toBeNull();
  });

  it("shows the personal radar of the own assessed levels only when the person chooses the radar view", async () => {
    signedIn();
    render(<SkillOverview />);
    await screen.findByRole("heading", { name: "Kompetanseprofil" });
    fireEvent.click(screen.getByRole("button", { name: "Radar" }));
    expect(screen.getByRole("button", { name: "Radar" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Radardiagram over 3 vurderte ferdigheter, nivå 1 til 4." })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Nivå per vurdert ferdighet" });
    expect(within(table).getByText("Avansert")).toBeTruthy();
    expect(within(table).queryByText("Driftsmiljø")).toBeNull();
    expect(screen.getByText("1 ikke vurdert: vises ikke i radaren.")).toBeTruthy();
  });

  it("explains instead of drawing a radar when fewer than three skills are assessed", async () => {
    signedIn([
      { treeId: "api", name: "API-design", level: 4 },
      { treeId: "test", name: "Testing", level: null },
      { treeId: "ops", name: "Driftsmiljø", level: null },
    ]);
    render(<SkillOverview />);
    await screen.findByRole("heading", { name: "Kompetanseprofil" });
    fireEvent.click(screen.getByRole("button", { name: "Radar" }));
    expect(screen.getByText("Radaren vises når minst 3 ferdigheter er vurdert. Du har vurdert 1.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Radardiagram/ })).toBeNull();
  });

  it("links to the personal role section, where the organizational role is shown", async () => {
    signedIn();
    render(<SkillOverview />);
    const link = await screen.findByRole("link", { name: "Min rolle og mine bidrag" });
    expect(link.getAttribute("href")).toBe("/me/skills?vy=rolle");
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
    render(<SkillOverview />);
    expect(await screen.findByText("Noe gikk galt under lasting av ferdighetene dine.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prøv igjen" })).toBeTruthy();
  });
});

describe("Oversikt profile (presentation of existing values)", () => {
  it("names every skill in the profile with its own level as text, and marks unassessed skills as such", async () => {
    signedIn();
    render(<SkillOverview />);
    const profile = (await screen.findByRole("heading", { name: "Kompetanseprofil" })).closest("section")!;
    expect(within(profile).getByText("API-design")).toBeTruthy();
    expect(within(profile).getByText("Nivå 4 · Avansert")).toBeTruthy();
    expect(within(profile).getByText("Ikke vurdert")).toBeTruthy();
  });
});
