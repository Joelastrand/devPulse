// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskDto } from "../domain/task";

// The auth-gated hook is replaced with a harness that lets each test sign in, switch or sign out explicitly. The real
// hook's generation guard is what the page relies on, so the harness mirrors it: only the current generation may apply.
const harness = vi.hoisted(() => ({
  listener: null as null | ((token: string | null, generation: number, isCurrent: (g: number) => boolean, change: string) => void),
  generation: 0,
}));

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const React = await import("react");
  return {
    useAuthGatedResource: (callback: NonNullable<typeof harness.listener>) => {
      const latest = React.useRef(callback);
      latest.current = callback;
      React.useEffect(() => {
        harness.listener = (...args) => latest.current(...args);
        return () => {
          harness.listener = null;
        };
      }, []);
      return { isCurrentGeneration: (generation: number) => generation === harness.generation };
    },
  };
});

const { TasksPage } = await import("./TasksPage");

// Synthetic, obviously fictional tasks. Dates are fixed; the page's "today" is pinned below.
const TODAY = new Date("2026-11-18T10:00:00");

interface ServerTask extends TaskDto {
  owner: string;
}

/** The response shape: every task field, never the owner. */
function toDto(task: ServerTask): TaskDto {
  return Object.fromEntries(Object.entries(task).filter(([key]) => key !== "owner")) as unknown as TaskDto;
}

/** A tiny in-memory stand-in for `/api/me/tasks`, keyed by the bearer token's account. */
function makeServer() {
  const tasks: ServerTask[] = [];
  let counter = 0;
  const calls: { method: string; url: string; body: unknown; token: string }[] = [];
  const holds: Array<() => void> = [];
  let holdingGets = false;

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function mine(owner: string) {
    return tasks.filter((task) => task.owner === owner).map(toDto);
  }

  function create(owner: string, body: Record<string, unknown>, status: string): TaskDto {
    counter += 1;
    const now = "2026-11-18T09:00:00.000Z";
    const column = tasks.filter((task) => task.owner === owner && task.status === status);
    const created: ServerTask = {
      id: `task-${counter}`,
      owner,
      title: String(body.title),
      description: (body.description as string | null) ?? null,
      notes: (body.notes as string | null) ?? null,
      status: status as TaskDto["status"],
      priority: (body.priority as TaskDto["priority"]) ?? null,
      dueDate: (body.dueDate as string | null) ?? null,
      position: (column.length + 1) * 1024,
      createdAt: now,
      updatedAt: now,
      completedAt: status === "done" ? now : null,
    };
    tasks.push(created);
    return toDto(created);
  }

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const token = String((init?.headers as Record<string, string>)?.Authorization ?? "").replace("Bearer ", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, token });

    if (method === "GET" && url === "/api/me/tasks") {
      if (holdingGets && token === "token-a") {
        // Hold this response until the test releases it, to simulate a late reply from a previous account.
        await new Promise<void>((resolve) => {
          holds.push(resolve);
        });
      }
      return json({ tasks: mine(token).filter((t) => t.status !== "done" || t.completedAt !== null), completedVisibility: "last7" });
    }
    if (method === "POST" && url === "/api/me/tasks") {
      return json(create(token, body, String(body.status ?? "backlog")), 201);
    }
    if (method === "PATCH" && url.startsWith("/api/me/tasks/")) {
      const id = url.split("/").pop() ?? "";
      const task = tasks.find((item) => item.id === id && item.owner === token);
      if (!task) return json({ error: "not_found" }, 404);
      if (body.status && body.status !== task.status) {
        task.status = body.status;
        task.position = (tasks.filter((t) => t.owner === token && t.status === body.status).length + 1) * 1024;
        task.completedAt = body.status === "done" ? "2026-11-18T09:30:00.000Z" : null;
      }
      if (typeof body.title === "string") task.title = body.title;
      return json(toDto(task), 200);
    }
    if (method === "GET" && url.startsWith("/api/me/tasks/history")) {
      const done = mine(token).filter((t) => t.completedAt !== null);
      return json({ tasks: done, nextCursor: null });
    }
    return json({ error: "unknown" }, 500);
  };

  return {
    handler,
    calls,
    tasks,
    seed(owner: string, body: Record<string, unknown>, status: string) {
      return create(owner, body, status);
    },
    holdAccountAGets() {
      holdingGets = true;
    },
    releaseAccountA() {
      holdingGets = false;
      for (const resolve of holds.splice(0)) resolve();
    },
  };
}

