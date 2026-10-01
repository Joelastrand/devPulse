// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchTeamRosterMock = vi.fn();

vi.mock("../client/team-roster-gateway", () => ({
  fetchTeamRoster: fetchTeamRosterMock,
}));

const { TeamRosterSection } = await import("./TeamRosterSection");

function ok(members: Array<{ displayName: string | null; isLead: boolean; isSelf: boolean }>, truncated = false) {
  fetchTeamRosterMock.mockResolvedValue({ status: "ok", members, truncated });
}

function toggle() {
  return screen.getByRole("button", { name: /medlemsliste/i });
}

async function openRoster() {
  const user = userEvent.setup();
  render(<TeamRosterSection teamId="team-1" token="a-token" />);
  await user.click(toggle());
  return user;
}

afterEach(() => {
  cleanup();
  fetchTeamRosterMock.mockReset();
});

describe("TeamRosterSection — disclosure", () => {
  it("is collapsed initially, exposes that state, and makes no request", () => {
    render(<TeamRosterSection teamId="team-1" token="a-token" />);

    expect(screen.getByRole("heading", { name: "Medlemmer" })).toBeTruthy();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list")).toBeNull();
    expect(fetchTeamRosterMock).not.toHaveBeenCalled();
  });

  it("fetches lazily on the first expand, with the token and team, and exposes the expanded state", async () => {
    ok([{ displayName: "Anna Berg", isLead: false, isSelf: false }]);

    await openRoster();

    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(fetchTeamRosterMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamRosterMock).toHaveBeenCalledWith("a-token", "team-1");
    expect(await screen.findByText("Anna Berg")).toBeTruthy();
  });

  it("collapses again and re-expands without refetching", async () => {
    ok([{ displayName: "Anna Berg", isLead: false, isSelf: false }]);
    const user = await openRoster();
    await screen.findByText("Anna Berg");

    await user.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Anna Berg")).toBeNull();

    await user.click(toggle());
    expect(await screen.findByText("Anna Berg")).toBeTruthy();
    expect(fetchTeamRosterMock).toHaveBeenCalledTimes(1);
  });

  it("is operable from the keyboard (Enter and Space) and the toggle controls its panel", async () => {
    ok([]);
    const user = userEvent.setup();
    render(<TeamRosterSection teamId="team-1" token="a-token" />);

    toggle().focus();
    await user.keyboard("{Enter}");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await user.keyboard(" ");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    const panelId = toggle().getAttribute("aria-controls");
    expect(panelId && document.getElementById(panelId)).toBeTruthy();
  });

  it("is a labelled region named by its heading", () => {
    render(<TeamRosterSection teamId="team-1" token="a-token" />);

    expect(screen.getByRole("region", { name: "Medlemmer" })).toBeTruthy();
  });
});

