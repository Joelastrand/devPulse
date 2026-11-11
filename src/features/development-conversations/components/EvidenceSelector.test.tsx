// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedEvidenceWire } from "../client/conversations-gateway";

/** Synthetic fixtures only (invariant 15). No real person, team or wellbeing data. */

const fetchEvidenceSourcesMock = vi.fn();
const updateConversationMock = vi.fn();

vi.mock("../client/conversations-gateway", () => ({
  fetchEvidenceSources: fetchEvidenceSourcesMock,
  updateConversation: updateConversationMock,
}));

const { EvidenceSelector } = await import("./EvidenceSelector");

const CONVERSATION_ID = "conv-1";
const VERSION = "2026-10-17T09:30:00.000Z";

function responsibility(id: string, title: string, status: "active" | "completed" = "active") {
  return { kind: "responsibility" as const, id, title, status };
}

function achievement(id: string, title: string) {
  return { kind: "achievement" as const, id, title, status: null };
}

function shared(overrides: Partial<SharedEvidenceWire> & { kind: "responsibility" | "achievement"; title: string }): SharedEvidenceWire {
  const base = {
    description: null,
    relationToRole: "within" as const,
    period: { start: null, end: null },
    capturedAt: "2026-10-01T08:00:00.000Z",
  };
  if (overrides.kind === "responsibility") {
    return { ...base, status: "active", ...overrides } as SharedEvidenceWire;
  }
  return { ...base, description: "Synthetic", outcome: null, ...overrides } as SharedEvidenceWire;
}

function renderSelector(props: { completed?: boolean; sharedEvidence?: SharedEvidenceWire[] } = {}) {
  const onChanged = vi.fn(async () => {});
  const onUnauthenticated = vi.fn();
  render(
    <EvidenceSelector
      conversationId={CONVERSATION_ID}
      token="a-token"
      completed={props.completed ?? false}
      sharedEvidence={props.sharedEvidence ?? []}
      expectedUpdatedAt={VERSION}
      onUnauthenticated={onUnauthenticated}
      onChanged={onChanged}
    />,
  );
  return { onChanged, onUnauthenticated };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  fetchEvidenceSourcesMock.mockReset();
  updateConversationMock.mockReset();
  updateConversationMock.mockResolvedValue({ status: "saved" });
});

