import { afterEach, describe, expect, it, vi } from "vitest";

const createAccessRequestMock = vi.fn();

vi.mock("../../../../../src/features/teams/server/create-access-request", () => ({
  createAccessRequest: createAccessRequestMock,
}));

const { POST } = await import("./route");

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWithAuth(header?: string): Request {
  return new Request("http://localhost/api/teams/team-1/access-requests", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

describe("POST /api/teams/[teamId]/access-requests", () => {
  afterEach(() => {
    createAccessRequestMock.mockReset();
  });

  it("returns 200 and the outcome for a valid request", async () => {
    createAccessRequestMock.mockResolvedValue({ ok: true, outcome: "created" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ outcome: "created" });
  });

  it("passes the bearer token and teamId through to createAccessRequest", async () => {
    createAccessRequestMock.mockResolvedValue({ ok: true, outcome: "created" });

    await POST(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(createAccessRequestMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns 401 when unauthenticated", async () => {
    createAccessRequestMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(requestWithAuth(), params());

    expect(response.status).toBe(401);
  });

  it("returns 400 for an unverified caller", async () => {
    createAccessRequestMock.mockResolvedValue({ ok: false, error: "unverified" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(400);
  });

  it("returns 400 for a disabled team", async () => {
    createAccessRequestMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(400);
  });

  it("returns 500, not a partial success, on a read or persistence failure", async () => {
    createAccessRequestMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await POST(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});
