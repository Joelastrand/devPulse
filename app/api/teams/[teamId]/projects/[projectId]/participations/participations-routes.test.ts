import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../../src/features/team-projects/server/write-project-participation", () => ({
  writeProjectParticipation: vi.fn(),
}));
vi.mock("../../../../../../../src/features/team-projects/server/list-project-participations", () => ({
  listProjectParticipations: vi.fn(),
}));

import { listProjectParticipations } from "../../../../../../../src/features/team-projects/server/list-project-participations";
import { writeProjectParticipation } from "../../../../../../../src/features/team-projects/server/write-project-participation";
import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[participationId]/route";

const VIEW = {
  participationId: "part-1",
  projectId: "proj-1",
  memberRef: "0123456789abcdefghjkmnpqrs",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  note: null,
  archived: false,
  overlapsOther: false,
};

function request(body?: unknown, token = "tok") {
  return new Request("http://localhost/api/teams/team-1/projects/proj-1/participations", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? "{not json" : JSON.stringify(body),
  });
}

function ctx(projectId = "proj-1") {
  return { params: Promise.resolve({ teamId: "team-1", projectId }) };
}

function itemCtx(participationId: string, projectId = "proj-1") {
  return { params: Promise.resolve({ teamId: "team-1", projectId, participationId }) };
}

beforeEach(() => {
  vi.mocked(writeProjectParticipation).mockReset();
  vi.mocked(listProjectParticipations).mockReset();
});

describe("participation collection route", () => {
  it("creates a participation and returns 201 with the allow-listed view only", async () => {
    vi.mocked(writeProjectParticipation).mockResolvedValue({ ok: true, participation: VIEW });
    const response = await POST(request({ memberRef: VIEW.memberRef, startDate: "2026-07-01", endDate: "2026-07-31" }), ctx());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ participation: VIEW });
    expect(writeProjectParticipation).toHaveBeenCalledWith("tok", "team-1", "proj-1", "create", null, expect.anything());
  });

  it("refuses a malformed project id before any gateway call", async () => {
    const response = await POST(request({}), ctx("bad id with spaces"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(writeProjectParticipation).not.toHaveBeenCalled();
  });

  it("passes unparsable JSON to the gateway as undefined, which becomes invalid_request", async () => {
    vi.mocked(writeProjectParticipation).mockResolvedValue({ ok: false, error: "invalid_request" });
    const response = await POST(request(undefined), ctx());
    expect(response.status).toBe(400);
    expect(writeProjectParticipation).toHaveBeenCalledWith("tok", "team-1", "proj-1", "create", null, undefined);
  });

  it("returns 400 with validation issue names, never raw error text", async () => {
    vi.mocked(writeProjectParticipation).mockResolvedValue({ ok: false, error: "invalid_input", issues: ["end_before_start"] });
    const response = await POST(request({}), ctx());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_input", issues: ["end_before_start"] });
  });

  it("maps a forbidden write to 403 with the code only", async () => {
    vi.mocked(writeProjectParticipation).mockResolvedValue({ ok: false, error: "forbidden" });
    const response = await POST(request({}), ctx());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("maps an invalid member to 400 and an archived project to 409", async () => {
    vi.mocked(writeProjectParticipation).mockResolvedValueOnce({ ok: false, error: "invalid_member" });
    expect((await POST(request({}), ctx())).status).toBe(400);
    vi.mocked(writeProjectParticipation).mockResolvedValueOnce({ ok: false, error: "project_archived" });
    expect((await POST(request({}), ctx())).status).toBe(409);
  });

  it("lists participations for a readable project, with canEdit and truncated flags", async () => {
    vi.mocked(listProjectParticipations).mockResolvedValue({ ok: true, participations: [VIEW], canEdit: false, truncated: false });
    const response = await GET(new Request("http://localhost/x", { headers: { authorization: "Bearer tok" } }), ctx());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ participations: [VIEW], canEdit: false, truncated: false });
  });

  it("maps a denied read to 403 and a failed read to 500 without raw detail", async () => {
    vi.mocked(listProjectParticipations).mockResolvedValueOnce({ ok: false, error: "forbidden" });
    expect((await GET(new Request("http://localhost/x"), ctx())).status).toBe(403);
    vi.mocked(listProjectParticipations).mockResolvedValueOnce({ ok: false, error: "read_failed" });
    const failed = await GET(new Request("http://localhost/x"), ctx());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "read_failed" });
  });
});

describe("participation item route", () => {
  it("updates a participation and returns 200", async () => {
    vi.mocked(writeProjectParticipation).mockResolvedValue({ ok: true, participation: { ...VIEW, endDate: "2026-08-10" } });
    const response = await PATCH(
      new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ endDate: "2026-08-10" }) }),
      itemCtx("part-1"),
    );
    expect(response.status).toBe(200);
    expect(writeProjectParticipation).toHaveBeenCalledWith("", "team-1", "proj-1", "update", "part-1", { endDate: "2026-08-10" });
  });

  it("removes a participation through the remove action, with no body", async () => {
    vi.mocked(writeProjectParticipation).mockResolvedValue({ ok: true, participation: { ...VIEW, archived: true } });
    const response = await DELETE(new Request("http://localhost/x", { method: "DELETE", headers: { authorization: "Bearer tok" } }), itemCtx("part-1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ participation: { ...VIEW, archived: true } });
    expect(writeProjectParticipation).toHaveBeenCalledWith("tok", "team-1", "proj-1", "remove", "part-1", undefined);
  });

  it("refuses a malformed participation id on update and removal before any gateway call", async () => {
    const patch = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: "{}" }), itemCtx("x/../y"));
    const remove = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), itemCtx("x/../y"));
    expect(patch.status).toBe(400);
    expect(remove.status).toBe(400);
    expect(writeProjectParticipation).not.toHaveBeenCalled();
  });
});
