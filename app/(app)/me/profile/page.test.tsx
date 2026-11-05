// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectHeadingStructure, expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../../../../src/features/profiles/components/ProfileForm", () => ({
  ProfileForm: () => <form id="profile-form" aria-label="Visningsnavn-skjema" />,
}));
vi.mock("../../../../src/features/profiles/components/ProfileHeaderName", () => ({
  ProfileHeaderName: () => <p>Visningsnavn: Kari Nordmann</p>,
}));
vi.mock("../../../../src/features/profiles/components/ProfileHeaderTeams", () => ({
  ProfileHeaderTeams: () => <p>Team: Plattform</p>,
}));
vi.mock("../../../../src/features/account-erasure/components/ErasureEntryLink", () => ({
  ErasureEntryLink: () => <span>Slett konto</span>,
}));

const { default: ProfilePage } = await import("./page");
const { profileCopy } = await import("../../../../src/features/profiles/copy");

describe("ProfilePage composition (visual-redesign TASK-016)", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers 'Rediger profil' as a link to the display-name form", () => {
    render(<ProfilePage />);

    const action = screen.getByRole("link", { name: profileCopy.editAction });
    expect(action.getAttribute("href")).toBe("#profile-form");
    expect(document.getElementById("profile-form")).not.toBeNull();
  });

  it("keeps the account entry in the main column and shows no bio, contact, location or skill panel", () => {
    render(<ProfilePage />);

    expect(screen.getAllByRole("region", { name: profileCopy.accountTitle }).length).toBeGreaterThan(0);
    expect(screen.getByText("Slett konto")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/bio|om meg|kontakt|sted|stilling|ferdigheter/i);
  });

  it("keeps 'Min profil' as the only h1, shows the viewer's name in the band, and the privacy note in the aside", () => {
    render(<ProfilePage />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(profileCopy.pageTitle);
    expect(screen.getByText("Visningsnavn: Kari Nordmann")).toBeTruthy();
    expect(screen.getAllByText(profileCopy.fieldDescription).length).toBeGreaterThan(0);
  });

  it("shows the viewer's team membership in the header band, above the two-column panels (visual-fidelity TASK-018)", () => {
    render(<ProfilePage />);

    const teamLine = screen.getByText("Team: Plattform");
    const band = teamLine.closest("section");
    expect(band?.className).toContain("sm:flex-row");
    expect(band?.querySelector("h1")).not.toBeNull();
  });
});

describe("profile heading structure (visual-redesign TASK-019)", () => {
  it("has one level-1 page title and a valid hierarchy", () => {
    render(<ProfilePage />);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark and a valid heading structure with one level-1 title", async () => {
    render(<ProfilePage />);
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    expectHeadingStructure(document.body, { ownsPageTitle: true });
  });
});
