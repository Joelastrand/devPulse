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
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(screen.getByText(/ingen utfordringer/i)).toBeTruthy();
  });

  it("groups open/resolved challenges as active and archived challenges separately — archived remains visible", () => {
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE, ARCHIVED_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    const active = screen.getByText(/^aktive$/i).closest("div") as HTMLElement;
    const archived = screen.getByText(/^arkiverte$/i).closest("div") as HTMLElement;

    expect(within(active).getByText(OPEN_CHALLENGE.text)).toBeTruthy();
    expect(within(active).getByText(RESOLVED_CHALLENGE.text)).toBeTruthy();
    expect(within(archived).getByText(ARCHIVED_CHALLENGE.text)).toBeTruthy();
    expect(within(active).queryByText(ARCHIVED_CHALLENGE.text)).toBeNull();
  });

  it("renders each challenge's status label via the shared Badge primitive, not a bare paragraph (BR-10)", () => {
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    const label = screen.getByText(/^åpen$/i);
    expect(label.tagName).toBe("SPAN");
  });

  it("shows a no-archived empty state when only active challenges exist", () => {
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(screen.getByText(/ingen arkiverte utfordringer/i)).toBeTruthy();
  });

  it("renders Marker som løst, Arkiver, and Slett for an open challenge", () => {
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(screen.getByRole("button", { name: /marker som løst/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^arkiver –/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^slett –/i })).toBeTruthy();
  });

  it("renders only Arkiver and Slett for a resolved challenge — no resolve action", () => {
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [RESOLVED_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: /marker som løst/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^arkiver –/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^slett –/i })).toBeTruthy();
  });

  it("renders only Slett for an archived challenge — no resolve or archive, and no reopen/unarchive action of any kind", () => {
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [ARCHIVED_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: /marker som løst/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^arkiver –/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^slett –/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /gjenåpne|reopen|un-?arkiver|un-?resolve/i })).toBeNull();
  });

  it("calls onResolve with the challengeId when Marker som løst is clicked", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{}}
        onResolve={onResolve}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /marker som løst/i }));

    expect(onResolve).toHaveBeenCalledWith("c1");
  });

  it("calls onArchive with the challengeId when Arkiver is clicked", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={onArchive}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^arkiver –/i }));

    expect(onArchive).toHaveBeenCalledWith("c1");
  });

  it("requires an explicit confirmation step before deleting, and cancels cleanly without ever calling onConfirmDelete", async () => {
    const user = userEvent.setup();
    const onRequestDelete = vi.fn();
    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();

    const { rerender } = render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={onRequestDelete}
        onCancelDelete={onCancelDelete}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^slett –/i }));
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

    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{ c1: { status: "confirming_deletion" } }}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={onConfirmDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: /bekreft sletting/i }));
    expect(onConfirmDelete).toHaveBeenCalledWith("c1");
  });

  it("shows a row-local pending state and disables the row's other actions while resolve is in flight", () => {
    const actions: Record<string, AdminChallengeRowActionState> = {
      c1: { status: "pending", action: "resolve" },
    };
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={actions}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    const resolveButton = screen.getByRole("button", { name: /markerer/i });
    const archiveButton = screen.getByRole("button", { name: /^arkiver –/i });
    const deleteButton = screen.getByRole("button", { name: /^slett –/i });
    expect(resolveButton.hasAttribute("disabled")).toBe(true);
    expect(archiveButton.hasAttribute("disabled")).toBe(true);
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
  });

  it("shows a row-local error state without affecting other rows", () => {
    const actions: Record<string, AdminChallengeRowActionState> = {
      c1: { status: "error", message: "Kunne ikke markere utfordringen som løst. Prøv igjen." },
    };
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE] }}
        actions={actions}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toMatch(/løst/i);
  });

  it("keeps one row's pending state independent of another row's idle state", () => {
    const actions: Record<string, AdminChallengeRowActionState> = {
      c1: { status: "pending", action: "archive" },
    };
    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE, RESOLVED_CHALLENGE] }}
        actions={actions}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    const resolvedRow = screen.getByText(RESOLVED_CHALLENGE.text).closest("li") as HTMLElement;
    const resolvedArchiveButton = within(resolvedRow).getByRole("button", { name: /^arkiver –/i });
    expect(resolvedArchiveButton.hasAttribute("disabled")).toBe(false);
  });

  it("disambiguates same-label action buttons across rows with an accessible name naming each row's own challenge", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    const secondOpen: AdminChallengeView = { ...OPEN_CHALLENGE, challengeId: "c5", text: "Second open challenge" };

    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE, secondOpen] }}
        actions={{}}
        onResolve={noop}
        onArchive={onArchive}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    // Two rows each render an "Arkiver" button — their accessible names must
    // differ so a screen-reader user can tell which row a button acts on.
    const firstArchive = screen.getByRole("button", { name: `Arkiver – ${OPEN_CHALLENGE.text}` });
    const secondArchive = screen.getByRole("button", { name: `Arkiver – ${secondOpen.text}` });
    expect(firstArchive).not.toBe(secondArchive);

    await user.click(secondArchive);
    expect(onArchive).toHaveBeenCalledWith("c5");
  });

  it("truncates a long challenge text down to a concise accessible-name fragment, never the full text", () => {
    const longChallenge: AdminChallengeView = {
      challengeId: "c6",
      text: "This challenge text is deliberately much longer than the concise accessible name fragment should ever include",
      status: "open",
      submittedAt: "2026-01-01",
    };

    render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [longChallenge] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: /^slett –/i });
    const accessibleName = deleteButton.getAttribute("aria-label") ?? "";
    expect(accessibleName.length).toBeLessThan(longChallenge.text.length);
    expect(accessibleName).not.toContain(longChallenge.text);
  });

  it("never renders an identity-shaped value (uid/email/resolvedBy/archivedBy) anywhere in its output", () => {
    const canary: AdminChallengeView = {
      challengeId: "c4",
      text: "Legitimate challenge text",
      status: "open",
      submittedAt: "2026-01-01",
    };
    const { container } = render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [canary] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(container.textContent).not.toMatch(/uid/i);
    expect(container.textContent).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
    expect(container.textContent).not.toMatch(/resolvedBy/i);
    expect(container.textContent).not.toMatch(/archivedBy/i);
    expect(container.textContent).not.toMatch(/submitted by|innsender|sendt av/i);
  });

  it("never renders a 'submitted by'/'user'/'member'/'author' label implying the admin can identify the submitter", () => {
    const { container } = render(
      <AdminChallengeList
        state={{ status: "loaded", challenges: [OPEN_CHALLENGE] }}
        actions={{}}
        onResolve={noop}
        onArchive={noop}
        onRequestDelete={noop}
        onCancelDelete={noop}
        onConfirmDelete={noop}
      />,
    );

    expect(container.textContent).not.toMatch(/meldt inn av|forfatter|medlem:/i);
  });
});
