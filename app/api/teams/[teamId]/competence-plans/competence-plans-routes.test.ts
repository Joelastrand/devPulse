import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  listCompetencePlans: vi.fn(),
  upsertCompetencePlan: vi.fn(),
}));

vi.mock("../../../../../src/features/team-competence-plan/server/competence-plans", () => server);
vi.mock("../../../../../src/lib/firebase/admin", () => ({
  getAdminAuth: () => {
    throw new Error("unexpected Firebase Auth use");
  },
  getFirestoreDb: () => {
    throw new Error("unexpected Firestore use");
  },
}));

const { GET } = await import("./route");
const { PUT } = await import("./[treeId]/route");

const TEAM = "team-1";
const TREE = "tree-alpha";

function getRequest(token = "tok") {
  return new Request(`http://localhost/api/teams/${TEAM}/competence-plans`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function putRequest(body: unknown, token = "tok") {
  return new Request(`http://localhost/api/teams/${TEAM}/competence-plans/${TREE}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ teamId: TEAM }) };
const treeParams = { params: Promise.resolve({ teamId: TEAM, treeId: TREE }) };

describe("GET /api/teams/[teamId]/competence-plans", () => {
  beforeEach(() => {
    server.listCompetencePlans.mockReset();
    server.upsertCompetencePlan.mockReset();
  });

  it("returns the plans and the edit flag, and passes only the verified bearer token through", async () => {
    server.listCompetencePlans.mockResolvedValue({ ok: true, plans: [], canEdit: true, truncated: false });
    const response = await GET(getRequest("tok-123"), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plans: [], canEdit: true, truncated: false });
    expect(server.listCompetencePlans).toHaveBeenCalledWith("tok-123", TEAM, { includeArchived: false });
  });

  it("maps a missing bearer token to an unauthenticated refusal without reaching the server read", async () => {
    server.listCompetencePlans.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const response = await GET(getRequest(""), params);
    expect(response.status).toBe(401);
  });

  it("maps a forbidden team read to 403 with a code only", async () => {
    server.listCompetencePlans.mockResolvedValue({ ok: false, error: "forbidden" });
    const response = await GET(getRequest(), params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });
});

describe("PUT /api/teams/[teamId]/competence-plans/[treeId]", () => {
  beforeEach(() => {
    server.listCompetencePlans.mockReset();
    server.upsertCompetencePlan.mockReset();
  });

  it("returns 200 with the saved plan for a lead's valid write", async () => {
    const plan = { treeId: TREE, targetStage: 3, priority: "high", archived: false, milestones: [], progress: { completed: 0, total: 0 } };
    server.upsertCompetencePlan.mockResolvedValue({ ok: true, plan });
    const body = { targetStage: 3, priority: "high", archived: false, milestones: [] };
    const response = await PUT(putRequest(body), treeParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan });
    expect(server.upsertCompetencePlan).toHaveBeenCalledWith("tok", TEAM, TREE, body);
  });

  it("returns 400 with the validation issues and no plan for invalid input", async () => {
    server.upsertCompetencePlan.mockResolvedValue({ ok: false, error: "invalid_input", issues: ["target_stage_invalid"] });
    const response = await PUT(putRequest({ targetStage: 9 }), treeParams);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input", issues: ["target_stage_invalid"] });
  });

  it("returns 403 for a non-lead and 409 for an archived area, with codes only", async () => {
    server.upsertCompetencePlan.mockResolvedValueOnce({ ok: false, error: "forbidden" });
    expect((await PUT(putRequest({}), treeParams)).status).toBe(403);
    server.upsertCompetencePlan.mockResolvedValueOnce({ ok: false, error: "area_archived" });
    const archived = await PUT(putRequest({}), treeParams);
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({ error: "area_archived" });
  });

  it("treats an unparsable body as an invalid request, not a crash", async () => {
    server.upsertCompetencePlan.mockResolvedValue({ ok: false, error: "invalid_request" });
    const response = await PUT(putRequest("{not json"), treeParams);
    expect(response.status).toBe(400);
    expect(server.upsertCompetencePlan).toHaveBeenCalledWith("tok", TEAM, TREE, undefined);
  });
});
