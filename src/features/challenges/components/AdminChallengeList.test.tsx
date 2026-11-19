// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminChallengeList, type AdminChallengeRowActionState } from "./AdminChallengeList";
import type { AdminChallengeView } from "../client/admin-challenges-gateway";

const OPEN_CHALLENGE: AdminChallengeView = {
  challengeId: "c1",
  text: "Deploy process has no clear owner",
  status: "open",
  submittedAt: "2026-01-10",
};

const RESOLVED_CHALLENGE: AdminChallengeView = {
  challengeId: "c2",
  text: "Code review is too slow",
  status: "resolved",
  submittedAt: "2026-01-05",
};

const ARCHIVED_CHALLENGE: AdminChallengeView = {
  challengeId: "c3",
  text: "An old, already-archived friction",
  status: "archived",
  submittedAt: "2025-12-01",
};

function noop() {}

type UserEvent = ReturnType<typeof userEvent.setup>;

/** Row actions other than "Marker som løst" live in "Flere handlinger – <text>". The text is shortened to 40 characters. */
function menuTrigger(text: string): HTMLElement {
  const trimmed = text.trim();
  const short = trimmed.length > 40 ? `${trimmed.slice(0, 40).trimEnd()}…` : trimmed;
  return screen.getByRole("button", { name: `Flere handlinger – ${short}` });
}

async function openMenu(user: UserEvent, text: string) {
  await user.click(menuTrigger(text));
}

function renderList(props: {
  challenges: AdminChallengeView[];
  actions?: Record<string, AdminChallengeRowActionState>;
  onResolve?: (id: string) => void;
  onArchive?: (id: string) => void;
  onRequestDelete?: (id: string) => void;
  onCancelDelete?: (id: string) => void;
  onConfirmDelete?: (id: string) => void;
}) {
  return render(
    <AdminChallengeList
      state={{ status: "loaded", challenges: props.challenges }}
      actions={props.actions ?? {}}
      onResolve={props.onResolve ?? noop}
      onArchive={props.onArchive ?? noop}
      onRequestDelete={props.onRequestDelete ?? noop}
      onCancelDelete={props.onCancelDelete ?? noop}
      onConfirmDelete={props.onConfirmDelete ?? noop}
    />,
  );
}