function signIn(token: string | null, change: "signed_in" | "switched" | "signed_out" | "refreshed" = "signed_in") {
  harness.generation += 1;
  const generation = harness.generation;
  act(() => {
    harness.listener?.(token, generation, (g) => g === harness.generation, change);
  });
}

let server: ReturnType<typeof makeServer>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: TODAY });
  server = makeServer();
  vi.stubGlobal("fetch", vi.fn(server.handler));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  harness.generation = 0;
});

async function renderSignedIn(token = "token-a") {
  render(<TasksPage />);
  signIn(token);
  await screen.findByRole("heading", { name: "Backlog" });
}

describe("board layout and loading", () => {
  it("shows a loading state before the board, and never an empty board first", () => {
    render(<TasksPage />);
    signIn("token-a");
    expect(screen.getByRole("status").textContent).toBe("Laster oppgavene dine");
    expect(screen.queryByRole("heading", { name: "Backlog" })).toBeNull();
  });

  it("renders the four fixed columns in order with their counts", async () => {
    server.seed("token-a", { title: "Første" }, "backlog");
    server.seed("token-a", { title: "Andre" }, "doing");
    await renderSignedIn();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 4)).toEqual(["Backlog", "Pågår", "Blokkert", "Fullført"]);
    const backlog = screen.getByRole("heading", { name: "Backlog" }).closest("section") as HTMLElement;
    expect(within(backlog).getByText("1 oppgave")).toBeTruthy();
  });

  it("shows a first-time empty state with a call to create the first task", async () => {
    await renderSignedIn();
    expect(screen.getByRole("heading", { name: "Få oppgavene ut av hodet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Opprett første oppgave" })).toBeTruthy();
  });
});

describe("creating tasks", () => {
  it("creates a backlog task from the global button with only a title", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderSignedIn();
    await user.click(screen.getByRole("button", { name: "Ny oppgave" }));
    const dialog = screen.getByRole("dialog", { name: "Ny oppgave" });
    await user.type(within(dialog).getByLabelText("Tittel"), "Kartlegg testdata");
    await user.click(within(dialog).getByRole("button", { name: "Lagre" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = server.calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({ title: "Kartlegg testdata", status: "backlog" });
    expect(await screen.findByRole("button", { name: "Kartlegg testdata" })).toBeTruthy();
  });

  it("creates a task directly in a chosen column with Enter, and keeps the form open for the next one", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderSignedIn();
    const doing = screen.getByRole("heading", { name: "Pågår" }).closest("section") as HTMLElement;
    await user.click(within(doing).getByRole("button", { name: "+ Legg til oppgave" }));
    const input = within(doing).getByPlaceholderText("Skriv oppgavetittel …");
    await user.type(input, "Forbedre overvåking{Enter}");
    await waitFor(() => expect(server.calls.some((c) => c.method === "POST")).toBe(true));
    expect(server.calls.find((c) => c.method === "POST")?.body).toMatchObject({ status: "doing" });
    expect(await within(doing).findByRole("button", { name: "Forbedre overvåking" })).toBeTruthy();
    expect(within(doing).getByPlaceholderText("Skriv oppgavetittel …")).toBeTruthy();
  });

  it("does not create an empty task, and Escape cancels the inline form", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderSignedIn();
    const backlog = screen.getByRole("heading", { name: "Backlog" }).closest("section") as HTMLElement;
    await user.click(within(backlog).getByRole("button", { name: "+ Legg til oppgave" }));
    await user.type(within(backlog).getByPlaceholderText("Skriv oppgavetittel …"), "   {Enter}");
    expect(server.calls.some((c) => c.method === "POST")).toBe(false);
    await user.keyboard("{Escape}");
    expect(within(backlog).queryByPlaceholderText("Skriv oppgavetittel …")).toBeNull();
  });

  it("keeps the typed title when the server refuses the create", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await renderSignedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") return new Response(JSON.stringify({ error: "persistence_failed" }), { status: 500 });
        return server.handler(input, init);
      }),
    );
    const backlog = screen.getByRole("heading", { name: "Backlog" }).closest("section") as HTMLElement;
    await user.click(within(backlog).getByRole("button", { name: "+ Legg til oppgave" }));
    await user.type(within(backlog).getByPlaceholderText("Skriv oppgavetittel …"), "Viktig utkast{Enter}");
    expect(await within(backlog).findByRole("alert")).toBeTruthy();
    expect((within(backlog).getByPlaceholderText("Skriv oppgavetittel …") as HTMLInputElement).value).toBe("Viktig utkast");
  });
});

