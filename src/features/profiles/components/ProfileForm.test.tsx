// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const observeIdTokenMock = vi.fn();
const fetchOwnProfileMock = vi.fn();
const saveOwnProfileMock = vi.fn();
const removeOwnProfileMock = vi.fn();

vi.mock("../../auth/client/auth-client", () => ({
  observeIdToken: observeIdTokenMock,
}));

vi.mock("../client/profile-gateway", () => ({
  fetchOwnProfile: fetchOwnProfileMock,
  saveOwnProfile: saveOwnProfileMock,
  removeOwnProfile: removeOwnProfileMock,
}));

const { ProfileForm } = await import("./ProfileForm");

function subscribingWith(token: string | null) {
  return (callback: (token: string | null) => void) => {
    callback(token);
    return () => {};
  };
}

function field() {
  return screen.getByLabelText("Visningsnavn") as HTMLInputElement;
}

async function renderLoaded(displayName: string | null) {
  observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
  fetchOwnProfileMock.mockResolvedValue({ status: "ok", displayName });
  render(<ProfileForm />);
  await screen.findByLabelText("Visningsnavn");
}

afterEach(() => {
  cleanup();
  observeIdTokenMock.mockReset();
  fetchOwnProfileMock.mockReset();
  saveOwnProfileMock.mockReset();
  removeOwnProfileMock.mockReset();
});

describe("ProfileForm — loading and states", () => {
  it("shows a Norwegian loading state before auth resolves", () => {
    observeIdTokenMock.mockImplementation(() => () => {});

    render(<ProfileForm />);

    expect(screen.getByRole("status").textContent).toMatch(/laster/i);
  });

  it("prompts sign-in when signed out and never fetches", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith(null));

    render(<ProfileForm />);

    const link = await screen.findByRole("link", { name: /logg inn/i });
    expect(link.getAttribute("href")).toBe("/sign-in");
    expect(fetchOwnProfileMock).not.toHaveBeenCalled();
  });

  it("prompts sign-in when the server reports the session as unauthenticated", async () => {
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnProfileMock.mockResolvedValue({ status: "unauthenticated" });

    render(<ProfileForm />);

    expect(await screen.findByRole("link", { name: /logg inn/i })).toBeTruthy();
  });

  it("loads an existing display name into the field and shows it as the current name", async () => {
    await renderLoaded("Anna Berg");

    expect(field().value).toBe("Anna Berg");
    expect(screen.getByText(/nåværende visningsnavn/i).textContent).toContain("Anna Berg");
    expect(fetchOwnProfileMock).toHaveBeenCalledWith("a-token");
  });

  it("treats displayName: null as a normal state — empty field, never pre-filled from e-mail, no error", async () => {
    await renderLoaded(null);

    expect(field().value).toBe("");
    expect(screen.getByText(/har ikke satt et visningsnavn/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /fjern visningsnavn/i })).toBeNull();
    expect(document.body.textContent).not.toContain("@");
  });

  it("shows a generic error with a retry that reloads successfully", async () => {
    const user = userEvent.setup();
    observeIdTokenMock.mockImplementation(subscribingWith("a-token"));
    fetchOwnProfileMock.mockResolvedValueOnce({ status: "read_failed" });
    render(<ProfileForm />);

    expect((await screen.findByRole("alert")).textContent).toMatch(/noe gikk galt/i);
    fetchOwnProfileMock.mockResolvedValueOnce({ status: "ok", displayName: "Anna Berg" });
    await user.click(screen.getByRole("button", { name: /prøv igjen/i }));

    expect(await screen.findByLabelText("Visningsnavn")).toBeTruthy();
    expect(field().value).toBe("Anna Berg");
    expect(fetchOwnProfileMock).toHaveBeenCalledTimes(2);
  });

  it("explains who can see the name, without promising secrecy or calling it a directory", async () => {
    await renderLoaded(null);

    const help = screen.getByText(/vises for andre medlemmer i team du tilhører, og for administratorer/i);
    expect(help.textContent).toMatch(/ikke.*e-postadressen/i);
    expect(help.textContent).toMatch(/trenger ikke å være unikt/i);
    expect(document.body.textContent).not.toMatch(/anonym|kun du|bare du ser|offentlig/i);
  });
});