describe("AdminChallengeList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a loading state via role=status", () => {
    render(
      <AdminChallengeList
        state={{ status: "loading" }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("shows an error state via role=alert", () => {
    render(
      <AdminChallengeList
        state={{ status: "error" }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows an empty state when there are no challenges at all", () => {
    renderList({ challenges: [] });

    expect(screen.getByText(/ingen utfordringer/i)).toBeTruthy();
  });

  it("shows open challenges by default and reveals resolved and archived ones through the status filter", async () => {
    const user = userEvent.setup();
    renderList({ challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE, ARCHIVED_CHALLENGE] });

    expect(screen.getByText(OPEN_CHALLENGE.text)).toBeTruthy();
    expect(screen.queryByText(RESOLVED_CHALLENGE.text)).toBeNull();
    expect(screen.queryByText(ARCHIVED_CHALLENGE.text)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Alle" }));
    expect(screen.getByText(RESOLVED_CHALLENGE.text)).toBeTruthy();
    expect(screen.getByText(ARCHIVED_CHALLENGE.text)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Arkiverte" }));
    expect(screen.queryByText(OPEN_CHALLENGE.text)).toBeNull();
    expect(screen.getByText(ARCHIVED_CHALLENGE.text)).toBeTruthy();
  });

  it("renders each challenge's status label via the shared Badge primitive, not a bare paragraph (BR-10)", () => {
    renderList({ challenges: [OPEN_CHALLENGE] });

    const label = screen.getByText(/^åpen$/i);
    expect(label.tagName).toBe("SPAN");
  });

  it("shows a no-archived empty state when the archived filter has no matches", async () => {
    const user = userEvent.setup();
    renderList({ challenges: [OPEN_CHALLENGE] });

    await user.click(screen.getByRole("button", { name: "Arkiverte" }));

    expect(screen.getByText(/ingen arkiverte utfordringer/i)).toBeTruthy();
  });

  it("renders Marker som løst as the primary action, with Arkiver and Slett in the row menu, for an open challenge", async () => {
    const user = userEvent.setup();
    renderList({ challenges: [OPEN_CHALLENGE] });

    expect(screen.getByRole("button", { name: /marker som løst/i })).toBeTruthy();
    await openMenu(user, OPEN_CHALLENGE.text);
    expect(screen.getByRole("button", { name: "Arkiver" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slett" })).toBeTruthy();
  });

  it("renders only Arkiver and Slett for a resolved challenge — no resolve action", async () => {
    const user = userEvent.setup();
    renderList({ challenges: [RESOLVED_CHALLENGE] });

    await user.click(screen.getByRole("button", { name: "Alle" }));

    expect(screen.queryByRole("button", { name: /marker som løst/i })).toBeNull();
    await openMenu(user, RESOLVED_CHALLENGE.text);
    expect(screen.getByRole("button", { name: "Arkiver" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Slett" })).toBeTruthy();
  });

  it("renders only Slett for an archived challenge — no resolve or archive, and no reopen/unarchive action of any kind", async () => {
    const user = userEvent.setup();
    renderList({ challenges: [ARCHIVED_CHALLENGE] });

    await user.click(screen.getByRole("button", { name: "Arkiverte" }));

    expect(screen.queryByRole("button", { name: /marker som løst/i })).toBeNull();
    await openMenu(user, ARCHIVED_CHALLENGE.text);
    expect(screen.queryByRole("button", { name: "Arkiver" })).toBeNull();
    expect(screen.getByRole("button", { name: "Slett" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /gjenåpne|reopen|un-?arkiver|un-?resolve/i })).toBeNull();
  });

  it("calls onResolve with the challengeId when Marker som løst is clicked", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderList({ challenges: [OPEN_CHALLENGE], onResolve });

    await user.click(screen.getByRole("button", { name: /marker som løst/i }));

    expect(onResolve).toHaveBeenCalledWith("c1");
  });

  it("calls onArchive with the challengeId when Arkiver is chosen from the row menu", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    renderList({ challenges: [OPEN_CHALLENGE], onArchive });

    await openMenu(user, OPEN_CHALLENGE.text);
    await user.click(screen.getByRole("button", { name: "Arkiver" }));

    expect(onArchive).toHaveBeenCalledWith("c1");
  });

  it("requires an explicit confirmation step before deleting, and cancels cleanly without ever calling onConfirmDelete", async () => {
    const user = userEvent.setup();
    const onRequestDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();

    const { rerender } = renderList({
      challenges: [OPEN_CHALLENGE],
      onRequestDelete,
      onCancelDelete,
      onConfirmDelete,
    });

    await openMenu(user, OPEN_CHALLENGE.text);
    await user.click(screen.getByRole("button", { name: "Slett" }));
    expect(onRequestDelete).toHaveBeenCalledWith("c1");
    expect(onConfirmDelete).not.toHaveBeenCalled();

    // Simulate the parent moving the row into confirming_deletion.
    rerender(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{ c1: { status: "confirming_deletion" } }}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={onRequestDelete}
        onCancelDelete={onCancelDelete}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    expect(screen.getByText(/slettes permanent/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /avbryt/i }));
    expect(onCancelDelete).toHaveBeenCalledWith("c1");
    expect(onConfirmDelete).not.toHaveBeenCalled();
  });

  it("calls onConfirmDelete only after the confirmation step", async () => {
    const user = userEvent.setup();
    const onConfirmDelete = vi.fn();

    renderList({
      challenges: [OPEN_CHALLENGE],
      actions: { c1: { status: "confirming_deletion" } },
      onConfirmDelete,
    });

    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));
    expect(onConfirmDelete).toHaveBeenCalledWith("c1");
  });

  it("shows a row-local pending state and disables the row's other actions while resolve is in flight", () => {
    const actions: Record<string, AdminChallengeRowActionState> = {
      c1: { status: "pending", action: "resolve" },
    };
    renderList({ challenges: [OPEN_CHALLENGE], actions });

    const resolveButton = screen.getByRole("button", { name: /markerer/i });
    const menu = menuTrigger(OPEN_CHALLENGE.text);
    expect(resolveButton.hasAttribute("disabled")).toBe(true);
    expect(menu.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/markerer/i);
  });

  it("shows a row-local error state without affecting other rows", () => {
    const actions: Record<string, AdminChallengeRowActionState> = {
      c1: { status: "error", message: "Kunne ikke markere utfordringen som løst. Prøv igjen." },
    };
    renderList({ challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE], actions });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toMatch(/løst/i);
  });

  it("keeps one row's pending state independent of another row's idle state", async () => {
    const user = userEvent.setup();
    const actions: Record<string, AdminChallengeRowActionState> = {
      c1: { status: "pending", action: "archive" },
    };
    renderList({ challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE], actions });

    await user.click(screen.getByRole("button", { name: "Alle" }));

    const resolvedRow = screen.getByText(RESOLVED_CHALLENGE.text).closest("li") as HTMLElement;
    const resolvedMenu = within(resolvedRow).getByRole("button", { name: /^flere handlinger – /i });
    expect(resolvedMenu.hasAttribute("disabled")).toBe(false);
  });

  it("disambiguates same-label row menus with an accessible name naming each row's own challenge", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    const secondOpen: AdminChallengeView = { ...OPEN_CHALLENGE, challengeId: "c5", text: "Second open challenge" };

    renderList({ challenges: [OPEN_CHALLENGE, secondOpen], onArchive });

    // Each row's menu trigger names its own challenge, so a screen-reader user can tell which row an action acts on.
    const firstMenu = menuTrigger(OPEN_CHALLENGE.text);
    const secondMenu = menuTrigger(secondOpen.text);
    expect(firstMenu).not.toBe(secondMenu);

    await user.click(secondMenu);
    await user.click(screen.getByRole("button", { name: "Arkiver" }));
    expect(onArchive).toHaveBeenCalledWith("c5");
  });

  it("truncates a long challenge text down to a concise accessible-name fragment, never the full text", () => {
    const longChallenge: AdminChallengeView = {
      challengeId: "c6",
      text: "This challenge text is deliberately much longer than the concise accessible name fragment should ever include",
      status: "open",
      submittedAt: "2026-01-01",
    };

    renderList({ challenges: [longChallenge] });

    const menu = screen.getByRole("button", { name: /^flere handlinger – /i });
    const accessibleName = menu.getAttribute("aria-label") ?? "";
    expect(accessibleName.length).toBeLessThan(longChallenge.text.length);
    expect(accessibleName).not.toContain(longChallenge.text);
  });

  it("collapses a long challenge text behind an accessible Vis mer toggle, and shows the full text once expanded", async () => {
    const user = userEvent.setup();
    const longText = "Lang beskrivelse. ".repeat(30).trim();
    renderList({ challenges: [{ challengeId: "c7", text: longText, status: "open", submittedAt: "2026-01-01" }] });

    expect(screen.queryByText(longText)).toBeNull();
    const toggle = screen.getByRole("button", { name: "Vis mer" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await user.click(toggle);

    expect(screen.getByText(longText)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vis mindre" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("never renders an identity-shaped value (uid/email/resolvedBy/archivedBy) anywhere in its output", () => {
    const canary: AdminChallengeView = {
      challengeId: "c4",
      text: "Legitimate challenge text",
      status: "open",
      submittedAt: "2026-01-01",
    };
    const { container } = renderList({ challenges: [canary] });

    expect(container.textContent).not.toMatch(/uid/i);
    expect(container.textContent).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
    expect(container.textContent).not.toMatch(/resolvedBy/i);
    expect(container.textContent).not.toMatch(/archivedBy/i);
    expect(container.textContent).not.toMatch(/submitted by|innsender|sendt av/i);
  });

  it("never renders a 'submitted by'/'user'/'member'/'author' label implying the admin can identify the submitter", () => {
    const { container } = renderList({ challenges: [OPEN_CHALLENGE] });

    expect(container.textContent).not.toMatch(/meldt inn av|forfatter|medlem:/i);
  });
});
