// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const fetchRoadmapItemsMock = vi.fn();
const fetchAssignableMembersMock = vi.fn();
const fetchTeamSkillsMock = vi.fn();
vi.mock("./roadmap-gateway", () => ({
  fetchRoadmapItems: fetchRoadmapItemsMock,
  fetchAssignableMembers: fetchAssignableMembersMock,
}));
vi.mock("../../skill-trees/client/skill-trees-gateway", () => ({
  fetchTeamSkills: fetchTeamSkillsMock,
}));

const { useRoadmapPageData } = await import("./use-roadmap-page-data");

afterEach(() => {
  cleanup();
  fetchRoadmapItemsMock.mockReset();
  fetchAssignableMembersMock.mockReset();
  fetchTeamSkillsMock.mockReset();
});

const roadmapOk = (canEdit: boolean) => ({ status: "ok", items: [], canEdit, truncated: false });
const skillsOk = { status: "ok", skills: [], canReportProgress: true };

function render() {
  return renderHook(() => useRoadmapPageData({ token: "tok", teamId: "team-1" }));
}

describe("useRoadmapPageData", () => {
  it("canMutate requires canEdit and a loaded skills read", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(true));
    fetchTeamSkillsMock.mockResolvedValue(skillsOk);
    const { result } = render();
    expect(result.current.canMutate).toBe(false);
    await waitFor(() => expect(result.current.canMutate).toBe(true));
  });

  it("canMutate stays false when canEdit is false", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(false));
    fetchTeamSkillsMock.mockResolvedValue(skillsOk);
    const { result } = render();
    await waitFor(() => expect(result.current.skills.phase).toBe("loaded"));
    expect(result.current.canMutate).toBe(false);
  });

  it("canMutate stays false when skills fail, and retry refetches skills only", async () => {
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(true));
    fetchTeamSkillsMock.mockResolvedValueOnce({ status: "read_failed" }).mockResolvedValueOnce(skillsOk);
    const { result } = render();
    await waitFor(() => expect(result.current.skills.phase).toBe("error"));
    expect(result.current.planning.roadmap.phase).toBe("loaded");
    expect(result.current.canMutate).toBe(false);

    act(() => result.current.retrySkills());
    expect(result.current.skills.phase).toBe("loading");
    await waitFor(() => expect(result.current.skills.phase).toBe("loaded"));
    expect(fetchTeamSkillsMock).toHaveBeenCalledTimes(2);
    expect(fetchRoadmapItemsMock).toHaveBeenCalledTimes(1);
    expect(result.current.canMutate).toBe(true);
  });

  it("drops a skills response that arrives after the identity changed", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    fetchRoadmapItemsMock.mockResolvedValue(roadmapOk(true));
    fetchTeamSkillsMock
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ status: "read_failed" });
    const { result, rerender } = renderHook(({ teamId }) => useRoadmapPageData({ token: "tok", teamId }), {
      initialProps: { teamId: "team-1" },
    });
    rerender({ teamId: "team-2" });
    await waitFor(() => expect(result.current.skills.phase).toBe("error"));
    await act(async () => resolveFirst(skillsOk));
    expect(result.current.skills.phase).toBe("error");
  });
});