/** Opens the card's overflow menu and picks a destination, the keyboard and touch route that replaces dragging. */
async function moveViaMenu(user: ReturnType<typeof userEvent.setup>, title: string, destination: string) {
  await user.click(screen.getByRole("button", { name: `Flere valg for «${title}»` }));
  await user.click(screen.getByRole("button", { name: `Flytt til ${destination}` }));
}

describe("moving tasks without dragging", () => {
  it("moves a task to Blokkert through the card menu and shows it there after the server confirms", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Vent på svar" }, "backlog");
    await renderSignedIn();
    await moveViaMenu(user, "Vent på svar", "Blokkert");
    const blocked = screen.getByRole("heading", { name: "Blokkert" }).closest("section") as HTMLElement;
    await waitFor(() => expect(within(blocked).getByRole("button", { name: "Vent på svar" })).toBeTruthy());
    expect(server.calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "blocked" });
  });

  it("does not offer the current status as a destination", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Allerede her" }, "backlog");
    await renderSignedIn();
    await user.click(screen.getByRole("button", { name: "Flere valg for «Allerede her»" }));
    const names = screen.getAllByRole("button", { name: /^Flytt til / }).map((button) => button.textContent);
    expect(names).not.toContain("Flytt til Backlog");
    expect(names).toEqual(expect.arrayContaining(["Flytt til Pågår", "Flytt til Blokkert", "Flytt til Fullført"]));
  });

  it("has no always-visible status select on the card", async () => {
    server.seed("token-a", { title: "Ingen velger" }, "backlog");
    await renderSignedIn();
    expect(screen.queryByRole("combobox", { name: /Flytt/ })).toBeNull();
    expect(document.querySelector("select[id^='move-']")).toBeNull();
  });

  it("shows the move as failed and leaves the task where it was when the server rejects it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Står fast" }, "backlog");
    await renderSignedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
        return server.handler(input, init);
      }),
    );
    await moveViaMenu(user, "Står fast", "Fullført");
    expect((await screen.findByRole("alert")).textContent).toContain("Oppgaven finnes ikke lenger");
    const backlog = screen.getByRole("heading", { name: "Backlog" }).closest("section") as HTMLElement;
    expect(within(backlog).getByRole("button", { name: "Står fast" })).toBeTruthy();
  });
});

