import { describe, expect, it, vi } from "vitest";
import {
  closeAdminSurvey,
  createAdminSurvey,
  deleteOrArchiveAdminSurvey,
  fetchAdminSurveys,
  openAdminSurvey,
} from "./admin-survey-gateway";

const SURVEY_ENTRY = {
  surveyId: "survey-1",
  accessMode: "public",
  minimumResponses: 5,
  lifecycle: "scheduled",
  archived: false,
  createdBy: "admin-1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("fetchAdminSurveys default gateway", () => {
  it("sends the Authorization header and requests the admin surveys endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ surveys: [SURVEY_ENTRY] }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAdminSurveys("an-id-token", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/surveys", {
      headers: { Authorization: "Bearer an-id-token" },
    });
    expect(result).toEqual({ status: "ok", surveys: [SURVEY_ENTRY] });

    vi.unstubAllGlobals();
  });

  it("URL-encodes the teamId", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ surveys: [] }) }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAdminSurveys("token", "team/with slash");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/teams/team%2Fwith%20slash/surveys",
      expect.anything(),
    );

    vi.unstubAllGlobals();
  });

  it("returns read_failed for a malformed survey entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ surveys: [{ surveyId: "", accessMode: "public" }] }) })),
    );

    const result = await fetchAdminSurveys("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error from the body (forbidden)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ error: "forbidden" }) })));

    const result = await fetchAdminSurveys("token", "team-1");

    expect(result).toEqual({ status: "forbidden" });

    vi.unstubAllGlobals();
  });

  it("returns read_failed if the fetch call itself throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await fetchAdminSurveys("token", "team-1");

    expect(result).toEqual({ status: "read_failed" });

    vi.unstubAllGlobals();
  });
});

describe("createAdminSurvey default gateway", () => {
  it("POSTs the input to the admin surveys endpoint with the Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ surveyId: "generated-1" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createAdminSurvey("token", "team-1", {
      accessMode: "public",
      minimumResponses: 5,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/surveys", {
      method: "POST",
      headers: { Authorization: "Bearer token", "content-type": "application/json" },
      body: JSON.stringify({ accessMode: "public", minimumResponses: 5 }),
    });
    expect(result).toEqual({ ok: true, surveyId: "generated-1" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error from the body (invalid_access_mode)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ error: "invalid_access_mode" }) })),
    );

    const result = await createAdminSurvey("token", "team-1", {
      accessMode: "public",
      minimumResponses: 5,
    });

    expect(result).toEqual({ ok: false, error: "invalid_access_mode" });

    vi.unstubAllGlobals();
  });

  it("trusts a known error from the body (invalid_minimum_responses)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ error: "invalid_minimum_responses" }) })),
    );

    const result = await createAdminSurvey("token", "team-1", {
      accessMode: "public",
      minimumResponses: 2,
    });

    expect(result).toEqual({ ok: false, error: "invalid_minimum_responses" });

    vi.unstubAllGlobals();
  });

  it("falls back to unknown for an unrecognized error and a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ error: "totally_new" }) })));
    const badBodyResult = await createAdminSurvey("token", "team-1", {
      accessMode: "public",
      minimumResponses: 5,
    });
    expect(badBodyResult).toEqual({ ok: false, error: "unknown" });
    vi.unstubAllGlobals();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );
    const networkFailureResult = await createAdminSurvey("token", "team-1", {
      accessMode: "public",
      minimumResponses: 5,
    });
    expect(networkFailureResult).toEqual({ ok: false, error: "unknown" });
    vi.unstubAllGlobals();
  });
});

describe("openAdminSurvey default gateway", () => {
  it("POSTs to the open endpoint with the Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await openAdminSurvey("token", "team-1", "survey-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/surveys/survey-1/open", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it("maps every known HTTP status to its error", async () => {
    for (const [status, error] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [500, "persistence_failed"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => ({ status, json: async () => ({ error: "x" }) })));
      const result = await openAdminSurvey("token", "team-1", "survey-1");
      expect(result).toEqual({ ok: false, error });
      vi.unstubAllGlobals();
    }
  });

  it("returns unknown on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await openAdminSurvey("token", "team-1", "survey-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});

describe("closeAdminSurvey default gateway", () => {
  it("POSTs to the close endpoint with the Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await closeAdminSurvey("token", "team-1", "survey-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/surveys/survey-1/close", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    });
    expect(result).toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it("returns unknown on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await closeAdminSurvey("token", "team-1", "survey-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});

describe("deleteOrArchiveAdminSurvey default gateway", () => {
  it("DELETEs the survey and returns the server-determined outcome", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ outcome: "deleted" }) }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteOrArchiveAdminSurvey("token", "team-1", "survey-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/surveys/survey-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer token" },
    });
    expect(result).toEqual({ ok: true, outcome: "deleted" });

    vi.unstubAllGlobals();
  });

  it("returns the archived outcome", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, json: async () => ({ outcome: "archived" }) })),
    );

    const result = await deleteOrArchiveAdminSurvey("token", "team-1", "survey-1");

    expect(result).toEqual({ ok: true, outcome: "archived" });

    vi.unstubAllGlobals();
  });

  it("maps every known HTTP status to its error", async () => {
    for (const [status, error] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [500, "persistence_failed"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => ({ status, json: async () => ({ error: "x" }) })));
      const result = await deleteOrArchiveAdminSurvey("token", "team-1", "survey-1");
      expect(result).toEqual({ ok: false, error });
      vi.unstubAllGlobals();
    }
  });

  it("returns unknown on a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );

    const result = await deleteOrArchiveAdminSurvey("token", "team-1", "survey-1");

    expect(result).toEqual({ ok: false, error: "unknown" });

    vi.unstubAllGlobals();
  });
});