describe("TeamRosterSection — content", () => {
  it("shows names, and 'Medlem uten navn' for a member without one", async () => {
    ok([
      { displayName: "Anna Berg", isLead: false, isSelf: false },
      { displayName: null, isLead: false, isSelf: false },
    ]);

    await openRoster();

    const list = await screen.findByRole("list", { name: "Medlemmer i teamet" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Anna Berg", "Medlem uten navn"]);
  });

  it("marks a lead and the caller themselves with visible text — and only those", async () => {
    ok([
      { displayName: "Lea", isLead: true, isSelf: false },
      { displayName: "Per", isLead: false, isSelf: true },
      { displayName: "Ola", isLead: false, isSelf: false },
    ]);

    await openRoster();

    const items = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(items[0].textContent).toBe("LeaTeamlead");
    expect(items[1].textContent).toBe("PerDeg");
    expect(items[2].textContent).toBe("Ola");
  });

  it("lets one member be both lead and self", async () => {
    ok([{ displayName: "Lea", isLead: true, isSelf: true }]);

    await openRoster();

    const item = within(await screen.findByRole("list")).getByRole("listitem");
    expect(within(item).getByText("Teamlead")).toBeTruthy();
    expect(within(item).getByText("Deg")).toBeTruthy();
  });

  it("shows two members with the same name as two separate rows", async () => {
    ok([
      { displayName: "Anna", isLead: false, isSelf: false },
      { displayName: "Anna", isLead: false, isSelf: false },
    ]);

    await openRoster();

    expect(await screen.findAllByText("Anna")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows a neutral empty state for an empty roster, with no add-member action", async () => {
    ok([]);

    await openRoster();

    expect(await screen.findByText("Ingen medlemmer å vise.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("states that a truncated list is incomplete, without pagination or a load-more action", async () => {
    ok([{ displayName: "Anna", isLead: false, isSelf: false }], true);

    await openRoster();

    expect((await screen.findByRole("status")).textContent).toMatch(/ikke fullstendig/i);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(fetchTeamRosterMock).toHaveBeenCalledTimes(1);
  });

  it("does not show a truncation notice for a complete roster", async () => {
    ok([{ displayName: "Anna", isLead: false, isSelf: false }]);

    await openRoster();

    await screen.findByText("Anna");
    expect(screen.queryByText(/ikke fullstendig/i)).toBeNull();
  });
});

describe("TeamRosterSection — loading and errors", () => {
  it("shows a local loading state while the roster is being fetched", async () => {
    fetchTeamRosterMock.mockImplementation(() => new Promise(() => {}));

    await openRoster();

    expect(screen.getByRole("status").textContent).toMatch(/laster medlemmer/i);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("shows a generic error for a failed read and recovers with retry", async () => {
    fetchTeamRosterMock.mockResolvedValueOnce({ status: "read_failed" });
    const user = await openRoster();

    expect((await screen.findByRole("alert")).textContent).toMatch(/noe gikk galt/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/read_failed|500|firestore/i);

    ok([{ displayName: "Anna", isLead: false, isSelf: false }]);
    await user.click(screen.getByRole("button", { name: /prøv igjen/i }));

    expect(await screen.findByText("Anna")).toBeTruthy();
    expect(fetchTeamRosterMock).toHaveBeenCalledTimes(2);
  });

  it("explains lost access for a forbidden result and offers no retry or data from elsewhere", async () => {
    fetchTeamRosterMock.mockResolvedValue({ status: "forbidden" });

    await openRoster();

    expect((await screen.findByRole("alert")).textContent).toMatch(/ikke tilgang/i);
    expect(screen.queryByRole("button", { name: /prøv igjen/i })).toBeNull();
  });

  it("treats an unauthenticated result as a generic error with retry", async () => {
    fetchTeamRosterMock.mockResolvedValue({ status: "unauthenticated" });

    await openRoster();

    expect((await screen.findByRole("alert")).textContent).toMatch(/noe gikk galt/i);
  });

  it("does not update after unmount if a pending fetch resolves later", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchTeamRosterMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const user = userEvent.setup();
    const { unmount } = render(<TeamRosterSection teamId="team-1" token="a-token" />);
    await user.click(toggle());

    unmount();
    resolveFetch({ status: "ok", members: [{ displayName: "Anna", isLead: false, isSelf: false }], truncated: false });
    await Promise.resolve();

    expect(screen.queryByText("Anna")).toBeNull();
  });
});

describe("TeamRosterSection — safety", () => {
  it("renders a hostile display name as inert text, never as HTML", async () => {
    ok([{ displayName: "<img src=x onerror=alert(1)> <script>alert(1)</script>", isLead: false, isSelf: false }]);

    await openRoster();

    const item = await screen.findByRole("listitem");
    expect(item.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("offers no member links, buttons or actions — rows are plain text", async () => {
    ok([
      { displayName: "Lea", isLead: true, isSelf: false },
      { displayName: "Per", isLead: false, isSelf: true },
    ]);

    await openRoster();

    const list = await screen.findByRole("list");
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
  });

  it("renders no e-mail or identifier-looking value, and makes only the roster request", async () => {
    ok([{ displayName: "Anna", isLead: false, isSelf: false }, { displayName: null, isLead: false, isSelf: false }]);

    await openRoster();

    await screen.findByText("Anna");
    expect(document.body.textContent).not.toMatch(/@|uid|__/i);
    expect(fetchTeamRosterMock).toHaveBeenCalledTimes(1);
    expect(fetchTeamRosterMock.mock.calls[0]).toEqual(["a-token", "team-1"]);
  });
});