describe("ProfileForm — save", () => {
  it("has a visible, associated label and keyboard-operable submit", async () => {
    await renderLoaded(null);

    expect(field().getAttribute("id")).toBe("display-name");
    expect(screen.getByText("Visningsnavn").tagName).toBe("LABEL");
    expect(field().getAttribute("aria-describedby")).toBeTruthy();
    expect(field().getAttribute("autocomplete")).toBe("nickname");
  });

  it("sends exactly the typed value and then shows the server's canonical value", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: true, displayName: "Anna Berg" });
    await renderLoaded(null);

    await user.type(field(), "  Anna    Berg ");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect(saveOwnProfileMock).toHaveBeenCalledWith("a-token", "  Anna    Berg ");
    await waitFor(() => expect(field().value).toBe("Anna Berg"));
    expect(screen.getByText("Visningsnavnet er lagret.")).toBeTruthy();
    expect(screen.getByText(/nåværende visningsnavn/i).textContent).toContain("Anna Berg");
  });

  it("can change an existing name", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: true, displayName: "Anna B" });
    await renderLoaded("Anna Berg");

    await user.clear(field());
    await user.type(field(), "Anna B");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    await waitFor(() => expect(saveOwnProfileMock).toHaveBeenCalledWith("a-token", "Anna B"));
    expect(await screen.findByText("Visningsnavnet er lagret.")).toBeTruthy();
  });

  it("submits with the Enter key", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: true, displayName: "Anna" });
    await renderLoaded(null);

    await user.type(field(), "Anna{Enter}");

    expect(saveOwnProfileMock).toHaveBeenCalledWith("a-token", "Anna");
  });

  it("does not call the server for an empty or whitespace-only value, and says so", async () => {
    const user = userEvent.setup();
    await renderLoaded(null);

    await user.type(field(), "   ");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/skriv inn et visningsnavn/i);
    expect(saveOwnProfileMock).not.toHaveBeenCalled();
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  it("lets the server decide everything else: a one-character name is sent and the server's rejection is shown in plain Norwegian, keeping the input", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: false, error: "invalid_input" });
    await renderLoaded(null);

    await user.type(field(), "A");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    const alert = await screen.findByRole("alert");
    expect(saveOwnProfileMock).toHaveBeenCalledWith("a-token", "A");
    expect(alert.textContent).toMatch(/ikke gyldig.*2–50 tegn/i);
    expect(alert.textContent).not.toMatch(/nfc|unicode|\\p|invalid_input|invalid_request|firestore/i);
    expect(field().value).toBe("A");
  });

  it("does not block names the server would accept: 50 astral characters (100 UTF-16 units) and non-Latin text are sent as typed", async () => {
    const user = userEvent.setup();
    const astral = "\u{1d538}".repeat(50);
    saveOwnProfileMock.mockResolvedValue({ ok: true, displayName: astral });
    await renderLoaded(null);

    await user.click(field());
    await user.paste(astral);
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect(field().getAttribute("maxlength")).toBeNull();
    expect(saveOwnProfileMock).toHaveBeenCalledWith("a-token", astral);

    await user.clear(field());
    await user.paste("李小龍 محمد");
    await user.click(screen.getByRole("button", { name: "Lagre" }));
    expect(saveOwnProfileMock).toHaveBeenLastCalledWith("a-token", "李小龍 محمد");
  });

  it("shows a generic error for a server failure without exposing internals, and keeps the typed value", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    await renderLoaded(null);

    await user.type(field(), "Anna");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/noe gikk galt/i);
    expect(alert.textContent).not.toMatch(/persistence_failed|firestore|500/i);
    expect(field().value).toBe("Anna");
  });

  it("asks the user to sign in again when the session has expired during save", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: false, error: "unauthenticated" });
    await renderLoaded(null);

    await user.type(field(), "Anna");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/logge inn på nytt/i);
  });

  it("clears the previous success or error message as soon as the user edits again", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: true, displayName: "Anna" });
    await renderLoaded(null);
    await user.type(field(), "Anna");
    await user.click(screen.getByRole("button", { name: "Lagre" }));
    await screen.findByText("Visningsnavnet er lagret.");

    await user.type(field(), "x");

    expect(screen.queryByText("Visningsnavnet er lagret.")).toBeNull();
  });

  it("blocks a second submit while one save is in flight and shows the pending state", async () => {
    const user = userEvent.setup();
    let resolveSave: (value: unknown) => void = () => {};
    saveOwnProfileMock.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await renderLoaded("Anna Berg");

    await user.click(screen.getByRole("button", { name: "Lagre" }));
    const saving = screen.getByRole("button", { name: "Lagrer…" }) as HTMLButtonElement;
    await user.click(saving);
    await user.type(field(), "{Enter}");

    expect(saveOwnProfileMock).toHaveBeenCalledTimes(1);
    expect(saving.disabled).toBe(true);
    expect(saving.getAttribute("aria-busy")).toBe("true");

    resolveSave({ ok: true, displayName: "Anna Berg" });
    await screen.findByText("Visningsnavnet er lagret.");
  });

  it("shows nothing the server has not confirmed (no optimistic current name while saving)", async () => {
    const user = userEvent.setup();
    let resolveSave: (value: unknown) => void = () => {};
    saveOwnProfileMock.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await renderLoaded(null);

    await user.type(field(), "Anna");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect(screen.getByText(/har ikke satt et visningsnavn/i)).toBeTruthy();
    resolveSave({ ok: false, error: "invalid_input" });
    await screen.findByRole("alert");
    expect(screen.getByText(/har ikke satt et visningsnavn/i)).toBeTruthy();
  });
});

