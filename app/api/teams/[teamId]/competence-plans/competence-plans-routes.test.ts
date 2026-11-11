import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  listCompetencePlans: vi.fn(),
  createCompetencePlan: vi.fn(),
  updateCompetencePlan: vi.fn(),
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

const { GET, POST } = await import("./route");
const { PUT } = await import("./[planId]/route");

const TEAM = "team-1";
const PLAN = "11111111-1111-4111-8111-111111111111";

function jsonRequest(method: string, body: unknown, token = "tok") {
  return new Request(`http://localhost/api/teams/${TEAM}/competence-plans`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getRequest(token = "tok") {
  return new Request(`http://localhost/api/teams/${TEAM}/competence-plans`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const params = { params: Promise.resolve({ teamId: TEAM }) };
const planParams = { params: Promise.resolve({ teamId: TEAM, planId: PLAN }) };
const VALID_BODY = { title: "Testautomatisering", targetStage: 2, priority: "medium", archived: false, milestones: [] };

describe("GET /api/teams/[teamId]/competence-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

describe("POST /api/teams/[teamId]/competence-plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a plan with no competence area and returns 201 with the plan view", async () => {
    server.createCompetencePlan.mockResolvedValue({ ok: true, plan: { planId: PLAN, title: "Testautomatisering" } });
    const response = await POST(jsonRequest("POST", VALID_BODY, "tok-9"), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ plan: { planId: PLAN, title: "Testautomatisering" } });
    expect(server.createCompetencePlan).toHaveBeenCalledWith("tok-9", TEAM, VALID_BODY);
  });

  it("returns the validation issues for an invalid body", async () => {
    server.createCompetencePlan.mockResolvedValue({ ok: false, error: "invalid_input", issues: ["title_invalid"] });
    const response = await POST(jsonRequest("POST", { ...VALID_BODY, title: "" }), params);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input", issues: ["title_invalid"] });
  });

  it("maps a member's refusal to 403", async () => {
    server.createCompetencePlan.mockResolvedValue({ ok: false, error: "forbidden" });
    const response = await POST(jsonRequest("POST", VALID_BODY), params);
    expect(response.status).toBe(403);
  });
});

describe("PUT /api/teams/[teamId]/competence-plans/[planId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the plan id and body to the update and returns the saved plan", async () => {
    server.updateCompetencePlan.mockResolvedValue({ ok: true, plan: { planId: PLAN } });
    const response = await PUT(jsonRequest("PUT", VALID_BODY, "tok-7"), planParams);
    expect(response.status).toBe(200);
    expect(server.updateCompetencePlan).toHaveBeenCalledWith("tok-7", TEAM, PLAN, VALID_BODY);
  });

  it("maps an unknown or cross-team plan to 404 without revealing which", async () => {
    server.updateCompetencePlan.mockResolvedValue({ ok: false, error: "not_found" });
    const response = await PUT(jsonRequest("PUT", VALID_BODY), planParams);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("maps a missing bearer token to 401", async () => {
    server.updateCompetencePlan.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const response = await PUT(jsonRequest("PUT", VALID_BODY, ""), planParams);
    expect(response.status).toBe(401);
  });
});
