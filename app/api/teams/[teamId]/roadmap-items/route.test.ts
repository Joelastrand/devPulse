import { afterEach, describe, expect, it, vi } from "vitest";

const listRoadmapItemsMock = vi.fn();
const createRoadmapItemMock = vi.fn();

vi.mock("../../../../../src/features/roadmap/server/create-roadmap-item", () => ({
  createRoadmapItem: createRoadmapItemMock,
}));

vi.mock("../../../../../src/features/roadmap/server/list-roadmap-items", () => ({
  listRoadmapItems: listRoadmapItemsMock,
}));

const routeModule = await import("./route");
const { GET, POST } = routeModule;

function params(teamId = "team-1") {
  return { params: Promise.resolve({ teamId }) };
}

function requestWith(header?: string, query = ""): Request {
  return new Request(`http://localhost/api/teams/team-1/roadmap-items${query}`, {
    headers: header ? { authorization: header } : {},
  });
}

afterEach(() => {
  listRoadmapItemsMock.mockReset();
  createRoadmapItemMock.mockReset();
});

describe("GET /api/teams/[teamId]/roadmap-items", () => {
  it("returns exactly items, canEdit and truncated", async () => {
    listRoadmapItemsMock.mockResolvedValue({ ok: true, items: [{ treeId: "t" }], canEdit: true, truncated: false });

    const response = await GET(requestWith("Bearer abc.def"), params("team-42"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ treeId: "t" }], canEdit: true, truncated: false });
    expect(listRoadmapItemsMock).toHaveBeenCalledWith("abc.def", "team-42", { includeArchived: false });
  });

  it("includes archived plans only for archived=true", async () => {
    listRoadmapItemsMock.mockResolvedValue({ ok: true, items: [], canEdit: false, truncated: false });

    await GET(requestWith("Bearer t", "?archived=true"), params());
    await GET(requestWith("Bearer t", "?archived=yes"), params());

    expect(listRoadmapItemsMock.mock.calls.map((call) => call[2])).toEqual([
      { includeArchived: true },
      { includeArchived: false },
    ]);
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["read_failed", 500],
  ])("maps %s to %i with an error code only", async (error, status) => {
    listRoadmapItemsMock.mockResolvedValue({ ok: false, error });

    const response = await GET(requestWith("Bearer t"), params());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("passes an empty token when the header is missing or malformed", async () => {
    listRoadmapItemsMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await GET(requestWith(), params());
    await GET(requestWith("Basic abc"), params());

    expect(listRoadmapItemsMock.mock.calls.map((call) => call[0])).toEqual(["", ""]);
  });
});

function postWith(body: unknown, header = "Bearer tok.en", raw = false): Request {
  return new Request("http://localhost/api/teams/team-1/roadmap-items", {
    method: "POST",
    headers: header ? { authorization: header, "content-type": "application/json" } : {},
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

describe("POST /api/teams/[teamId]/roadmap-items", () => {
  it("returns 201 with exactly { item }, passing token, route teamId and body", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: true, item: { treeId: "t" } });

    const response = await POST(postWith({ treeId: "t", targetNodeId: "node-1" }), params("team-42"));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ item: { treeId: "t" } });
    expect(createRoadmapItemMock).toHaveBeenCalledWith("tok.en", "team-42", { treeId: "t", targetNodeId: "node-1" });
  });

  it.each([
    ["unauthenticated", 401],
    ["forbidden", 403],
    ["invalid_request", 400],
    ["invalid_input", 400],
    ["target_not_ahead", 400],
    ["invalid_owner", 400],
    ["team_disabled", 400],
    ["not_tracked", 404],
    ["tree_not_found", 404],
    ["already_planned", 409],
    ["plan_archived", 409],
    ["persistence_failed", 500],
  ])("maps %s to %i with an error code only", async (error, status) => {
    createRoadmapItemMock.mockResolvedValue({ ok: false, error });

    const response = await POST(postWith({}), params());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("treats unparsable JSON as a non-object body (operation answers invalid_request)", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "invalid_request" });

    const response = await POST(postWith("{nope", "Bearer t", true), params());

    expect(createRoadmapItemMock.mock.calls[0][2]).toBeUndefined();
    expect(response.status).toBe(400);
  });

  it("passes an empty token when the header is missing", async () => {
    createRoadmapItemMock.mockResolvedValue({ ok: false, error: "unauthenticated" });

    await POST(postWith({}, ""), params());

    expect(createRoadmapItemMock.mock.calls[0][0]).toBe("");
  });

  it("exports no DELETE, PATCH or PUT handler", () => {
    expect(Object.keys(routeModule).sort()).toEqual(["GET", "POST"]);
  });
});
