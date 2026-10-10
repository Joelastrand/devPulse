// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();
const optInMock = vi.fn();
const withdrawMock = vi.fn();

vi.mock("../client/team-skills-gateway", () => ({
  fetchSkillContribution: fetchMock,
  optInSkillContribution: optInMock,
  withdrawSkillContribution: withdrawMock,
}));

// Mutable stand-ins prove the panel and the copy read the single policy constants.
const policy = vi.hoisted(() => ({ version: 41, k: 9 }));
vi.mock("../domain/skill-coverage-policy", () => ({
  get SKILL_CONTRIBUTION_NOTICE_VERSION() {
    return policy.version;
  },
  get SKILL_COVERAGE_MIN_CONTRIBUTORS() {
    return policy.k;
  },
}));

const { SkillContributionPanel } = await import("./SkillContributionPanel");

const state = (contributing: boolean, canOptIn = true) => ({ status: "ok", contributing, canOptIn });
const OPT_IN = "Bidra til teamets kompetanseoversikt";
const WITHDRAW = "Slutt å bidra";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  optInMock.mockReset();
  withdrawMock.mockReset();
  policy.version = 41;
  policy.k = 9;
});

describe("SkillContributionPanel", () => {
  it("names the team, states «Du bidrar ikke» and offers an unselected opt-in button", async () => {
    fetchMock.mockResolvedValue(state(false));
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    expect(await screen.findByRole("heading", { name: "Din deltakelse i «Alfa»" })).toBeTruthy();
    expect(await screen.findByText("Du bidrar ikke")).toBeTruthy();
    expect(screen.getByRole("button", { name: OPT_IN })).toBeTruthy();
    expect(screen.queryByRole("button", { name: WITHDRAW })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("tok", "team-1");
    expect(optInMock).not.toHaveBeenCalled();
  });

  it("shows the primary notice with all its points, the team name and the threshold from the policy constant", async () => {
    fetchMock.mockResolvedValue(state(false));
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await screen.findByText("Du bidrar ikke");
    expect(screen.getByRole("heading", { name: "Bidra til teamets kompetanseoversikt?" })).toBeTruthy();
    expect(screen.getByText("Valgfritt – du bestemmer selv, team for team.")).toBeTruthy();
    expect(screen.getByText(/dekker sine kompetansebehov\. Teamet ser aldri nivåene du har satt\./).textContent).toContain("«Alfa»");
    expect(screen.getByText(/grov status per behov \(dekket \/ ikke dekket ennå\), og først når minst 9 bidragsytere/)).toBeTruthy();
    expect(screen.getByText(/^Dette er ikke full anonymitet\./)).toBeTruthy();
    expect(screen.getByText(/Du kan slutte når som helst\. Forlater du teamet, fjernes deltakelsen din; blir du med igjen, må du velge på nytt\./)).toBeTruthy();
  });

  it("keeps the longer explanation in a collapsed, keyboard-operable «Slik fungerer personvernet» disclosure", async () => {
    fetchMock.mockResolvedValue(state(false));
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    const summary = await screen.findByText("Slik fungerer personvernet");
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Teamledere kan endre kompetansebehovene.");
    expect(details.textContent).toContain("minst 9 bidragsytere har vurdert det");
    expect(details.textContent).toContain("egenvurderingen din slettes ikke");

    // A native <summary> is focusable and keyboard-activated by the browser; jsdom only models the activation.
    await user.tab();
    expect(document.activeElement).toBe(summary);
    await user.click(summary);
    expect(details.open).toBe(true);
  });

  it("carries no evaluative words, percentages or unqualified «anonym» in the notice", async () => {
    fetchMock.mockResolvedValue(state(false));
    const { container } = render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);
    await screen.findByText("Du bidrar ikke");

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b(svak|sterk|kritisk|score|rangering|prosent)\w*|%/i);
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (/anonym/i.test(sentence)) expect(sentence).toMatch(/\bikke\b/i);
    }
  });

  it("opts in with the current notice version from the policy constant, then re-reads the server state", async () => {
    fetchMock.mockResolvedValueOnce(state(false)).mockResolvedValueOnce(state(true));
    optInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await user.click(await screen.findByRole("button", { name: OPT_IN }));

    expect(optInMock).toHaveBeenCalledWith("tok", "team-1", 41);
    expect(await screen.findByRole("button", { name: WITHDRAW })).toBeTruthy();
    expect(screen.getByText("Du bidrar")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Du bidrar nå.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends a changed policy version (the constant, not a copy)", async () => {
    policy.version = 42;
    fetchMock.mockResolvedValue(state(false));
    optInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" />);

    await user.click(await screen.findByRole("button", { name: OPT_IN }));
    expect(optInMock).toHaveBeenCalledWith("tok", "team-1", 42);
  });

  it("withdraws without a confirmation dialog and re-reads", async () => {
    fetchMock.mockResolvedValueOnce(state(true)).mockResolvedValueOnce(state(false));
    withdrawMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await user.click(await screen.findByRole("button", { name: WITHDRAW }));

    expect(withdrawMock).toHaveBeenCalledWith("tok", "team-1");
    expect(await screen.findByRole("button", { name: OPT_IN })).toBeTruthy();
    expect(screen.getByText("Du bidrar ikke")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends one request for repeated clicks while pending and shows a pending label", async () => {
    fetchMock.mockResolvedValueOnce(state(false)).mockResolvedValueOnce(state(true));
    const gate = deferred<{ ok: true }>();
    optInMock.mockReturnValue(gate.promise);
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    const button = await screen.findByRole("button", { name: OPT_IN });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    const busy = screen.getByRole("button", { name: "Lagrer…" }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(optInMock).toHaveBeenCalledTimes(1);

    gate.resolve({ ok: true });
    await screen.findByRole("button", { name: WITHDRAW });
    expect(optInMock).toHaveBeenCalledTimes(1);
  });

  it("sends one DELETE for repeated clicks while pending", async () => {
    fetchMock.mockResolvedValueOnce(state(true)).mockResolvedValueOnce(state(false));
    const gate = deferred<{ ok: true }>();
    withdrawMock.mockReturnValue(gate.promise);
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" />);

    const button = await screen.findByRole("button", { name: WITHDRAW });
    await user.click(button);
    await user.click(button);
    expect(withdrawMock).toHaveBeenCalledTimes(1);
    gate.resolve({ ok: true });
    await screen.findByRole("button", { name: OPT_IN });
  });

  it("omits opt-in and gives a reason when the server says canOptIn is false", async () => {
    fetchMock.mockResolvedValue(state(false, false));
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    expect(await screen.findByText("Teamet er deaktivert, så du kan ikke begynne å bidra nå.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: OPT_IN })).toBeNull();
    expect(screen.getByText("Du bidrar ikke")).toBeTruthy();
  });

  it("keeps withdrawal available when contributing although canOptIn is false", async () => {
    fetchMock.mockResolvedValueOnce(state(true, false)).mockResolvedValueOnce(state(false, false));
    withdrawMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await user.click(await screen.findByRole("button", { name: WITHDRAW }));
    expect(withdrawMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Teamet er deaktivert, så du kan ikke begynne å bidra nå.")).toBeTruthy();
  });

  it("renders nothing for a non-member (forbidden), e.g. an app admin", async () => {
    fetchMock.mockResolvedValue({ status: "forbidden" });
    const { container } = render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(""));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fails closed with an alert and retry when the state cannot be read, offering no control", async () => {
    fetchMock.mockResolvedValueOnce({ status: "read_failed" }).mockResolvedValueOnce(state(false));
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    expect((await screen.findByRole("alert")).textContent).toBe("Deltakelsen din kunne ikke lastes akkurat nå.");
    expect(screen.queryByRole("button", { name: OPT_IN })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(await screen.findByRole("button", { name: OPT_IN })).toBeTruthy();
  });

  it("on notice_outdated re-reads and shows the notice again with a plain message, never the code", async () => {
    fetchMock.mockResolvedValue(state(false));
    optInMock.mockResolvedValue({ ok: false, error: "notice_outdated" });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await user.click(await screen.findByRole("button", { name: OPT_IN }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Personvernteksten er oppdatert. Les den og velg på nytt.");
    expect(alert.textContent).not.toMatch(/notice_outdated/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Bidra til teamets kompetanseoversikt?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: OPT_IN })).toBeTruthy();
  });

  it("on team_disabled re-reads and removes the opt-in control", async () => {
    fetchMock.mockResolvedValueOnce(state(false)).mockResolvedValueOnce(state(false, false));
    optInMock.mockResolvedValue({ ok: false, error: "team_disabled" });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await user.click(await screen.findByRole("button", { name: OPT_IN }));

    expect((await screen.findByRole("alert")).textContent).toBe("Teamet er deaktivert, så du kan ikke begynne å bidra.");
    expect(screen.queryByRole("button", { name: OPT_IN })).toBeNull();
  });

  it("keeps the shown state and does not re-read after a persistence failure", async () => {
    fetchMock.mockResolvedValue(state(true));
    withdrawMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await user.click(await screen.findByRole("button", { name: WITHDRAW }));

    expect((await screen.findByRole("alert")).textContent).toBe("Endringen ble ikke lagret. Prøv igjen.");
    expect(screen.getByText("Du bidrar")).toBeTruthy();
    expect(screen.getByRole("button", { name: WITHDRAW })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the re-read after a successful change fails", async () => {
    fetchMock.mockResolvedValueOnce(state(false)).mockResolvedValueOnce({ status: "read_failed" });
    optInMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);

    await user.click(await screen.findByRole("button", { name: OPT_IN }));

    expect((await screen.findByRole("alert")).textContent).toBe("Deltakelsen din kunne ikke lastes akkurat nå.");
    expect(screen.queryByRole("button", { name: OPT_IN })).toBeNull();
    expect(screen.queryByRole("button", { name: WITHDRAW })).toBeNull();
  });

  it("controls each team independently (two panels, separate state)", async () => {
    fetchMock.mockImplementation(async (_token: string, teamId: string) => state(teamId === "team-b"));
    render(
      <>
        <div data-testid="a">
          <SkillContributionPanel teamId="team-a" token="tok" teamName="Alfa" />
        </div>
        <div data-testid="b">
          <SkillContributionPanel teamId="team-b" token="tok" teamName="Beta" />
        </div>
      </>,
    );

    const a = within(await screen.findByTestId("a"));
    const b = within(await screen.findByTestId("b"));
    expect(await a.findByRole("button", { name: OPT_IN })).toBeTruthy();
    expect(await b.findByRole("button", { name: WITHDRAW })).toBeTruthy();
    expect(a.getByRole("heading", { name: "Din deltakelse i «Alfa»" })).toBeTruthy();
    expect(b.getByRole("heading", { name: "Din deltakelse i «Beta»" })).toBeTruthy();
  });

  it("drops a late response for the previous team when remounted for another team", async () => {
    const late = deferred<unknown>();
    fetchMock.mockReturnValueOnce(late.promise).mockResolvedValueOnce(state(false));
    const { rerender } = render(<SkillContributionPanel key="a" teamId="team-a" token="tok" teamName="Alfa" />);
    rerender(<SkillContributionPanel key="b" teamId="team-b" token="tok" teamName="Beta" />);

    expect(await screen.findByRole("button", { name: OPT_IN })).toBeTruthy();
    late.resolve(state(true));
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: WITHDRAW })).toBeNull();
    expect(screen.getByText("Du bidrar ikke")).toBeTruthy();
  });

  it("drops a late response for the previous token when remounted for a new token", async () => {
    const late = deferred<unknown>();
    fetchMock.mockReturnValueOnce(late.promise).mockResolvedValueOnce(state(false));
    const { rerender } = render(<SkillContributionPanel key="t1" teamId="team-a" token="old" teamName="Alfa" />);
    rerender(<SkillContributionPanel key="t2" teamId="team-a" token="new" teamName="Alfa" />);

    expect(await screen.findByRole("button", { name: OPT_IN })).toBeTruthy();
    late.resolve(state(true));
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: WITHDRAW })).toBeNull();
  });

  it("shows no identity, consent timestamp or percentages even if the response carried them", async () => {
    fetchMock.mockResolvedValue({ ...state(true), uid: "u-1", email: "x@example.test", consentedAt: "2026-01-01" });
    const { container } = render(<SkillContributionPanel teamId="team-1" token="tok" teamName="Alfa" />);
    await screen.findByText("Du bidrar");

    expect(container.textContent).not.toMatch(/u-1|example\.test|2026|%/);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