describe("ProfileForm — remove", () => {
  it("removes only the display name and returns to the normal 'no name' state", async () => {
    const user = userEvent.setup();
    removeOwnProfileMock.mockResolvedValue({ ok: true });
    await renderLoaded("Anna Berg");

    await user.click(screen.getByRole("button", { name: "Fjern visningsnavn" }));

    expect(removeOwnProfileMock).toHaveBeenCalledWith("a-token");
    expect(await screen.findByText("Visningsnavnet er fjernet.")).toBeTruthy();
    expect(field().value).toBe("");
    expect(screen.getByText(/har ikke satt et visningsnavn/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /fjern visningsnavn/i })).toBeNull();
  });

  it("makes clear that this is not account deletion or leaving a team", async () => {
    await renderLoaded("Anna Berg");

    const hint = screen.getByText(/fjerner bare visningsnavnet ditt/i);
    expect(hint.textContent).toMatch(/kontoen din og teammedlemskapene dine påvirkes ikke/i);
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons.join(" ")).not.toMatch(/slett|konto|forlat/i);
  });

  it("needs no confirmation dialog (one click removes the name)", async () => {
    const user = userEvent.setup();
    removeOwnProfileMock.mockResolvedValue({ ok: true });
    await renderLoaded("Anna Berg");

    await user.click(screen.getByRole("button", { name: "Fjern visningsnavn" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(removeOwnProfileMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the name and shows a generic error when removal fails", async () => {
    const user = userEvent.setup();
    removeOwnProfileMock.mockResolvedValue({ ok: false, error: "persistence_failed" });
    await renderLoaded("Anna Berg");

    await user.click(screen.getByRole("button", { name: "Fjern visningsnavn" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/noe gikk galt/i);
    expect(screen.getByText(/nåværende visningsnavn/i).textContent).toContain("Anna Berg");
  });

  it("blocks save and remove from competing: while one is pending the other cannot fire", async () => {
    const user = userEvent.setup();
    let resolveRemove: (value: unknown) => void = () => {};
    removeOwnProfileMock.mockImplementation(() => new Promise((resolve) => { resolveRemove = resolve; }));
    await renderLoaded("Anna Berg");

    await user.click(screen.getByRole("button", { name: "Fjern visningsnavn" }));
    const removing = screen.getByRole("button", { name: "Fjerner…" }) as HTMLButtonElement;
    const save = screen.getByRole("button", { name: "Lagre" }) as HTMLButtonElement;
    await user.click(save);
    await user.click(removing);

    expect(removing.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    expect(saveOwnProfileMock).not.toHaveBeenCalled();
    expect(removeOwnProfileMock).toHaveBeenCalledTimes(1);

    resolveRemove({ ok: true });
    await screen.findByText("Visningsnavnet er fjernet.");
  });

  it("blocks remove while a save is pending", async () => {
    const user = userEvent.setup();
    let resolveSave: (value: unknown) => void = () => {};
    saveOwnProfileMock.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
    await renderLoaded("Anna Berg");

    await user.click(screen.getByRole("button", { name: "Lagre" }));
    const remove = screen.getByRole("button", { name: "Fjern visningsnavn" }) as HTMLButtonElement;
    await user.click(remove);

    expect(remove.disabled).toBe(true);
    expect(removeOwnProfileMock).not.toHaveBeenCalled();

    resolveSave({ ok: true, displayName: "Anna Berg" });
    await screen.findByText("Visningsnavnet er lagret.");
  });
});

describe("ProfileForm — safety", () => {
  it("renders a hostile display name as inert text, never as HTML", async () => {
    await renderLoaded("<img src=x onerror=alert(1)> <script>alert(1)</script>");

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/nåværende visningsnavn/i).textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("never sends a uid or e-mail: the gateway only ever receives the token and the typed name", async () => {
    const user = userEvent.setup();
    saveOwnProfileMock.mockResolvedValue({ ok: true, displayName: "Anna" });
    await renderLoaded(null);

    await user.type(field(), "Anna");
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    expect(saveOwnProfileMock.mock.calls[0]).toEqual(["a-token", "Anna"]);
  });

  it("ignores a stale response that resolves after the user has signed out", async () => {
    let emit: (token: string | null) => void = () => {};
    observeIdTokenMock.mockImplementation((callback: (token: string | null) => void) => {
      emit = callback;
      return () => {};
    });
    let resolveFetch: (value: unknown) => void = () => {};
    fetchOwnProfileMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    render(<ProfileForm />);
    emit("a-token");
    emit(null);

    resolveFetch({ status: "ok", displayName: "Anna Berg" });

    expect(await screen.findByRole("link", { name: /logg inn/i })).toBeTruthy();
    expect(screen.queryByLabelText("Visningsnavn")).toBeNull();
  });
});
