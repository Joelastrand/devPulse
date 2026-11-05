// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectMainLandmark, expectNamedControls } from "../../../../src/components/ui/heading-structure";
import { cleanup } from "@testing-library/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

const teamDetailMock = vi.fn<(props: { teamId: string; forumEnabled: boolean }) => ReactElement>(
  () => <div data-testid="team-detail" />,
);

vi.mock("../../../../src/features/teams/components/TeamDetail", () => ({
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

describe("route structure (visual-redesign TASK-019)", () => {
  beforeEach(() => {
    // Earlier tests in this file leave their renders in the DOM; the structure check starts from a clean document.
    cleanup();
  });

  it("renders one main landmark; the page title is checked in the composed view's suite", async () => {
    render(await TeamDetailPage({ params: paramsOf("team-1") }));
    expectMainLandmark(document.body);
    expectNamedControls(document.body);
    // The page title is owned by the composed client view; its heading structure is checked in that view's suite.
  });
});
