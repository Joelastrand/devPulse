// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamSystemView } from "../server/list-team-systems";
import { systemsCopy } from "../copy";

const fetchTeamSystemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/teams/team-1/systems",
}));

vi.mock("../../teams/client/teams-overview-gateway", () => ({
  fetchTeamsOverview: async () => ({
    status: "ok",
    teams: [{ teamId: "team-1", name: "Team Alfa" }],
  }),
}));

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const React = await import("react");
  return {
    useAuthGatedResource: (onAuthChange: (token: string | null, generation: number, current: () => boolean) => void) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      React.useEffect(() => {
        onAuthChange("token-abc", 1, () => true);
      }, []);
      return { isCurrentGeneration: () => true };
    },
  };
});

vi.mock("../client/team-systems-gateway", () => ({
  fetchTeamSystems: (...args: unknown[]) => fetchTeamSystemsMock(...args),
  fetchAssignableMembers: (...args: unknown[]) => fetchAssignableMembersMock(...args),
  createTeamSystem: vi.fn(),
  updateTeamSystem: vi.fn(),
}));

const { TeamSystemsPage } = await import("./TeamSystemsPage");

const NOT_ASSESSED = { value: "ikke_vurdert" as const, note: null, assessedAt: null };

function system(overrides: Partial<TeamSystemView> & { name: string }): TeamSystemView {
  return {
    systemId: `sys-${overrides.name}`,
    description: null,
    backstageUrl: null,
    assessments: {
      availability: NOT_ASSESSED,
      reliability: NOT_ASSESSED,
      maintainability: NOT_ASSESSED,
      security: NOT_ASSESSED,
      testability: NOT_ASSESSED,
      deployability: NOT_ASSESSED,
      observability: NOT_ASSESSED,
    },
    knowledge: [],
    knowledgeRisk: "none",
    attention: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function okResult(systems: TeamSystemView[], canEdit = true) {
  return { status: "ok", systems, canEdit, truncated: false };
}

afterEach(() => {
  cleanup();
  fetchTeamSystemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
});

async function renderWith(systems: TeamSystemView[], canEdit = true) {
  fetchTeamSystemsMock.mockResolvedValue(okResult(systems, canEdit));
  fetchAssignableMembersMock.mockResolvedValue({ status: "ok", members: [] });
  render(<TeamSystemsPage teamId="team-1" />);
  await screen.findByRole("heading", { level: 1, name: "Team Alfa" });
}

function matrix(): HTMLElement {
  const table = document.querySelector("table");
  if (!table) throw new Error("matrix table not rendered");
  return table as HTMLElement;
}

describe("Systemoversikt matrix (reference 16)", () => {
  it("renders one compact status icon per attribute with an accessible name stating attribute and status", async () => {
    await renderWith([
      system({
        name: "Kontroll",
        assessments: {
          ...system({ name: "x" }).assessments,
          security: { value: "kritisk", note: null, assessedAt: null },
          availability: { value: "god", note: null, assessedAt: null },
          maintainability: { value: "trenger_oppfolging", note: null, assessedAt: null },
        },
      }),
    ]);

    const table = within(matrix());
    expect(table.getByRole("img", { name: "Sikkerhet: Kritisk" })).toBeTruthy();
    expect(table.getByRole("img", { name: "Tilgjengelighet: God" })).toBeTruthy();
    expect(table.getByRole("img", { name: "Vedlikehold og endring: Trenger oppfølging" })).toBeTruthy();
    expect(table.getAllByRole("img", { name: /: Ikke vurdert$/ })).toHaveLength(4);
  });

  it("has seven attribute column headers with full names available", async () => {
    await renderWith([system({ name: "Kontroll" })]);
    const headers = within(matrix()).getAllByRole("columnheader");
    const names = headers.map((header) => header.textContent ?? "");
    expect(names).toEqual(expect.arrayContaining(["Tilgj.", "Pålit.", "Vedl./endr.", "Sikkerh.", "Test", "Utrull.", "Observ."]));
    expect(within(matrix()).getByTitle("Vedlikehold og endring")).toBeTruthy();
  });

  it("does not render the old stacked Vurderinger column", async () => {
    await renderWith([system({ name: "Kontroll" })]);
    expect(screen.queryByRole("columnheader", { name: "Vurderinger" })).toBeNull();
  });

  it("keeps the Backstage link and the edit action in the row", async () => {
    await renderWith([system({ name: "Kontroll", backstageUrl: "https://backstage.example.test/kontroll" })]);
    const link = within(matrix()).getByRole("link", { name: "Åpne Kontroll i Backstage (åpnes i ny fane)" });
    expect(link.getAttribute("href")).toBe("https://backstage.example.test/kontroll");
    expect(within(matrix()).getByRole("button", { name: "Rediger Kontroll" })).toBeTruthy();
  });

  it("omits the edit action for readers without edit rights", async () => {
    await renderWith([system({ name: "Kontroll" })], false);
    expect(screen.queryByRole("button", { name: "Rediger Kontroll" })).toBeNull();
  });
});

describe("Shared explanation dialog (Forklaring)", () => {
  it("opens an accessible dialog that explains all seven attributes and the four statuses", async () => {
    await renderWith([system({ name: "Kontroll" })]);
    await userEvent.click(screen.getByRole("button", { name: "Forklaring" }));

    const dialog = screen.getByRole("dialog", { name: systemsCopy.explanation.title });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    for (const label of ["Tilgjengelighet", "Pålitelighet", "Vedlikehold og endring", "Sikkerhet", "Testbarhet", "Utrullingsbarhet", "Observerbarhet"]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
    for (const status of ["God", "Trenger oppfølging", "Kritisk", "Ikke vurdert"]) {
      expect(within(dialog).getByText(status)).toBeTruthy();
    }
    expect(within(dialog).getByText(systemsCopy.explanation.intro)).toBeTruthy();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    await renderWith([system({ name: "Kontroll" })]);
    const trigger = screen.getByRole("button", { name: "Forklaring" });
    trigger.focus();
    await userEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Search field (icon alignment structure)", () => {
  it("labels the search input and keeps the icon inside the input's own wrapper", async () => {
    await renderWith([system({ name: "Kontroll" })]);
    const input = screen.getByRole("searchbox", { name: systemsCopy.search.label }) as HTMLInputElement;
    const wrapper = input.parentElement as HTMLElement;
    expect(wrapper.className).toContain("relative");
    const icon = wrapper.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(icon.className).toContain("inset-y-0");
    expect(input.className).toContain("pl-10");
  });
});

describe("Progressive-disclosure assessment rows (reference 17)", () => {
  async function openEditForm(systems: TeamSystemView[]) {
    await renderWith(systems);
    await userEvent.click(within(matrix()).getByRole("button", { name: "Rediger Kontroll" }));
    await screen.findByRole("heading", { name: systemsCopy.form.editTitle });
  }

  it("shows seven collapsed rows, each with an info button, and no note fields", async () => {
    await openEditForm([system({ name: "Kontroll" })]);
    const expanders = screen.getAllByRole("button", { expanded: false }).filter((b) => b.getAttribute("aria-controls"));
    expect(expanders).toHaveLength(7);
    expect(screen.queryByRole("textbox", { name: /Begrunnelse/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Forklaring: Sikkerhet" })).toBeTruthy();
  });

  it("expands a row through its chevron and exposes aria-expanded and aria-controls", async () => {
    await openEditForm([system({ name: "Kontroll" })]);
    const chevron = screen.getByRole("button", { name: systemsCopy.form.rowExpand("Sikkerhet") });
    await userEvent.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(chevron.getAttribute("aria-controls") as string);
    expect(panel).toBeTruthy();
    expect(within(panel as HTMLElement).getByRole("textbox", { name: /Begrunnelse \(valgfritt\)/ })).toBeTruthy();
  });

  it("keeps an entered explanation when its row is collapsed and reopened", async () => {
    await openEditForm([system({ name: "Kontroll" })]);
    const chevron = screen.getByRole("button", { name: systemsCopy.form.rowExpand("Sikkerhet") });
    await userEvent.click(chevron);
    await userEvent.setup({ delay: null }).type(screen.getByRole("textbox", { name: /Begrunnelse \(valgfritt\)/ }), "Kjent sårbarhet");
    await userEvent.click(screen.getByRole("button", { name: systemsCopy.form.rowCollapse("Sikkerhet") }));
    await userEvent.click(screen.getByRole("button", { name: systemsCopy.form.rowExpand("Sikkerhet") }));
    expect((screen.getByRole("textbox", { name: /Begrunnelse \(valgfritt\)/ }) as HTMLTextAreaElement).value).toBe("Kjent sårbarhet");
  });

  it("changing the status does not expand or collapse the row and keeps the explanation", async () => {
    await openEditForm([system({ name: "Kontroll" })]);
    const chevron = screen.getByRole("button", { name: systemsCopy.form.rowExpand("Sikkerhet") });
    await userEvent.click(chevron);
    await userEvent.setup({ delay: null }).type(screen.getByRole("textbox", { name: /Begrunnelse \(valgfritt\)/ }), "Begrunnelse");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Vurdering: Sikkerhet" }), "kritisk");
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByRole("textbox", { name: /Begrunnelse \(valgfritt\)/ }) as HTMLTextAreaElement).value).toBe("Begrunnelse");
    expect((screen.getByRole("combobox", { name: "Vurdering: Sikkerhet" }) as HTMLSelectElement).value).toBe("kritisk");
  });

  it("the info button opens its explanation without changing the status", async () => {
    await openEditForm([system({ name: "Kontroll" })]);
    await userEvent.click(screen.getByRole("button", { name: "Forklaring: Sikkerhet" }));
    const dialog = screen.getByRole("dialog", { name: "Sikkerhet" });
    expect(within(dialog).getByText(systemsCopy.qualityPanel.security.body)).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect((screen.getByRole("combobox", { name: "Vurdering: Sikkerhet" }) as HTMLSelectElement).value).toBe("ikke_vurdert");
  });

  it("a row whose note is already saved opens expanded so the explanation is visible", async () => {
    const withNote = system({
      name: "Kontroll",
      assessments: {
        ...system({ name: "x" }).assessments,
        maintainability: { value: "trenger_oppfolging", note: "Teknisk gjeld", assessedAt: null },
      },
    });
    await openEditForm([withNote]);
    expect(screen.getByRole("button", { name: systemsCopy.form.rowCollapse("Vedlikehold og endring") }).getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByRole("textbox", { name: /Begrunnelse \(valgfritt\)/ }) as HTMLTextAreaElement).value).toBe("Teknisk gjeld");
  });
});
