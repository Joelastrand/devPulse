// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoadmapItemView } from "../../roadmap/server/list-roadmap-items";
import { useCompetencePlans } from "./use-competence-plans";

// Focused regression tests for the Kompetanseplan load (TASK-013, BR-17): existing roadmap competence-stage records
// are read through the existing roadmap read, shown unchanged, never written, and a failed legacy read must not hide
// the team's plans.

vi.mock("../../auth/client/use-auth-gated-resource", async () => {
  const React = await import("react");
  return {
    useAuthGatedResource: (onAuthChange: (token: string | null) => void) => {
      React.useEffect(() => {
        onAuthChange("token-1");
      }, []);
    },
  };
});

vi.mock("./competence-plan-gateway", () => ({
  fetchCompetencePlans: vi.fn(),
  putCompetencePlan: vi.fn(),
}));

vi.mock("../../roadmap/client/roadmap-gateway", () => ({
  fetchRoadmapItems: vi.fn(),
}));

import {
  fetchCompetencePlans,
  putCompetencePlan,
} from "./competence-plan-gateway";
import { fetchRoadmapItems } from "../../roadmap/client/roadmap-gateway";

const legacyItem = (overrides: Partial<RoadmapItemView>): RoadmapItemView => ({
  treeId: "tree-security",
  areaName: "Sikkerhet",
  targetNodeId: "node-threat",
  targetLabel: "Trusselmodellering",
  targetAvailable: true,
  tracking: { kind: "untracked" } as unknown as RoadmapItemView["tracking"],
  priority: "high" as RoadmapItemView["priority"],
  status: "in_progress" as RoadmapItemView["status"],
  startDate: null,
  targetDate: null,
  owner: { kind: "unassigned" } as unknown as RoadmapItemView["owner"],
  overdue: false,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  completedAt: null,
  ...overrides,
});

describe("useCompetencePlans legacy roadmap records (BR-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchCompetencePlans).mockResolvedValue({ status: "ok", plans: [], canEdit: false, truncated: false });
  });

  it("keeps the plans visible and flags the legacy list when the legacy roadmap read fails", async () => {
    vi.mocked(fetchRoadmapItems).mockResolvedValue({ status: "read_failed" });

    const { result } = renderHook(() => useCompetencePlans("team-1"));

    await waitFor(() => expect(result.current.data.phase).toBe("loaded"));
    if (result.current.data.phase !== "loaded") throw new Error("expected loaded");
    expect(result.current.data.legacyFailed).toBe(true);
    expect(result.current.data.legacyItems).toEqual([]);
    expect(result.current.data.plans).toEqual([]);
  });

  it("shows non-archived legacy records unchanged and excludes archived ones, without writing", async () => {
    const active = legacyItem({ treeId: "tree-security" });
    const archived = legacyItem({ treeId: "tree-old", archived: true });
    vi.mocked(fetchRoadmapItems).mockResolvedValue({
      status: "ok",
      items: [active, archived],
      canEdit: true,
      truncated: false,
    });

    const { result } = renderHook(() => useCompetencePlans("team-1"));

    await waitFor(() => expect(result.current.data.phase).toBe("loaded"));
    if (result.current.data.phase !== "loaded") throw new Error("expected loaded");
    expect(result.current.data.legacyFailed).toBe(false);
    expect(result.current.data.legacyItems).toEqual([active]);
    expect(fetchRoadmapItems).toHaveBeenCalledWith("token-1", "team-1", { includeArchived: false });
    // A read of legacy records is read-only: no plan write is issued while loading.
    expect(putCompetencePlan).not.toHaveBeenCalled();
  });

  it("reports a forbidden plan read as an error even when the legacy read succeeds", async () => {
    vi.mocked(fetchCompetencePlans).mockResolvedValue({ status: "forbidden" });
    vi.mocked(fetchRoadmapItems).mockResolvedValue({
      status: "ok",
      items: [legacyItem({})],
      canEdit: false,
      truncated: false,
    });

    const { result } = renderHook(() => useCompetencePlans("team-1"));

    await waitFor(() => expect(result.current.data.phase).toBe("error"));
    expect(result.current.data).toEqual({ phase: "error", reason: "forbidden" });
  });
});