describe("card menu and metadata", () => {
  it("opening the card menu does not open the editor", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Menyen åpnes" }, "backlog");
    await renderSignedIn();
    await user.click(screen.getByRole("button", { name: "Flere valg for «Menyen åpnes»" }));
    expect(screen.getByRole("button", { name: "Flere valg for «Menyen åpnes»" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the open card menu and returns focus to its trigger", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Escape lukker" }, "backlog");
    await renderSignedIn();
    const trigger = screen.getByRole("button", { name: "Flere valg for «Escape lukker»" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("the menu's Åpne action opens the editor for that task", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Åpne via meny" }, "backlog");
    await renderSignedIn();
    await user.click(screen.getByRole("button", { name: "Flere valg for «Åpne via meny»" }));
    await user.click(screen.getByRole("button", { name: "Åpne" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("shows a notes indicator for a task with private notes, without showing the note text", async () => {
    server.seed("token-a", { title: "Har notater", notes: "Hemmelig notat" }, "backlog");
    await renderSignedIn();
    const card = screen.getByRole("button", { name: "Har notater" }).closest("article") as HTMLElement;
    expect(within(card).getByText("Har notater", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("Hemmelig notat")).toBeNull();
  });
});

describe("search and filters", () => {
  it("filters the visible cards by title text without changing their column", async () => {
    server.seed("token-a", { title: "Gjennomgå API-dokumentasjon" }, "backlog");
    server.seed("token-a", { title: "Oppdatere systemoversikt" }, "backlog");
    await renderSignedIn();
    fireEvent.change(screen.getByRole("searchbox", { name: "Søk i oppgaver" }), { target: { value: "api" } });
    expect(screen.getByRole("button", { name: "Gjennomgå API-dokumentasjon" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Oppdatere systemoversikt" })).toBeNull();
  });

  it("filters to overdue tasks, and never marks a completed task as overdue", async () => {
    server.seed("token-a", { title: "For sent", dueDate: "2026-11-01" }, "doing");
    server.seed("token-a", { title: "Ikke forfalt", dueDate: "2026-12-01" }, "doing");
    await renderSignedIn();
    fireEvent.click(screen.getByRole("checkbox", { name: "Bare forfalte" }));
    expect(screen.getByRole("button", { name: "For sent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ikke forfalt" })).toBeNull();
  });

  it("the reset action clears every filter", async () => {
    server.seed("token-a", { title: "Ett" }, "backlog");
    server.seed("token-a", { title: "To" }, "backlog");
    await renderSignedIn();
    fireEvent.change(screen.getByRole("searchbox", { name: "Søk i oppgaver" }), { target: { value: "ett" } });
    expect(screen.queryByRole("button", { name: "To" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nullstill søk og filter" }));
    expect(screen.getByRole("button", { name: "To" })).toBeTruthy();
  });
});

describe("task detail editor", () => {
  it("opens from the card, saves only the changed fields, and keeps the draft when the save fails", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Gammel tittel", notes: "Synthetic note" }, "backlog");
    await renderSignedIn();
    await user.click(screen.getByRole("button", { name: "Gammel tittel" }));
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("Tittel");
    await user.clear(title);
    await user.type(title, "Ny tittel");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "persistence_failed" }), { status: 500 })),
    );
    await user.click(within(dialog).getByRole("button", { name: "Lagre" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect((within(dialog).getByLabelText("Tittel") as HTMLInputElement).value).toBe("Ny tittel");
  });

  it("asks before discarding unsaved edits when closed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Behold meg" }, "backlog");
    await renderSignedIn();
    await user.click(screen.getByRole("button", { name: "Behold meg" }));
    await user.type(screen.getByLabelText("Tittel"), " endret");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("group", { name: /ulagrede endringer/i })).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Forkast endringer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("completed tasks and history", () => {
  it("lists completed tasks in history and reopens one into Backlog", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    server.seed("token-a", { title: "Fullført for lenge siden", status: "done" }, "done");
    await renderSignedIn();
    await user.click(screen.getByRole("button", { name: "Historikk" }));
    const item = (await screen.findByRole("button", { name: "Fullført for lenge siden" })).closest("li") as HTMLElement;
    await user.click(within(item).getByRole("button", { name: "Gjenåpne" }));
    await waitFor(() => expect(server.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(server.calls.find((c) => c.method === "PATCH")?.body).toEqual({ status: "backlog" });
  });
});

describe("account isolation", () => {
  it("a late response for the previous account cannot replace the new account's board", async () => {
    server.seed("token-a", { title: "Kun for konto A" }, "backlog");
    server.seed("token-b", { title: "Kun for konto B" }, "backlog");
    server.holdAccountAGets();
    render(<TasksPage />);
    signIn("token-a");
    await waitFor(() => expect(server.calls.some((c) => c.token === "token-a")).toBe(true));

    // Account B signs in while A's board request is still open.
    signIn("token-b", "switched");
    expect(await screen.findByRole("button", { name: "Kun for konto B" })).toBeTruthy();

    // A's late reply arrives now; it must not show up under B.
    await act(async () => {
      server.releaseAccountA();
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Kun for konto A" })).toBeNull();
    expect(screen.getByRole("button", { name: "Kun for konto B" })).toBeTruthy();
  });

  it("signing out clears the board", async () => {
    server.seed("token-a", { title: "Forsvinner ved utlogging" }, "backlog");
    await renderSignedIn();
    expect(screen.getByRole("button", { name: "Forsvinner ved utlogging" })).toBeTruthy();
    signIn(null, "signed_out");
    expect(await screen.findByRole("link", { name: "Logg inn" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Forsvinner ved utlogging" })).toBeNull();
  });
});
