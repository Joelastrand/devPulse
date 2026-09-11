import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamAccessRequestsMock = vi.fn();

vi.mock("../../../../../../src/features/teams/server/list-team-access-requests", () => ({
  listTeamAccessRequests: listTeamAccessRequestsMock,
}));

const { GET } = await import("./route");

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/admin/teams/team-1/access-requests", {
    headers: header ? { authorization: header } : {},
  });
}

describe("GET /api/admin/teams/[teamId]/access-requests", () => {
  afterEach(() => {
    listTeamAccessRequestsMock.mockReset();
  });

  it("returns the pending access-request list for an app admin", async () => {
    const requests = [{ uid: "user-1", email: "dev@example.com", createdAt: new Date() }];
    listTeamAccessRequestsMock.mockResolvedValue({ ok: true, requests });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.requests).toHaveLength(1);
  });

  it("passes the bearer token and teamId through", async () => {
    listTeamAccessRequestsMock.mockResolvedValue({ ok: true, requests: [] });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(listTeamAccessRequestsMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns 401 when unauthenticated", async () => {
    listTeamAccessRequestsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    listTeamAccessRequestsMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(403);
  });

  it("returns 500 on a read failure", async () => {
    listTeamAccessRequestsMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