describe("EvidenceSelector: owner selection (SPEC BR-40 to BR-45, BR-42 limits)", () => {
  it("lists the owner's records and says that a save replaces the whole set", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({
      status: "ok",
      response: { items: [responsibility("resp-1", "Synthetic ansvar"), achievement("ach-1", "Synthetic bidrag")], truncated: false },
    });
    renderSelector();

    expect(await screen.findByRole("checkbox", { name: /Synthetic ansvar/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /Synthetic bidrag/ })).toBeTruthy();
    expect(screen.getByText(/Ansvar valgt: 0 av 5\. Bidrag valgt: 0 av 5\./)).toBeTruthy();
  });

  it("allows at most five responsibilities and disables the sixth, while achievements keep their own limit", async () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => responsibility(`resp-${n}`, `Synthetic ansvar ${n}`));
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items, truncated: false } });
    const user = userEvent.setup();
    renderSelector();

    for (let n = 1; n <= 5; n += 1) await user.click(await screen.findByRole("checkbox", { name: new RegExp(`Synthetic ansvar ${n}\\b`) }));
    const sixth = screen.getByRole("checkbox", { name: /Synthetic ansvar 6/ });
    expect((sixth as HTMLInputElement).disabled).toBe(true);
    expect(within(sixth.closest("label") as HTMLElement).getByText("Du har nådd grensen for denne typen.")).toBeTruthy();
    expect(screen.getByText(/Ansvar valgt: 5 av 5\./)).toBeTruthy();
  });

  it("previews exactly the selected records before saving", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({
      status: "ok",
      response: { items: [responsibility("resp-1", "Synthetic ansvar"), achievement("ach-1", "Synthetic bidrag")], truncated: false },
    });
    const user = userEvent.setup();
    renderSelector();

    await user.click(await screen.findByRole("checkbox", { name: /Synthetic bidrag/ }));
    const preview = screen.getByRole("heading", { name: "Dette får deltakeren se" }).parentElement as HTMLElement;
    expect(within(preview).getByText("Bidrag: Synthetic bidrag")).toBeTruthy();
    expect(within(preview).queryByText(/Synthetic ansvar/)).toBeNull();
  });

  it("saves the selection as one whole-set write, split by kind, and sends no other key", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({
      status: "ok",
      response: { items: [responsibility("resp-1", "Synthetic ansvar"), achievement("ach-1", "Synthetic bidrag")], truncated: false },
    });
    const user = userEvent.setup();
    const { onChanged } = renderSelector();

    await user.click(await screen.findByRole("checkbox", { name: /Synthetic ansvar/ }));
    await user.click(screen.getByRole("checkbox", { name: /Synthetic bidrag/ }));
    await user.click(screen.getByRole("button", { name: "Lagre delte ansvar og bidrag" }));

    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, {
      sharedEvidence: { responsibilityIds: ["resp-1"], achievementIds: ["ach-1"] },
      expectedUpdatedAt: VERSION,
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not offer a save with nothing selected, so an accidental click never clears the set", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items: [responsibility("resp-1", "Synthetic ansvar")], truncated: false } });
    renderSelector();

    expect(await screen.findByRole("checkbox", { name: /Synthetic ansvar/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Lagre delte ansvar og bidrag" }) as HTMLButtonElement).disabled).toBe(true);
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("starts with nothing selected even when a shared snapshot has the same kind and title as a record", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items: [responsibility("resp-1", "Synthetic ansvar")], truncated: false } });
    renderSelector({ sharedEvidence: [shared({ kind: "responsibility", title: "Synthetic ansvar" })] });

    expect(((await screen.findByRole("checkbox", { name: /Synthetic ansvar/ })) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("Ingen poster er valgt.")).toBeTruthy();
  });

  it("never links a shared snapshot to one of two records with the same title: neither is preselected", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({
      status: "ok",
      response: { items: [responsibility("resp-1", "Synthetic ansvar"), responsibility("resp-2", "Synthetic ansvar")], truncated: false },
    });
    renderSelector({ sharedEvidence: [shared({ kind: "responsibility", title: "Synthetic ansvar" })] });

    const checkboxes = await screen.findAllByRole("checkbox", { name: /Synthetic ansvar/ });
    expect(checkboxes.map((box) => (box as HTMLInputElement).checked)).toEqual([false, false]);
  });

  it("does not match a renamed source to its old snapshot: the new title is not preselected", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items: [responsibility("resp-1", "Renamed ansvar")], truncated: false } });
    renderSelector({ sharedEvidence: [shared({ kind: "responsibility", title: "Original ansvar" })] });

    expect(((await screen.findByRole("checkbox", { name: /Renamed ansvar/ })) as HTMLInputElement).checked).toBe(false);
  });

  it("sends only the record the owner ticked, by its id, when titles are duplicated", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({
      status: "ok",
      response: { items: [responsibility("resp-1", "Synthetic ansvar"), responsibility("resp-2", "Synthetic ansvar")], truncated: false },
    });
    const user = userEvent.setup();
    renderSelector();

    const second = (await screen.findAllByRole("checkbox", { name: /Synthetic ansvar/ }))[1];
    await user.click(second);
    await user.click(screen.getByRole("button", { name: "Lagre delte ansvar og bidrag" }));

    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledTimes(1));
    expect(updateConversationMock.mock.calls[0][2]).toEqual({
      sharedEvidence: { responsibilityIds: ["resp-2"], achievementIds: [] },
      expectedUpdatedAt: VERSION,
    });
  });

  it("asks for confirmation before replacing a non-empty shared set, and sends nothing until the owner confirms", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items: [responsibility("resp-1", "Synthetic ansvar")], truncated: false } });
    const user = userEvent.setup();
    renderSelector({ sharedEvidence: [shared({ kind: "responsibility", title: "Old ansvar" })] });

    await user.click(await screen.findByRole("checkbox", { name: /Synthetic ansvar/ }));
    await user.click(screen.getByRole("button", { name: "Lagre delte ansvar og bidrag" }));

    expect(screen.getByRole("group", { name: "Bekreft at delte poster skal erstattes" })).toBeTruthy();
    expect(screen.getByText(/1 nåværende delt\(e\) post\(er\) fjernes, og 1 valgt\(e\) post\(er\) deles i stedet/)).toBeTruthy();
    expect(updateConversationMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Ja, erstatt delte poster" }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledTimes(1));
    expect(updateConversationMock.mock.calls[0][2]).toEqual({
      sharedEvidence: { responsibilityIds: ["resp-1"], achievementIds: [] },
      expectedUpdatedAt: VERSION,
    });
  });

  it("cancelling the replacement confirmation sends nothing and keeps the selection", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items: [responsibility("resp-1", "Synthetic ansvar")], truncated: false } });
    const user = userEvent.setup();
    renderSelector({ sharedEvidence: [shared({ kind: "responsibility", title: "Old ansvar" })] });

    await user.click(await screen.findByRole("checkbox", { name: /Synthetic ansvar/ }));
    await user.click(screen.getByRole("button", { name: "Lagre delte ansvar og bidrag" }));
    await user.click(screen.getByRole("button", { name: "Avbryt" }));

    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Bekreft at delte poster skal erstattes" })).toBeNull();
    expect(((await screen.findByRole("checkbox", { name: /Synthetic ansvar/ })) as HTMLInputElement).checked).toBe(true);
  });

  it("reports a stale conversation without overwriting, and asks the owner to reread and choose again", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items: [responsibility("resp-1", "Synthetic ansvar")], truncated: false } });
    updateConversationMock.mockResolvedValue({ status: "error", error: "conversation_changed" });
    const user = userEvent.setup();
    const { onChanged } = renderSelector();

    await user.click(await screen.findByRole("checkbox", { name: /Synthetic ansvar/ }));
    await user.click(screen.getByRole("button", { name: "Lagre delte ansvar og bidrag" }));

    expect(await screen.findByText(/Samtalen er endret siden du åpnet den, så ingenting ble lagret/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });


  it("shows the neutral error and keeps the save disabled when the record list cannot be read", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "error", error: "persistence_failed" });
    renderSelector();

    expect(await screen.findByText("Dine ansvar og bidrag kan ikke vises nå. Prøv igjen senere.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Lagre delte ansvar og bidrag" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a truncated list as a notice that saving replaces the whole set", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "ok", response: { items: [responsibility("resp-1", "Synthetic ansvar")], truncated: true } });
    renderSelector();

    expect(await screen.findByText(/Lagring erstatter hele settet/)).toBeTruthy();
  });

  it("refuses an unauthenticated list read by signing the owner out, with no list", async () => {
    fetchEvidenceSourcesMock.mockResolvedValue({ status: "unauthenticated" });
    const { onUnauthenticated } = renderSelector();

    await waitFor(() => expect(onUnauthenticated).toHaveBeenCalled());
  });
});

