// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { RoadmapItemView } from "../server/list-roadmap-items";

const fetchRoadmapItemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();
vi.mock("./roadmap-gateway", () => ({
  fetchRoadmapItems: fetchRoadmapItemsMock,
  fetchAssignableMembers: fetchAssignableMembersMock,
}));

const { useRoadmapPlanning } = await import("./use-roadmap-planning");

afterEach(() => {
  cleanup();
  fetchRoadmapItemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
});

function plan(overrides: Partial<RoadmapItemView> = {}): RoadmapItemView {
  return {
    treeId: "tree-1",
    areaName: "Containers",
    targetNodeId: "node-2",
    targetLabel: "Production rollout",
    targetAvailable: true,
    tracking: { state: "tracked", currentNodeId: "node-1" },
    priority: "high",
    status: "active",
    startDate: null,
    targetDate: null,
    owner: null,
    overdue: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

const live = plan({ treeId: "tree-live" });
const old = plan({ treeId: "tree-old", archived: true });

function ok(items: RoadmapItemView[], truncated = false) {
  return { status: "ok", items, canEdit: true, truncated };
}

describe("useRoadmapPlanning — archived-inclusive mode", () => {
  it("issues one archived-inclusive read and keeps archived and non-archived items together", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([live, old], true));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledWith("tok", "team-1", { includeArchived: true });
    expect(result.current.roadmap).toEqual({ phase: "loaded", items: [live, old], canEdit: true, truncated: true });
    expect(result.current.includesArchived).toBe(true);
    expect(result.current.archived).toEqual({ phase: "off" });
  });

  it("issues no further roadmap read when archived visibility calls are made", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([live, old]));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    act(() => result.current.showArchived());
    act(() => result.current.hideArchived());
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
  });

  it("refresh issues exactly one more archived-inclusive read and replaces state only when it resolves", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live, old]));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));

    let release: (value: unknown) => void = () => {};
    fetchRoadmapItemsMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    let refreshed: Promise<boolean> = Promise.resolve(false);
    act(() => {
      refreshed = result.current.refresh();
    });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("tok", "team-1", { includeArchived: true });
    // No optimistic update while the refetch is pending.
    expect(result.current.roadmap).toMatchObject({ items: [live, old] });

    await act(async () => {
      release(ok([old]));
      expect(await refreshed).toBe(true);
    });
    expect(result.current.roadmap).toMatchObject({ items: [old] });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
  });

  it("keeps previous state and resolves false when the refresh fails", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live, old]));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "error" });
    let success = true;
    await act(async () => {
      success = await result.current.refresh();
    });
    expect(success).toBe(false);
    expect(result.current.roadmap).toMatchObject({ phase: "loaded", items: [live, old] });
  });

  it("moves a loaded roadmap to forbidden and resolves false when the refresh is authoritatively forbidden", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live, old]));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });
    let success = true;
    await act(async () => {
      success = await result.current.refresh();
    });
    expect(success).toBe(false);
    expect(result.current.roadmap).toEqual({ phase: "forbidden" });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("tok", "team-1", { includeArchived: true });
    expect(fetchAssignableMembersMock).not.toHaveBeenCalled();
  });

  it("moves an errored roadmap to forbidden when the refresh is authoritatively forbidden", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "read_failed" });
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("error"));
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });
    await act(async () => {
      expect(await result.current.refresh()).toBe(false);
    });
    expect(result.current.roadmap).toEqual({ phase: "forbidden" });
  });

  it("ignores a stale forbidden refresh after the teamId changes", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    const { result, rerender } = renderHook(
      ({ teamId }) => useRoadmapPlanning({ token: "tok", teamId, mode: "archived-inclusive" }),
      { initialProps: { teamId: "team-1" } },
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));

    let release: (value: unknown) => void = () => {};
    fetchRoadmapItemsMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    let refreshed: Promise<boolean> = Promise.resolve(true);
    act(() => {
      refreshed = result.current.refresh();
    });
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([old]));
    rerender({ teamId: "team-2" });
    await act(async () => {
      release({ status: "forbidden" });
      expect(await refreshed).toBe(false);
    });
    await waitFor(() => expect(result.current.roadmap).toMatchObject({ phase: "loaded", items: [old] }));
  });

  it("reports an error state when the initial read fails", async () => {
    fetchRoadmapItemsMock.mockResolvedValue({ status: "error" });
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("error"));
  });

  it("drops a late refresh result after the teamId changes", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    const { result, rerender } = renderHook(
      ({ teamId }) => useRoadmapPlanning({ token: "tok", teamId, mode: "archived-inclusive" }),
      { initialProps: { teamId: "team-1" } },
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));

    let release: (value: unknown) => void = () => {};
    fetchRoadmapItemsMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    let refreshed: Promise<boolean> = Promise.resolve(true);
    act(() => {
      refreshed = result.current.refresh();
    });
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([old]));
    rerender({ teamId: "team-2" });
    await act(async () => {
      release(ok([live, old, plan({ treeId: "stale" })]));
      expect(await refreshed).toBe(false);
    });
    await waitFor(() => expect(result.current.roadmap).toMatchObject({ items: [old] }));
  });
});

