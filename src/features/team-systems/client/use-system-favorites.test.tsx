// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSystemFavorites } from "./use-system-favorites";

const gateway = vi.hoisted(() => ({
  fetchSystemFavorites: vi.fn(),
  setSystemFavorite: vi.fn(),
}));

vi.mock("./system-favorites-gateway", () => gateway);

afterEach(() => {
  cleanup();
  gateway.fetchSystemFavorites.mockReset();
  gateway.setSystemFavorite.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useSystemFavorites (Phase 2F.1)", () => {
  it("loads the caller's favorite ids for the token and team", async () => {
    gateway.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: ["s1", "s2"] });
    const { result } = renderHook(() => useSystemFavorites("token-a", "team-1"));

    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    expect(result.current.load.status === "ready" && [...result.current.load.ids]).toEqual(["s1", "s2"]);
    expect(gateway.fetchSystemFavorites).toHaveBeenCalledWith("token-a", "team-1");
  });

  it("reports a load error without any favorite state", async () => {
    gateway.fetchSystemFavorites.mockResolvedValue({ status: "read_failed" });
    const { result } = renderHook(() => useSystemFavorites("token-a", "team-1"));

    await waitFor(() => expect(result.current.load.status).toBe("error"));
  });

  it("shows a toggle only after the server confirms it", async () => {
    gateway.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: [] });
    const write = deferred<{ ok: true; favorite: boolean }>();
    gateway.setSystemFavorite.mockReturnValue(write.promise);
    const { result } = renderHook(() => useSystemFavorites("token-a", "team-1"));
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    act(() => {
      void result.current.toggle("s1", true);
    });
    expect(result.current.pendingIds.has("s1")).toBe(true);
    expect(result.current.load.status === "ready" && result.current.load.ids.has("s1")).toBe(false);

    await act(async () => write.resolve({ ok: true, favorite: true }));
    expect(result.current.pendingIds.has("s1")).toBe(false);
    expect(result.current.load.status === "ready" && result.current.load.ids.has("s1")).toBe(true);
  });

  it("sends one request for a double click on the same system", async () => {
    gateway.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: [] });
    const write = deferred<{ ok: true; favorite: boolean }>();
    gateway.setSystemFavorite.mockReturnValue(write.promise);
    const { result } = renderHook(() => useSystemFavorites("token-a", "team-1"));
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    act(() => {
      void result.current.toggle("s1", true);
      void result.current.toggle("s1", true);
    });

    expect(gateway.setSystemFavorite).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve({ ok: true, favorite: true }));
  });

  it("keeps other systems interactive while one write is pending", async () => {
    gateway.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: [] });
    const first = deferred<{ ok: true; favorite: boolean }>();
    gateway.setSystemFavorite.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, favorite: true });
    const { result } = renderHook(() => useSystemFavorites("token-a", "team-1"));
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    act(() => {
      void result.current.toggle("s1", true);
    });
    await act(async () => {
      await result.current.toggle("s2", true);
    });

    expect(gateway.setSystemFavorite).toHaveBeenCalledTimes(2);
    expect(result.current.load.status === "ready" && result.current.load.ids.has("s2")).toBe(true);
    await act(async () => first.resolve({ ok: true, favorite: true }));
  });

  it("leaves the favorite state unchanged and names the refusal when the server refuses", async () => {
    gateway.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: ["s1"] });
    gateway.setSystemFavorite.mockResolvedValue({ ok: false, error: "forbidden" });
    const { result } = renderHook(() => useSystemFavorites("token-a", "team-1"));
    await waitFor(() => expect(result.current.load.status).toBe("ready"));

    await act(async () => {
      await result.current.toggle("s1", false);
    });

    expect(result.current.failure).toEqual({ systemId: "s1", error: "forbidden" });
    expect(result.current.load.status === "ready" && result.current.load.ids.has("s1")).toBe(true);
    expect(result.current.pendingIds.size).toBe(0);
  });

  it("does not apply a late write result after the owning view has unmounted (account or team switch)", async () => {
    gateway.fetchSystemFavorites.mockResolvedValue({ status: "ok", systemIds: [] });
    const write = deferred<{ ok: true; favorite: boolean }>();
    gateway.setSystemFavorite.mockReturnValue(write.promise);
    const { result, unmount } = renderHook(() => useSystemFavorites("token-a", "team-1"));
    await waitFor(() => expect(result.current.load.status).toBe("ready"));
    act(() => {
      void result.current.toggle("s1", true);
    });

    unmount();
    await act(async () => write.resolve({ ok: true, favorite: true }));

    // The hook's state is frozen at unmount: the late confirmation changes nothing that the next view could read.
    expect(result.current.load.status === "ready" && result.current.load.ids.has("s1")).toBe(false);
  });

  it("does not apply an earlier token's favorites to a later token's view", async () => {
    gateway.fetchSystemFavorites.mockImplementation(async (token: string) =>
      token === "token-a" ? { status: "ok", systemIds: ["a-only"] } : { status: "ok", systemIds: ["b-only"] },
    );
    const { result, rerender } = renderHook(({ token }) => useSystemFavorites(token, "team-1"), {
      initialProps: { token: "token-a" },
    });
    await waitFor(() => expect(result.current.load.status === "ready" && result.current.load.ids.has("a-only")).toBe(true));

    rerender({ token: "token-b" });
    await waitFor(() => expect(result.current.load.status === "ready" && result.current.load.ids.has("b-only")).toBe(true));
    expect(result.current.load.status === "ready" && result.current.load.ids.has("a-only")).toBe(false);
  });
});
