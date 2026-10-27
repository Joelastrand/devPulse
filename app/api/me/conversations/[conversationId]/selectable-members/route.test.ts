import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const readSelectableMembersMock = vi.fn();
const depsMock = { store: "synthetic-store" };

vi.mock("../../../../../../src/features/auth/server/verify-identity", () => ({ verifyIdToken: verifyIdTokenMock }));
vi.mock("../../../../../../src/features/development-conversations/server/read-selectable-members", () => ({
  readSelectableMembers: readSelectableMembersMock,
}));
vi.mock("../../../../../../src/features/development-conversations/server/owner-route-deps", () => ({
  productionSelectableMembersDeps: () => depsMock,
}));

const routeModule = await import("./route");

const OWNER = "owner-uid-7731";
const CONVERSATION = "conv-synthetic-1";
const AUTH = { authorization: "Bearer good.token" };
const SELECTOR_PATH = "/api/me/conversations/conv-synthetic-1/selectable-members";
const url = (query = "") => `http://localhost${SELECTOR_PATH}${query}`;

const get = (headers: Record<string, string> = AUTH, query = "") => new Request(url(query), { method: "GET", headers });
const context = (conversationId = CONVERSATION) => ({ params: Promise.resolve({ conversationId }) });

beforeEach(() => {
  verifyIdTokenMock.mockResolvedValue({ ok: true, identity: { uid: OWNER, email: "x@example.test", emailVerified: true } });
  readSelectableMembersMock.mockReset();
});

describe("GET /api/me/conversations/[conversationId]/selectable-members", () => {
  it("rejects a missing bearer token with unauthenticated and never reads the roster (I-1)", async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ ok: false, error: "unauthenticated" });

    const response = await routeModule.GET(get({}), context());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(readSelectableMembersMock).not.toHaveBeenCalled();
  });

  it("reads the roster for the verified uid and the path id only, ignoring any uid, team or memberRef supplied in the request", async () => {
    readSelectableMembersMock.mockResolvedValue({ ok: true, members: [], unavailableCount: 0, truncated: false });

    await routeModule.GET(get(AUTH, "?uid=someone-else&teamId=team-x&memberRef=ref-1&email=a@b.test"), context());

    expect(readSelectableMembersMock).toHaveBeenCalledTimes(1);
    expect(readSelectableMembersMock).toHaveBeenCalledWith(OWNER, CONVERSATION, depsMock);
  });

  it("returns exactly { members: [{ memberRef, displayName, ordinal, isSelf }], unavailableCount, truncated } with no-store", async () => {
    readSelectableMembersMock.mockResolvedValue({
      ok: true,
      members: [
        { memberRef: "ref-1", displayName: "Synthetic", ordinal: 1, isSelf: false, uid: "x", role: "lead", email: "a@b.test" },
      ],
      unavailableCount: 2,
      truncated: true,
    });

    const response = await routeModule.GET(get(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      members: [{ memberRef: "ref-1", displayName: "Synthetic", ordinal: 1, isSelf: false }],
      unavailableCount: 2,
      truncated: true,
    });
  });

  it("maps each stable refusal to its status and code with no detail", async () => {
    const cases: Array<[string, number]> = [
      ["conversation_not_found", 404],
      ["invalid_participant", 400],
      ["conversation_completed", 409],
      ["persistence_failed", 500],
    ];
    for (const [error, status] of cases) {
      readSelectableMembersMock.mockResolvedValueOnce({ ok: false, error });

      const response = await routeModule.GET(get(), context());

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
    }
  });
});