describe("useRoadmapPlanning — lazy-archived mode (Feature A)", () => {
  it("reads the non-archived list once on mount without an archived option", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([live]));
    const { result } = renderHook(() => useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "lazy-archived" }));
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledWith("tok", "team-1");
    expect(result.current.includesArchived).toBe(false);
    expect(result.current.archived).toEqual({ phase: "off" });
  });

  it("fetches archived plans only after showArchived and refreshes base plus archived while on", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    const { result } = renderHook(() => useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "lazy-archived" }));
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));

    // Refresh while archived is off: base read only.
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("tok", "team-1");

    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live, old]));
    act(() => result.current.showArchived());
    await waitFor(() => expect(result.current.archived.phase).toBe("loaded"));
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(3);
    expect(fetchRoadmapItemsMock).toHaveBeenLastCalledWith("tok", "team-1", { includeArchived: true });

    // Refresh while archived is on: one base read and one archived-inclusive read.
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live])).mockResolvedValueOnce(ok([live, old]));
    await act(async () => {
      expect(await result.current.refresh()).toBe(true);
    });
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(5);
    expect(fetchRoadmapItemsMock.mock.calls.slice(3).map((call) => call.slice(2))).toEqual([
      [],
      [{ includeArchived: true }],
    ]);
  });

  it("drops an archived response that arrives after hideArchived", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    const { result } = renderHook(() => useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "lazy-archived" }));
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    let release: (value: unknown) => void = () => {};
    fetchRoadmapItemsMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    act(() => result.current.showArchived());
    act(() => result.current.hideArchived());
    await act(async () => release(ok([live, old])));
    expect(result.current.archived).toEqual({ phase: "off" });
  });
});

describe("useRoadmapPlanning — owners", () => {
  const members = { status: "ok", members: [], unavailableCount: 1, truncated: false };

  it("loads owners once per scope and reloads only when forced", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([]));
    fetchAssignableMembersMock.mockResolvedValue(members);
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    expect(result.current.owners).toEqual({ phase: "idle" });
    act(() => result.current.loadOwners());
    await waitFor(() => expect(result.current.owners.phase).toBe("loaded"));
    act(() => result.current.loadOwners());
    expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(1);
    act(() => result.current.loadOwners(true));
    await waitFor(() => expect(fetchAssignableMembersMock).toHaveBeenCalledTimes(2));
    expect(fetchAssignableMembersMock).toHaveBeenCalledWith("tok", "team-1");
  });

  it("reports an owners error without affecting the roadmap read", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(ok([live]));
    fetchAssignableMembersMock.mockResolvedValue({ status: "error" });
    const { result } = renderHook(() => useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "lazy-archived" }));
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    act(() => result.current.loadOwners());
    await waitFor(() => expect(result.current.owners.phase).toBe("error"));
    expect(result.current.roadmap.phase).toBe("loaded");
  });
});

describe("useRoadmapPlanning — forbidden initial read", () => {
  it("reports forbidden in archived-inclusive mode", async () => {
    fetchRoadmapItemsMock.mockResolvedValue({ status: "forbidden" });
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap).toEqual({ phase: "forbidden" }));
  });

  it("keeps a generic error for non-forbidden failures and for lazy-archived mode", async () => {
    fetchRoadmapItemsMock.mockResolvedValue({ status: "read_failed" });
    const inclusive = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(inclusive.result.current.roadmap).toEqual({ phase: "error" }));

    fetchRoadmapItemsMock.mockResolvedValue({ status: "forbidden" });
    const lazy = renderHook(() => useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "lazy-archived" }));
    await waitFor(() => expect(lazy.result.current.roadmap).toEqual({ phase: "error" }));
  });
});

describe("useRoadmapPlanning — overlapping archived-inclusive refreshes", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it("never lets an older refresh overwrite a newer one, and reports the newer outcome to both callers", async () => {
    const older = deferred<ReturnType<typeof ok>>();
    const newer = deferred<ReturnType<typeof ok>>();
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    fetchRoadmapItemsMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.refresh();
      second = result.current.refresh();
    });
    await act(async () => newer.resolve(ok([live, plan({ treeId: "tree-new" })])));
    await act(async () => older.resolve(ok([old])));

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(result.current.roadmap).toMatchObject({
      phase: "loaded",
      items: [live, expect.objectContaining({ treeId: "tree-new" })],
    });
  });

  it("ignores a stale forbidden from an older refresh once a newer one has succeeded", async () => {
    const older = deferred<{ status: "forbidden" }>();
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    fetchRoadmapItemsMock.mockReturnValueOnce(older.promise).mockResolvedValueOnce(ok([live, old]));

    let first!: Promise<boolean>;
    act(() => {
      first = result.current.refresh();
      void result.current.refresh();
    });
    await waitFor(() => expect(result.current.roadmap).toMatchObject({ items: [live, old] }));
    await act(async () => older.resolve({ status: "forbidden" }));

    await expect(first).resolves.toBe(true);
    expect(result.current.roadmap.phase).toBe("loaded");
  });

  it("still turns the page forbidden when the newest refresh is forbidden", async () => {
    fetchRoadmapItemsMock.mockResolvedValueOnce(ok([live]));
    const { result } = renderHook(() =>
      useRoadmapPlanning({ token: "tok", teamId: "team-1", mode: "archived-inclusive" }),
    );
    await waitFor(() => expect(result.current.roadmap.phase).toBe("loaded"));
    fetchRoadmapItemsMock.mockResolvedValueOnce({ status: "forbidden" });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.roadmap).toEqual({ phase: "forbidden" });
  });
});
