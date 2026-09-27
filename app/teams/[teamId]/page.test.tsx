// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

const teamDetailMock = vi.fn<(props: { teamId: string; forumEnabled: boolean }) => ReactElement>(
  () => <div data-testid="team-detail" />,
);

vi.mock("../../../src/features/teams/components/TeamDetail", () => ({
  TeamDetail: teamDetailMock,
}));

const { default: TeamDetailPage } = await import("./page");

function paramsOf(teamId: string) {
  return Promise.resolve({ teamId });
}

describe("TeamDetailPage — Forum feature flag (FEATURE_FORUM_ENABLED)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    teamDetailMock.mockClear();
  });

  it("passes forumEnabled: false to TeamDetail when the flag is missing", async () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", undefined);

    render(await TeamDetailPage({ params: paramsOf("team-1") }));

    expect(teamDetailMock.mock.calls[0]?.[0]).toEqual({
      teamId: "team-1",
      forumEnabled: false,
    });
  });

  it('passes forumEnabled: false to TeamDetail when the flag is "false"', async () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", "false");

    render(await TeamDetailPage({ params: paramsOf("team-1") }));

    expect(teamDetailMock.mock.calls[0]?.[0]).toEqual({
      teamId: "team-1",
      forumEnabled: false,
    });
  });

  it('passes forumEnabled: true to TeamDetail when the flag is exactly "true"', async () => {
    vi.stubEnv("FEATURE_FORUM_ENABLED", "true");

    render(await TeamDetailPage({ params: paramsOf("team-1") }));

    expect(teamDetailMock.mock.calls[0]?.[0]).toEqual({
      teamId: "team-1",
      forumEnabled: true,
    });
  });
});