describe("EvidenceSelector: completed conversations (BR-48, Amendment D)", () => {
  it("offers no selection and no list read, and shows the completion copy", () => {
    renderSelector({ completed: true, sharedEvidence: [shared({ kind: "responsibility", title: "Synthetic ansvar" })] });

    expect(fetchEvidenceSourcesMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Samtalen er fullført. Du kan bare fjerne alle delte ansvar og bidrag.")).toBeTruthy();
  });

  it("offers only the whole-set clear, which sends exactly two empty arrays after confirmation", async () => {
    const user = userEvent.setup();
    renderSelector({ completed: true, sharedEvidence: [shared({ kind: "responsibility", title: "Synthetic ansvar" })] });

    await user.click(screen.getByRole("button", { name: "Fjern alle delte ansvar og bidrag" }));
    expect(updateConversationMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ja, fjern alle delte poster" }));
    await waitFor(() => expect(updateConversationMock).toHaveBeenCalledTimes(1));
    expect(updateConversationMock).toHaveBeenCalledWith("a-token", CONVERSATION_ID, {
      sharedEvidence: { responsibilityIds: [], achievementIds: [] },
      expectedUpdatedAt: VERSION,
    });
  });

  it("states how many shared items a clear removes, and sends nothing when the owner cancels", async () => {
    const user = userEvent.setup();
    renderSelector({ completed: true, sharedEvidence: [shared({ kind: "responsibility", title: "A" }), shared({ kind: "achievement", title: "B" })] });

    await user.click(screen.getByRole("button", { name: "Fjern alle delte ansvar og bidrag" }));
    expect(screen.getByText("2 delt(e) post(er) fjernes for deltakeren. Deltakeren kan allerede ha sett innholdet.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(updateConversationMock).not.toHaveBeenCalled();
  });

  it("shows no clear action when nothing is shared", () => {
    renderSelector({ completed: true, sharedEvidence: [] });
    expect(screen.queryByRole("button", { name: "Fjern alle delte ansvar og bidrag" })).toBeNull();
  });
});
