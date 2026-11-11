// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { TeamSkillStatus } from "./TeamSkillStatus";
import * as gateway from "../client/team-skills-gateway";

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const { useEffect } = await import("react");
  return {
    useAuthGatedResource: (run: (token: string | null) => void) => {
      useEffect(() => {
        run("token-1");
      }, []);
    },
  };
});

describe("TeamSkillStatus", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a derived level by name and marks suppressed skills as not enough data, with no counts", async () => {
    vi.spyOn(gateway, "fetchTeamSkillAggregate").mockResolvedValue({
      status: "ok",
      availability: "available",
      rows: [
        { skillId: "s1", name: "Testing", state: "value", level: 3 },
        { skillId: "s2", name: "Deploy", state: "insufficient_data" },
      ],
    });

    render(<TeamSkillStatus teamId="team-a" />);

    expect(await screen.findByText("Teamnivå 3: Kan selvstendig")).toBeTruthy();
    expect(screen.getByText("Ikke nok data ennå")).toBeTruthy();
    const rows = screen.getByRole("list").textContent ?? "";
    expect(rows).not.toMatch(/bidragsytere|medlemmer|antall/i);
  });

  it("shows the incomplete message instead of any derived value", async () => {
    vi.spyOn(gateway, "fetchTeamSkillAggregate").mockResolvedValue({ status: "incomplete" });

    render(<TeamSkillStatus teamId="team-a" />);

    await waitFor(() => expect(screen.getByText("Statusen kan ikke beregnes for dette teamet.")).toBeTruthy());
    expect(screen.queryByText(/Teamnivå/)).toBeNull();
  });

  it("shows a read failure message and no rows", async () => {
    vi.spyOn(gateway, "fetchTeamSkillAggregate").mockResolvedValue({ status: "read_failed" });

    render(<TeamSkillStatus teamId="team-a" />);

    expect(await screen.findByText("Teamets status kunne ikke lastes. Prøv igjen.")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
