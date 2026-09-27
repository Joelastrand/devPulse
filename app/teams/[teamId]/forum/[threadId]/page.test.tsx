// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

const threadDetailMock = vi.fn<(props: { teamId: string; threadId: string }) => ReactElement>(
  () => <div data-testid="thread-detail" />,
);

vi.mock("../../../../../src/features/forum/components/ThreadDetail", () => ({
  ThreadDetail: threadDetailMock,
}));

const { default: ForumThreadDetailPage } = await import("./page");

function paramsOf(teamId: string, threadId: string) {
  return Promise.resolve({ teamId, threadId });
}

describe("ForumThreadDetailPage — Forum feature flag (FEATURE_FORUM_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    notFoundMock.mockClear();
    threadDetailMock.mockClear();
  });

  it("resolves through notFound() when the flag is disabled, without mounting ThreadDetail", async () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", undefined);

    await expect(
      ForumThreadDetailPage({ params: paramsOf("team-1", "thread-1") }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(threadDetailMock).not.toHaveBeenCalled();
  });

  it('resolves through notFound() when the flag is "false", without mounting ThreadDetail', async () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", "false");

    await expect(
      ForumThreadDetailPage({ params: paramsOf("team-1", "thread-1") }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(threadDetailMock).not.toHaveBeenCalled();
  });

  it("renders ThreadDetail exactly as before when the flag is enabled", async () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", "true");

    render(await ForumThreadDetailPage({ params: paramsOf("team-1", "thread-1") }));

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("thread-detail")).toBeTruthy();
    expect(threadDetailMock.mock.calls[0]?.[0]).toEqual({
      teamId: "team-1",
      threadId: "thread-1",
    });
  });
});
