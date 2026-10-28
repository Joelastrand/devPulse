import { afterEach, describe, expect, it, vi } from "vitest";

const getOwnRoleComparisonMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/features/role-profiles/server/get-own-role-comparison", () => ({
  getOwnRoleComparison: getOwnRoleComparisonMock,
}));

const { GET } = await import("./route");

function request(header: string | undefined = "Bearer id-token", query = ""): Request {
  return new Request(`http://localhost/api/me/role-comparison${query}`, {
    headers: header ? { authorization: header } : {},
  });
}

afterEach(() => {
  getOwnRoleComparisonMock.mockReset();
});

describe("GET /api/me/role-comparison", () => {
  it("returns the available comparison with only the allow-listed row and target fields, uncached", async () => {
    getOwnRoleComparisonMock.mockResolvedValue({
      ok: true,
      comparison: {
        state: "available",
        target: { roleId: "role-1", name: "Backend", archived: false, uid: "leak" },
        rows: [
          {
            treeId: "api",
            treeName: "API design",
            expectedLevel: 3,
            status: "meets",
            ownLevel: 4,
            createdBy: "leak",
          },
        ],
      },
    });

    const response = await GET(request());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      state: "available",
      target: { roleId: "role-1", name: "Backend" },
      rows: [{ treeId: "api", treeName: "API design", expectedLevel: 3, status: "meets", ownLevel: 4 }],
    });
    expect(JSON.stringify(body)).not.toMatch(/leak|archived|total|count|percent|score|rank/);
  });

  it("returns no_target and target_unavailable without rows", async () => {
    getOwnRoleComparisonMock.mockResolvedValueOnce({ ok: true, comparison: { state: "no_target" } });
    expect(await (await GET(request())).json()).toEqual({ state: "no_target" });

    getOwnRoleComparisonMock.mockResolvedValueOnce({
      ok: true,
      comparison: { state: "target_unavailable", reason: "no_expectations" },
    });
    expect(await (await GET(request())).json()).toEqual({ state: "target_unavailable", reason: "no_expectations" });
  });

  it("passes only the bearer token to the operation: no body and no query can name a uid", async () => {
    getOwnRoleComparisonMock.mockResolvedValue({ ok: true, comparison: { state: "no_target" } });

    await GET(request("Bearer id-token", "?uid=someone-else"));

    expect(getOwnRoleComparisonMock).toHaveBeenCalledWith("id-token");
  });

  it("returns 401 for a missing or invalid token", async () => {
    getOwnRoleComparisonMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    const response = await GET(request(undefined));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns a neutral 500 for a neutral read failure, with no comparison content", async () => {
    getOwnRoleComparisonMock.mockResolvedValue({ ok: false, error: "persistence_failed" });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });

  it("returns a neutral 500 when the operation throws", async () => {
    getOwnRoleComparisonMock.mockRejectedValue(new Error("firestore unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "persistence_failed" });
  });
});
