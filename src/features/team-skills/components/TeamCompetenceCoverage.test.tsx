// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchCoverageMock = vi.fn();

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const { useEffect } = await import("react");
  return {
    useAuthGatedResource: (onAuthChange: (token: string | null) => void) => {
      useEffect(() => onAuthChange("token-for-test"), []);
      return { isCurrentGeneration: () => true };
    },
  };
});

vi.mock("../client/team-skills-gateway", () => ({
  fetchSkillCoverage: fetchCoverageMock,
}));

const { TeamCompetenceCoverage } = await import("./TeamCompetenceCoverage");

afterEach(() => {
  cleanup();
  fetchCoverageMock.mockReset();
});

const row = (treeId: string, areaName: string | null, state: string, requiredLevel = 3) => ({
  treeId,
  areaName,
  requiredLevel,
  requiredCoverage: 2,
  state,
});

describe("TeamCompetenceCoverage (TASK-011, categorical team coverage)", () => {
  it("shows each area with its categorical REQ label and a text explanation, not colour alone", async () => {
    fetchCoverageMock.mockResolvedValue({
      status: "available",
      rows: [
        row("t1", "Testing", "covered"),
        row("t2", "Systemdesign", "gap"),
        row("t3", "Sikkerhet", "insufficient_data"),
      ],
    });

    render(<TeamCompetenceCoverage teamId="team-1" />);

    const table = await screen.findByRole("table", { name: "Dekning per kompetanseområde" });
    expect(within(table).getByRole("rowheader", { name: "Testing" })).toBeTruthy();
    expect(within(table).getByText("Dekket")).toBeTruthy();
    expect(within(table).getByText("Behov for utvikling")).toBeTruthy();
    expect(within(table).getByText("Ikke nok grunnlag")).toBeTruthy();
    expect(within(table).getByText("Området vises først når minst 5 bidragsytere har vurdert det.")).toBeTruthy();
    expect(fetchCoverageMock).toHaveBeenCalledWith("token-for-test", "team-1");
  });

  it("renders no counts, averages, scores or percentages inside the coverage table", async () => {
    fetchCoverageMock.mockResolvedValue({ status: "available", rows: [row("t1", "Testing", "covered")] });

    render(<TeamCompetenceCoverage teamId="team-1" />);
    const table = await screen.findByRole("table", { name: "Dekning per kompetanseområde" });

    expect(table.textContent ?? "").not.toMatch(/\d|%|gjennomsnitt|snitt/i);
  });

  it("shows the area's required level by name, never as a number", async () => {
    fetchCoverageMock.mockResolvedValue({ status: "available", rows: [row("t1", "Testing", "covered", 4)] });

    render(<TeamCompetenceCoverage teamId="team-1" />);
    const table = await screen.findByRole("table", { name: "Dekning per kompetanseområde" });

    expect(within(table).getByText("nivå «Avansert» eller høyere")).toBeTruthy();
  });

  it("shows the empty state when the team has no needs yet", async () => {
    fetchCoverageMock.mockResolvedValue({ status: "available", rows: [] });

    render(<TeamCompetenceCoverage teamId="team-1" />);

    expect(await screen.findByText("Teamet har ingen kompetansebehov ennå.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows an incomplete-cohort message without any partial rows", async () => {
    fetchCoverageMock.mockResolvedValue({ status: "incomplete" });

    render(<TeamCompetenceCoverage teamId="team-1" />);

    expect(await screen.findByText("Teamkompetansen kan ikke vises for dette teamet akkurat nå.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("explains that non-members cannot see team coverage and shows no rows", async () => {
    fetchCoverageMock.mockResolvedValue({ status: "forbidden" });

    render(<TeamCompetenceCoverage teamId="team-1" />);

    expect(await screen.findByText("Teamkompetansen vises bare for teamets medlemmer.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers a retry on a read failure and re-reads when pressed", async () => {
    const user = userEvent.setup();
    fetchCoverageMock
      .mockResolvedValueOnce({ status: "read_failed" })
      .mockResolvedValueOnce({ status: "available", rows: [row("t1", "Testing", "covered")] });

    render(<TeamCompetenceCoverage teamId="team-1" />);
    await user.click(await screen.findByRole("button", { name: "Prøv igjen" }));

    expect(await screen.findByRole("table", { name: "Dekning per kompetanseområde" })).toBeTruthy();
    expect(fetchCoverageMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the radar and trend panels disabled with an explanation, and shows no chart", async () => {
    fetchCoverageMock.mockResolvedValue({ status: "available", rows: [] });

    const { container } = render(<TeamCompetenceCoverage teamId="team-1" />);
    await screen.findByText("Teamet har ingen kompetansebehov ennå.");

    const disabled = container.querySelectorAll('[aria-disabled="true"]');
    expect(disabled).toHaveLength(2);
    expect(screen.getByText("Radar")).toBeTruthy();
    expect(screen.getByText("Utvikling over tid")).toBeTruthy();
    expect(container.querySelector("svg, canvas")).toBeNull();
  });
});
