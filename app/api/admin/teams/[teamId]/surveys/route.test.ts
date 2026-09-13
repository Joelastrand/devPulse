import { afterEach, describe, expect, it, vi } from "vitest";

const listTeamSurveysMock = vi.fn();
const createSurveyMock = vi.fn();

vi.mock("../../../../../../src/features/surveys/server/list-team-surveys", () => ({
  listTeamSurveys: listTeamSurveysMock,
}));
vi.mock("../../../../../../src/features/surveys/server/create-survey", () => ({
  createSurvey: createSurveyMock,
}));

const { GET, POST } = await import("./route");

function requestWithAuth(header?: string, init: RequestInit = {}): Request {
  return new Request("http://localhost/api/admin/teams/team-1/surveys", {
    headers: header ? { authorization: header, ...(init.headers as Record<string, string>) } : init.headers,
    ...init,
  });
}

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

describe("GET /api/admin/teams/[teamId]/surveys", () => {
  afterEach(() => {
    listTeamSurveysMock.mockReset();
  });

  it("returns the survey list for an app admin", async () => {
    const surveys = [{ surveyId: "survey-1", accessMode: "public", lifecycle: "scheduled" }];
    listTeamSurveysMock.mockResolvedValue({ ok: true, surveys });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ surveys });
  });

  it("passes the bearer token and teamId through", async () => {
    listTeamSurveysMock.mockResolvedValue({ ok: true, surveys: [] });

    await GET(requestWithAuth("Bearer abc.def.ghi"), params("team-42"));

    expect(listTeamSurveysMock).toHaveBeenCalledWith("abc.def.ghi", "team-42");
  });

  it("returns 401 when unauthenticated", async () => {
    listTeamSurveysMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(requestWithAuth(), params());

    expect(response.status).toBe(401);
    expect(listTeamSurveysMock).toHaveBeenCalledWith("", "team-1");
  });

  it("returns 403 for a non-admin caller, never a survey list", async () => {
    listTeamSurveysMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: "forbidden" });
  });

  it("returns 500 on a read failure, not a partial list", async () => {
    listTeamSurveysMock.mockResolvedValue({ ok: false, error: "read_failed" });

    const response = await GET(requestWithAuth("Bearer valid-token"), params());

    expect(response.status).toBe(500);
  });
});

describe("POST /api/admin/teams/[teamId]/surveys", () => {
  afterEach(() => {
    createSurveyMock.mockReset();
  });

  function postRequest(body: unknown, header: string | null = "Bearer valid-token"): Request {
    return new Request("http://localhost/api/admin/teams/team-1/surveys", {
      method: "POST",
      headers: {
        ...(header ? { authorization: header } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("creates a survey and returns its surveyId", async () => {
    createSurveyMock.mockResolvedValue({ ok: true, surveyId: "generated-1" });

    const response = await POST(postRequest({ accessMode: "public" }), params());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ surveyId: "generated-1" });
    expect(createSurveyMock).toHaveBeenCalledWith("valid-token", "team-1", { accessMode: "public" });
  });

  it("returns 400 on malformed JSON, never calling createSurvey", async () => {
    const response = await new Promise<Response>((resolve) => {
      const request = new Request("http://localhost/api/admin/teams/team-1/surveys", {
        method: "POST",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        body: "{not-json",
      });
      resolve(POST(request, params()));
    });

    expect(response.status).toBe(400);
    expect(createSurveyMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid access mode", async () => {
    createSurveyMock.mockResolvedValue({ ok: false, error: "invalid_access_mode" });

    const response = await POST(postRequest({ accessMode: "invalid" }), params());

    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid minimumResponses", async () => {
    createSurveyMock.mockResolvedValue({ ok: false, error: "invalid_minimum_responses" });

    const response = await POST(postRequest({ accessMode: "public", minimumResponses: 2 }), params());

    expect(response.status).toBe(400);
  });

  it("returns 404 for a nonexistent team", async () => {
    createSurveyMock.mockResolvedValue({ ok: false, error: "team_not_found" });

    const response = await POST(postRequest({ accessMode: "public" }), params());

    expect(response.status).toBe(404);
  });

  it("returns 409 for a disabled team", async () => {
    createSurveyMock.mockResolvedValue({ ok: false, error: "team_disabled" });

    const response = await POST(postRequest({ accessMode: "public" }), params());

    expect(response.status).toBe(409);
  });

  it("returns 401 when unauthenticated", async () => {
    createSurveyMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await POST(postRequest({ accessMode: "public" }, null), params());

    expect(response.status).toBe(401);
    expect(createSurveyMock).toHaveBeenCalledWith("", "team-1", { accessMode: "public" });
  });

  it("returns 403 for a non-admin caller", async () => {
    createSurveyMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(postRequest({ accessMode: "public" }), params());

    expect(response.status).toBe(403);
  });

  it("returns 500 on a persistence failure", async () => {
    createSurveyMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await POST(postRequest({ accessMode: "public" }), params());

    expect(response.status).toBe(500);
  });
});
