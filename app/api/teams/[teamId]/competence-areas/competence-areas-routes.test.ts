import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../src/features/team-competence-catalog/server/manage-competence-areas", () => ({
  assignCompetenceArea: vi.fn(),
  listCompetenceAreas: vi.fn(),
  setCompetenceAreaStatus: vi.fn(),
  reorderCompetenceAreas: vi.fn(),
}));

import {
  assignCompetenceArea,
  listCompetenceAreas,
} from "../../../../../src/features/team-competence-catalog/server/manage-competence-areas";
import { GET, POST } from "./route";

const AREA = { treeId: "tree-alpha", name: "Arkitektur", status: "active" as const, sortOrder: 0 };

function post(body: unknown) {
  return new Request("http://localhost/api/teams/team-1/competence-areas", {
    method: "POST",
    headers: { authorization: "Bearer tok", "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ teamId: "team-1" }) };

beforeEach(() => {
  vi.mocked(assignCompetenceArea).mockReset();
  vi.mocked(listCompetenceAreas).mockReset();
});

describe("competence areas collection route", () => {
  it("assigns an area and returns 201 with the allow-listed view", async () => {
    vi.mocked(assignCompetenceArea).mockResolvedValue({ ok: true, area: AREA });
    const response = await POST(post({ treeId: "tree-alpha" }), ctx);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ area: AREA });
    expect(assignCompetenceArea).toHaveBeenCalledWith("tok", "team-1", { treeId: "tree-alpha" });
  });

  it("passes unparsable JSON to the gateway, which refuses it as invalid_request (400)", async () => {
    vi.mocked(assignCompetenceArea).mockResolvedValue({ ok: false, error: "invalid_request" });
    const response = await POST(post("{not json"), ctx);
    expect(response.status).toBe(400);
    expect(assignCompetenceArea).toHaveBeenCalledWith("tok", "team-1", undefined);
  });

  it("maps a conflict to 409 and a forbidden write to 403, with codes only", async () => {
    vi.mocked(assignCompetenceArea).mockResolvedValueOnce({ ok: false, error: "already_assigned" });
    const conflict = await POST(post({ treeId: "tree-alpha" }), ctx);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "already_assigned" });

    vi.mocked(assignCompetenceArea).mockResolvedValueOnce({ ok: false, error: "forbidden" });
    expect((await POST(post({ treeId: "tree-alpha" }), ctx)).status).toBe(403);
  });

  it("lists the team's areas with canEdit and truncated flags", async () => {
    vi.mocked(listCompetenceAreas).mockResolvedValue({ ok: true, areas: [AREA], canEdit: true, truncated: false });
    const response = await GET(new Request("http://localhost/x", { headers: { authorization: "Bearer tok" } }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ areas: [AREA], canEdit: true, truncated: false });
  });
});
